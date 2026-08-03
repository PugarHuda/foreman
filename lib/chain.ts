/**
 * Server-side chain access. Every role signs with its own key, which is the
 * whole point: the agent's key is separate from the plant's and is bounded
 * on-chain by the spend permission. Keys never leave the server.
 */
import { createPublicClient, createWalletClient, http, type Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FOREMAN_ADDRESS, FOREMAN_ABI, EXPLORER } from "./deployment.ts";
import { activeChain, rpcUrl } from "./chains.ts";

export type Role = "plant" | "agent" | "supplierA" | "supplierB";

const KEY_ENV: Record<Role, string> = {
  plant: "DEPLOYER_KEY",
  agent: "AGENT_KEY",
  supplierA: "SUPPLIER_A_KEY",
  supplierB: "SUPPLIER_B_KEY",
};

export const STATUS = ["None", "Proposed", "Funded", "Shipped", "Released", "Cancelled"] as const;
export type StatusName = (typeof STATUS)[number];

export const publicClient = createPublicClient({
  chain: activeChain(),
  transport: http(rpcUrl()),
});

function walletFor(role: Role) {
  const pk = process.env[KEY_ENV[role]];
  if (!pk) throw new Error(`${KEY_ENV[role]} missing from .env`);
  return createWalletClient({
    account: privateKeyToAccount(pk as `0x${string}`),
    chain: activeChain(),
    transport: http(rpcUrl()),
  });
}

export function addressOf(role: Role): Address {
  const pk = process.env[KEY_ENV[role]];
  if (!pk) throw new Error(`${KEY_ENV[role]} missing from .env`);
  return privateKeyToAccount(pk as `0x${string}`).address;
}

const foreman = { address: FOREMAN_ADDRESS as Address, abi: FOREMAN_ABI as unknown as Abi };

export function txUrl(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

async function send(role: Role, functionName: string, args: unknown[]) {
  const wallet = walletFor(role);
  const { request } = await publicClient.simulateContract({
    ...foreman,
    functionName,
    args,
    account: wallet.account,
  });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export interface PurchaseOrder {
  id: number;
  supplier: Address;
  since: number;
  status: StatusName;
  agentFunded: boolean;
  machineId: number;
  amountUsd: number;
  partNo: string;
}

export interface PlantState {
  foreman: Address;
  agent: Address;
  availableUsd: number;
  escrowedUsd: number;
  monthlyCapUsd: number;
  autoApproveMaxUsd: number;
  remainingBudgetUsd: number;
  pos: PurchaseOrder[];
}

const usd = (v: bigint) => Number(v) / 1e6;

export async function getState(): Promise<PlantState> {
  const read = (functionName: string) =>
    publicClient.readContract({ ...foreman, functionName }) as Promise<never>;

  const [agent, available, escrowed, monthlyCap, autoApproveMax, remaining, raw] = await Promise.all([
    read("agent"),
    read("available"),
    read("escrowed"),
    read("monthlyCap"),
    read("autoApproveMax"),
    read("remainingBudget"),
    read("allPOs"),
  ]);

  const pos = (raw as unknown as any[]).map((p, id) => ({
    id,
    supplier: p.supplier as Address,
    since: Number(p.since),
    status: STATUS[Number(p.status)],
    agentFunded: Boolean(p.agentFunded),
    machineId: Number(p.machineId),
    amountUsd: usd(p.amount),
    partNo: p.partNo as string,
  }));

  return {
    foreman: foreman.address,
    agent: agent as unknown as Address,
    availableUsd: usd(available as unknown as bigint),
    escrowedUsd: usd(escrowed as unknown as bigint),
    monthlyCapUsd: usd(monthlyCap as unknown as bigint),
    autoApproveMaxUsd: usd(autoApproveMax as unknown as bigint),
    remainingBudgetUsd: usd(remaining as unknown as bigint),
    pos,
  };
}

export const proposePO = (machineId: number, partNo: string, supplier: Address, amountUsd: number) =>
  send("agent", "proposePO", [machineId, partNo, supplier, BigInt(Math.round(amountUsd * 1e6))]);

export const approvePO = (id: number) => send("plant", "approvePO", [BigInt(id)]);
export const confirmReceipt = (id: number) => send("plant", "confirmReceipt", [BigInt(id)]);
export const cancelPO = (id: number) => send("plant", "cancelPO", [BigInt(id)]);

/** Ship as whichever supplier actually owns the PO. */
export async function markShipped(id: number) {
  const { pos } = await getState();
  const po = pos.find((p) => p.id === id);
  if (!po) throw new Error(`no PO ${id}`);
  const role: Role = po.supplier.toLowerCase() === addressOf("supplierA").toLowerCase() ? "supplierA" : "supplierB";
  return send(role, "markShipped", [BigInt(id)]);
}
