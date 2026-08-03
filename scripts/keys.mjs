/**
 * Generate burner keys for the agent and the two suppliers, so every role in
 * the demo signs its own transactions. Idempotent — existing keys are kept.
 */
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROLES = [
  ["AGENT_KEY", "NEXT_PUBLIC_AGENT_ADDRESS"],
  ["SUPPLIER_A_KEY", "NEXT_PUBLIC_SUPPLIER_A"],
  ["SUPPLIER_B_KEY", "NEXT_PUBLIC_SUPPLIER_B"],
];

let env = fs.readFileSync(".env", "utf8");

function upsert(name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
}

for (const [keyVar, addrVar] of ROLES) {
  const existing = env.match(new RegExp(`^${keyVar}=(0x[0-9a-fA-F]{64})$`, "m"))?.[1];
  const pk = existing ?? generatePrivateKey();
  upsert(keyVar, pk);
  upsert(addrVar, privateKeyToAccount(pk).address);
  console.log(`${addrVar.padEnd(28)} ${privateKeyToAccount(pk).address}${existing ? " (kept)" : " (new)"}`);
}

fs.writeFileSync(".env", env);
