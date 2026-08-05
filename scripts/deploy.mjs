/**
 * Deploy Foreman + a mock USDC to Base Sepolia, fund every role with gas,
 * seed the plant treasury, and emit lib/deployment.ts for the UI and agent.
 *
 * Run: node scripts/deploy.mjs
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, hardhat } from "viem/chains";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const need = (k) => {
  if (!env[k]) throw new Error(`${k} missing from .env — run: node scripts/keys.mjs`);
  return env[k];
};

const artifact = (name) =>
  JSON.parse(fs.readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));

const USDC = (n) => BigInt(Math.round(n * 1e6));
const MONTHLY_CAP = USDC(2_000);
const AUTO_APPROVE_MAX = USDC(500);
const TREASURY = USDC(50_000);
const GAS_PER_ROLE = parseEther("0.002");

const LOCAL = process.env.CHAIN === "local";
const chain = LOCAL ? hardhat : baseSepolia;
const rpc = LOCAL ? "http://127.0.0.1:8545" : env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const explorer = LOCAL ? "" : "https://sepolia.basescan.org";

const plant = privateKeyToAccount(need("DEPLOYER_KEY"));
const agentAddr = need("NEXT_PUBLIC_AGENT_ADDRESS");
const supplierA = need("NEXT_PUBLIC_SUPPLIER_A");
const supplierB = need("NEXT_PUBLIC_SUPPLIER_B");

const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account: plant, chain, transport: http(rpc) });

/**
 * Two confirmations, not one. Base Sepolia's public RPC will hand back a
 * receipt and then still answer eth_estimateGas from the previous state, so a
 * one-confirmation wait lets the next call simulate against stale storage —
 * which is how `approve` then `deposit` failed on insufficient allowance.
 * Also fails loudly on a reverted transaction instead of sailing past it.
 */
async function wait(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

async function deploy(name, args) {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const { contractAddress } = await wait(hash);
  console.log(`  ${name.padEnd(9)} ${contractAddress}`);
  return { address: contractAddress, abi };
}

let balance = await publicClient.getBalance({ address: plant.address });

if (LOCAL && balance < parseEther("1")) {
  // Hardhat's node ships 20 funded accounts; account #0's key is public and
  // well known. Top the plant up from it so the same .env works locally.
  const faucet = createWalletClient({
    account: privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    ),
    chain,
    transport: http(rpc),
  });
  await wait(await faucet.sendTransaction({ to: plant.address, value: parseEther("10") }));
  balance = await publicClient.getBalance({ address: plant.address });
}

console.log(`chain   ${chain.name} (${chain.id})`);
console.log(`plant   ${plant.address}  ${formatEther(balance)} ETH`);

/**
 * Ask for what this run actually needs, not a round number. Roles that are
 * already funded cost nothing, and a flat 0.01 ETH floor blocks a deploy that
 * would have gone through on 0.003.
 */
const roles = [
  ["agent", agentAddr],
  ["supplierA", supplierA],
  ["supplierB", supplierB],
];
const needsGas = [];
for (const [label, to] of roles) {
  if ((await publicClient.getBalance({ address: to })) < GAS_PER_ROLE) needsGas.push([label, to]);
}

const DEPLOY_RESERVE = parseEther("0.0025"); // two contracts plus the seeding calls
const required = DEPLOY_RESERVE + GAS_PER_ROLE * BigInt(needsGas.length);
if (balance < required) {
  throw new Error(
    `Need about ${formatEther(required)} ETH (deploy plus gas for ${needsGas.length} unfunded role(s)), have ${formatEther(balance)}.\n` +
      `Fund ${plant.address} at https://www.alchemy.com/faucets/base-sepolia`,
  );
}

/**
 * Foreman takes any ERC-20. Set USDC_ADDRESS to settle in Circle's real
 * testnet USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e on Base Sepolia);
 * leave it unset and we deploy a mock.
 *
 * The mock is the default on purpose. Circle's faucet hands out 20 USDC every
 * two hours, and a plant treasury of $20 buying a $0.18 bearing is not a
 * demonstration of anything. The mock keeps the money figures the size real
 * maintenance actually runs at.
 */
const externalToken = process.env.USDC_ADDRESS;

console.log("\ndeploying...");
const usdc = externalToken
  ? { address: externalToken, abi: artifact("MockUSDC").abi } // ERC-20 surface is the same
  : await deploy("MockUSDC", []);
if (externalToken) console.log(`  USDC      ${externalToken} (external)`);

const foreman = await deploy("Foreman", [usdc.address, agentAddr, MONTHLY_CAP, AUTO_APPROVE_MAX]);

console.log("\nseeding treasury...");
const call = (c, functionName, args) =>
  wallet.writeContract({ address: c.address, abi: c.abi, functionName, args }).then(wait);

let treasury = TREASURY;
if (externalToken) {
  const held = await publicClient.readContract({
    address: usdc.address,
    abi: usdc.abi,
    functionName: "balanceOf",
    args: [plant.address],
  });
  if (held === 0n) {
    throw new Error(
      `${plant.address} holds no USDC at ${externalToken}. Fund it at https://faucet.circle.com then re-run.`,
    );
  }
  treasury = held;
  console.log(`  plant holds ${Number(held) / 1e6} USDC`);
} else {
  await call(usdc, "mint", [plant.address, treasury]);
}

await call(usdc, "approve", [foreman.address, treasury]);
await call(foreman, "deposit", [treasury]);
console.log(`  deposited ${Number(treasury) / 1e6} USDC`);

console.log("\nvetting suppliers...");
for (const [label, addr] of [["Sundara / A", supplierA], ["Precision / B", supplierB]]) {
  await call(foreman, "setSupplier", [addr, true]);
  console.log(`  ${label.padEnd(14)} ${addr}`);
}

console.log("\nfunding roles with gas...");
if (needsGas.length === 0) console.log("  all roles already funded");
for (const [label, to] of needsGas) {
  await wait(await wallet.sendTransaction({ to, value: GAS_PER_ROLE }));
  console.log(`  ${label.padEnd(10)} ${formatEther(GAS_PER_ROLE)} ETH`);
}

// --- emit a single generated module the UI and agent both import ---
const out = `// GENERATED by scripts/deploy.mjs — do not edit.
export const CHAIN_ID = ${chain.id};
export const EXPLORER = "${explorer}";
export const FOREMAN_ADDRESS = "${foreman.address}" as const;
export const USDC_ADDRESS = "${usdc.address}" as const;
export const FOREMAN_ABI = ${JSON.stringify(foreman.abi)} as const;
export const USDC_ABI = ${JSON.stringify(usdc.abi)} as const;
`;
fs.mkdirSync("lib", { recursive: true });
fs.writeFileSync("lib/deployment.ts", out);

let dotenv = fs.readFileSync(".env", "utf8");
for (const [k, v] of [
  ["NEXT_PUBLIC_FOREMAN_ADDRESS", foreman.address],
  ["NEXT_PUBLIC_USDC_ADDRESS", usdc.address],
]) {
  const re = new RegExp(`^${k}=.*$`, "m");
  dotenv = re.test(dotenv) ? dotenv.replace(re, `${k}=${v}`) : `${dotenv.trimEnd()}\n${k}=${v}\n`;
}
fs.writeFileSync(".env", dotenv);

console.log(`\ndone. ${explorer ? `${explorer}/address/${foreman.address}` : foreman.address}`);
