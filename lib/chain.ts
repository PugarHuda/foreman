/**
 * Server-side chain access. Every role signs with its own key, which is the
 * whole point: the agent's key is separate from the plant's and is bounded
 * on-chain by the spend permission. Keys never leave the server.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Abi,
  type Address,
} from "viem";
import { waybillFor } from "./plant.ts";
import { privateKeyToAccount } from "viem/accounts";
import { FOREMAN_ADDRESS, FOREMAN_ABI, EXPLORER } from "./deployment.ts";
import { activeChain, rpcUrl } from "./chains.ts";

export type Role = "plant" | "agent" | "supplierA" | "supplierB";
export type { Address };

const KEY_ENV: Record<Role, string> = {
  plant: "DEPLOYER_KEY",
  agent: "AGENT_KEY",
  supplierA: "SUPPLIER_A_KEY",
  supplierB: "SUPPLIER_B_KEY",
};

export const STATUS = [
  "None",
  "Proposed",
  "Funded",
  "Shipped",
  "Released",
  "Cancelled",
  "Fitted",
] as const;
export type StatusName = (typeof STATUS)[number];

/**
 * Reads go out as one multicall, not seven.
 *
 * getState() reads seven values, and the agent calls it again mid-run. Fired
 * individually at a public RPC that is one eth_call per value, which is how
 * the panel started coming back "over rate limit" — and a rate-limited read
 * looks exactly like a plant with no money.
 */
export const publicClient = createPublicClient({
  chain: activeChain(),
  transport: http(rpcUrl(), { retryCount: 3, retryDelay: 400, timeout: 20_000 }),
  batch: { multicall: { wait: 16 } },
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

/** What the supplier commits to on despatch and goods-in checks on arrival. */
export const deliveryRefFor = (poId: number) => keccak256(stringToHex(waybillFor(poId)));

export function txUrl(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

/** Empty on a local node, where there is no explorer to link to. */
export const explorerBase = () => EXPLORER;

async function send(role: Role, functionName: string, args: unknown[]) {
  const wallet = walletFor(role);
  const { request } = await publicClient.simulateContract({
    ...foreman,
    functionName,
    args,
    account: wallet.account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
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
  /** Hours of life the machine had left when this was ordered. */
  rulHoursAtOrder: number;
  /** Despatch document the supplier committed to, once they have shipped. */
  waybill: string | null;
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

export async function poCount(): Promise<number> {
  return Number(await publicClient.readContract({ ...foreman, functionName: "poCount" }));
}

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
    rulHoursAtOrder: Number(p.rulHoursAtOrder ?? 0),
    waybill:
      p.deliveryRef && p.deliveryRef !== `0x${"0".repeat(64)}` ? waybillFor(id) : null,
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

/**
 * Returns what the order became, decoded from the receipt we already waited
 * for. Deliberately no follow-up read: an RPC hiccup after a successful
 * write must never be reported as a failed order, or the agent will place it
 * twice.
 */
export async function proposePO(
  machineId: number,
  partNo: string,
  supplier: Address,
  amountUsd: number,
  rulHoursAtOrder = 0,
): Promise<{ hash: string; id: number; status: StatusName }> {
  const { hash, receipt } = await send("agent", "proposePO", [
    machineId,
    partNo,
    supplier,
    BigInt(Math.round(amountUsd * 1e6)),
    Math.max(0, Math.round(rulHoursAtOrder)),
  ]);

  const events = parseEventLogs({ abi: foreman.abi, logs: receipt.logs });
  const proposed = events.find((e) => (e as { eventName: string }).eventName === "Proposed");
  const funded = events.find((e) => (e as { eventName: string }).eventName === "Funded");
  if (!proposed) throw new Error(`no Proposed event in ${hash}`);

  return {
    hash,
    id: Number((proposed as unknown as { args: { id: bigint } }).args.id),
    status: funded ? "Funded" : "Proposed",
  };
}

export const approvePO = (id: number) => send("plant", "approvePO", [BigInt(id)]).then((r) => r.hash);
export const cancelPO = (id: number) => send("plant", "cancelPO", [BigInt(id)]).then((r) => r.hash);

/** Issue a delivered part from the store to the machine. */
export const fitPart = (id: number) => send("plant", "fitPart", [BigInt(id)]).then((r) => r.hash);

/** Goods-in submits the reference it read off the document that arrived. */
export const confirmReceipt = (id: number) =>
  send("plant", "confirmReceipt", [BigInt(id), deliveryRefFor(id)]).then((r) => r.hash);

/** Ship as whichever supplier actually owns the PO, committing to the waybill. */
export async function markShipped(id: number) {
  const { pos } = await getState();
  const po = pos.find((p) => p.id === id);
  if (!po) throw new Error(`no PO ${id}`);
  const role: Role = po.supplier.toLowerCase() === addressOf("supplierA").toLowerCase() ? "supplierA" : "supplierB";
  return send(role, "markShipped", [BigInt(id), deliveryRefFor(id)]).then((r) => r.hash);
}
