/**
 * Paying for the data the agent needs, over HTTP 402.
 *
 * Deliberately NOT how goods are paid for. The whole argument of this project
 * is that a spare part settles into escrow and releases on confirmed receipt —
 * pay-now-get-response-now is the model the contract exists to avoid, and
 * routing a purchase order through here would quietly undo it.
 *
 * Where it does fit is the other kind of money: a supplier's quote API, a
 * bearing-availability feed, a market-rate lookup. Fractions of a cent, per
 * call, to a service that has no idea who Foreman is and should not have to
 * be onboarded to answer. That is what the agent could not do before — it
 * could reason about a purchase but could not buy the information to reason
 * with.
 *
 * Two kinds of money, two sets of rules:
 *
 *   goods  on-chain escrow, allowlisted payee, released on receipt
 *   data   x402, capped per call and per process, one asset, one network
 *
 * ponytail: the `exact` scheme over EIP-3009 only. It is what USDC supports
 * natively and what nearly every 402 endpoint offers; Permit2 and the
 * streaming schemes are a different signature flow and can be added when
 * something Foreman actually needs speaks only those.
 */
import { toHex, type Address, type Hex } from "viem";

export interface X402Accept {
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  /** v2 calls it `amount`, v1 `maxAmountRequired`. Base units, as a string. */
  amount?: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  /** EIP-712 domain of the asset, needed to sign EIP-3009. */
  extra?: { name?: string; version?: string };
}

export interface X402Challenge {
  x402Version: number;
  accepts: X402Accept[];
}

/** Signs the EIP-712 payload. The agent account, or a KMS behind the signer. */
export interface TypedDataSigner {
  address: Address;
  signTypedData: (args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
}

export const amountOf = (a: X402Accept): bigint =>
  BigInt(a.amount ?? a.maxAmountRequired ?? "0");

/**
 * What the agent may spend on data, in base units of the configured asset.
 *
 * Two limits rather than one. Per call stops a single endpoint quoting an
 * absurd price and being paid it; per process stops a cheap endpoint being
 * called in a loop. The second is the one that actually saves you — the first
 * failure mode is obvious in a log, the second is not.
 */
export const maxPerCall = () => BigInt(process.env.X402_MAX_PER_CALL ?? "10000"); // 0.01 USDC
export const maxPerProcess = () => BigInt(process.env.X402_MAX_TOTAL ?? "1000000"); // 1 USDC

let spent = 0n;
export const dataSpend = () => spent;
export const resetDataSpend = () => {
  spent = 0n;
};

export const x402Enabled = () => process.env.X402_ENABLED === "1";

/** Decodes a 402 response into a challenge, or null if it is not one. */
export async function readChallenge(res: Response): Promise<X402Challenge | null> {
  if (res.status !== 402) return null;

  const header = res.headers.get("PAYMENT-REQUIRED");
  try {
    if (header) {
      const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      return Array.isArray(parsed?.accepts) ? (parsed as X402Challenge) : null;
    }
    const body = await res.clone().json();
    return body?.x402Version && Array.isArray(body.accepts) ? (body as X402Challenge) : null;
  } catch {
    return null;
  }
}

export interface Policy {
  /** The only asset that may be spent, and the only network it may move on. */
  asset: Address;
  network: string;
  perCall?: bigint;
}

export type Refusal = { ok: false; reason: string };
export type Selection = { ok: true; accept: X402Accept; amount: bigint };

/**
 * Picks the cheapest offer that satisfies the policy, or explains why none do.
 *
 * Every rejection is named rather than filtered silently: an agent that stops
 * paying for its supplier feed and cannot say which rule stopped it is an
 * outage nobody can diagnose.
 */
export function choose(challenge: X402Challenge, policy: Policy): Selection | Refusal {
  const perCall = policy.perCall ?? maxPerCall();
  const reasons: string[] = [];
  let best: Selection | null = null;

  for (const accept of challenge.accepts ?? []) {
    if (accept.scheme !== "exact") {
      reasons.push(`${accept.scheme} is not a scheme this agent signs`);
      continue;
    }
    if (accept.network !== policy.network) {
      reasons.push(`${accept.network} is not ${policy.network}`);
      continue;
    }
    if (String(accept.asset).toLowerCase() !== policy.asset.toLowerCase()) {
      reasons.push(`${accept.asset} is not the asset this agent may spend`);
      continue;
    }
    const amount = amountOf(accept);
    if (amount <= 0n) {
      reasons.push("an offer with no price is not an offer");
      continue;
    }
    if (amount > perCall) {
      reasons.push(`${amount} is over the ${perCall} per-call limit`);
      continue;
    }
    if (spent + amount > maxPerProcess()) {
      reasons.push(`${amount} would pass the ${maxPerProcess()} spent-on-data limit`);
      continue;
    }
    if (!best || amount < best.amount) best = { ok: true, accept, amount };
  }

  return best ?? { ok: false, reason: reasons.join("; ") || "the server offered nothing payable" };
}

/** A nonce that is not a counter: EIP-3009 replays anything reused. */
const freshNonce = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** The signed authorization, base64-encoded for the `X-PAYMENT` header. */
export async function buildPayment(
  challenge: X402Challenge,
  selection: Selection,
  signer: TypedDataSigner,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const { accept, amount } = selection;

  const authorization = {
    from: signer.address,
    to: accept.payTo,
    value: amount.toString(),
    validAfter: String(nowSeconds - 60),
    validBefore: String(nowSeconds + (accept.maxTimeoutSeconds ?? 300)),
    nonce: freshNonce(),
  };

  const signature = await signer.signTypedData({
    domain: {
      name: accept.extra?.name ?? "USD Coin",
      version: accept.extra?.version ?? "2",
      chainId: Number(accept.network.split(":").pop() ?? 8453),
      verifyingContract: accept.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  return Buffer.from(
    JSON.stringify({
      x402Version: challenge.x402Version ?? 1,
      scheme: accept.scheme,
      network: accept.network,
      payload: { signature, authorization },
    }),
  ).toString("base64");
}

/**
 * fetch, with the ability to pay once for what it asked for.
 *
 * Pays at most once per call: a server that answers a paid request with
 * another 402 is either broken or charging twice, and neither deserves a
 * second signature.
 */
export async function fetchPaid(
  url: string,
  init: RequestInit,
  signer: TypedDataSigner,
  policy: Policy,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402 || !x402Enabled()) return first;

  const challenge = await readChallenge(first);
  if (!challenge) return first;

  const selection = choose(challenge, policy);
  if (!selection.ok) {
    console.warn(`[foreman] x402 refused ${url}: ${selection.reason}`);
    return first;
  }

  const header = await buildPayment(challenge, selection, signer);
  const paid = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), "X-PAYMENT": header },
  });

  /* Counted on a 2xx only. A rejected authorization was never redeemed, and
     charging it against the budget would let a broken endpoint starve the
     agent of the data it needs by failing repeatedly. */
  if (paid.ok) {
    spent += selection.amount;
    console.info(
      `[foreman] x402 paid ${selection.amount} for ${url} (${spent} spent on data this process)`,
    );
  }
  return paid;
}
