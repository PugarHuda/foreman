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
import { resolveWaybill, waybillFor } from "./plant.ts";
import { privateKeyToAccount } from "viem/accounts";
import { FOREMAN_ADDRESS, FOREMAN_ABI, EXPLORER } from "./deployment.ts";
import { activeChain, rpcUrl } from "./chains.ts";
import { remoteAccount, usesRemoteSigner } from "./signer.ts";

export type { Role } from "./signer.ts";
import type { Role } from "./signer.ts";
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

/** A KMS-backed signer if one is configured, otherwise the env-var key. */
function accountFor(role: Role) {
  if (usesRemoteSigner(role)) return remoteAccount(role);
  const pk = process.env[KEY_ENV[role]];
  if (!pk) throw new Error(`${KEY_ENV[role]} missing from .env`);
  return privateKeyToAccount(pk as `0x${string}`);
}

function walletFor(role: Role) {
  return createWalletClient({
    account: accountFor(role),
    chain: activeChain(),
    transport: http(rpcUrl()),
  });
}

export function addressOf(role: Role): Address {
  return accountFor(role).address;
}

/**
 * The agent, as something that can sign EIP-712. Used to pay metered data
 * endpoints over x402 — the same key the contract knows, so anything it
 * spends on data is spent by an identity the plant already vetted.
 */
export function agentSigner() {
  const account = accountFor("agent");
  return {
    address: account.address,
    signTypedData: (args: Parameters<NonNullable<typeof account.signTypedData>>[0]) =>
      account.signTypedData!(args),
  };
}

const foreman = { address: FOREMAN_ADDRESS as Address, abi: FOREMAN_ABI as unknown as Abi };

/** What the supplier commits to on despatch and goods-in checks on arrival. */
export const deliveryRefFor = async (poId: number) =>
  keccak256(stringToHex(await resolveWaybill(poId)));

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
export const confirmReceipt = async (id: number) =>
  send("plant", "confirmReceipt", [BigInt(id), await deliveryRefFor(id)]).then((r) => r.hash);

/** Whether this deployment holds any supplier key at all. */
export const actsForSuppliers = () =>
  Boolean(
    process.env.SUPPLIER_A_KEY ||
      process.env.SUPPLIER_B_KEY ||
      usesRemoteSigner("supplierA") ||
      usesRemoteSigner("supplierB"),
  );

/**
 * Ship as whichever supplier actually owns the PO, committing to the waybill.
 *
 * Only possible because the demo holds every role's key on one box, which is
 * what makes it a demo. In a pilot the supplier despatches from their own
 * wallet against their own PO — the contract already requires it, since
 * `markShipped` reverts for anyone but `po.supplier`. Without their key here,
 * say so rather than failing with a missing-env error that reads like a bug.
 */
export async function markShipped(id: number) {
  if (!actsForSuppliers()) {
    throw new Error(
      "No supplier key on this server. The supplier marks despatch from their own wallet — send them the order id and the waybill.",
    );
  }
  const { pos } = await getState();
  const po = pos.find((p) => p.id === id);
  if (!po) throw new Error(`no PO ${id}`);
  const hasA = Boolean(process.env.SUPPLIER_A_KEY) || usesRemoteSigner("supplierA");
  const role: Role =
    hasA && po.supplier.toLowerCase() === addressOf("supplierA").toLowerCase()
      ? "supplierA"
      : "supplierB";
  return send(role, "markShipped", [BigInt(id), await deliveryRefFor(id)]).then((r) => r.hash);
}
