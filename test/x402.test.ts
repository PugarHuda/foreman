import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  amountOf,
  buildPayment,
  choose,
  readChallenge,
  resetDataSpend,
  type X402Challenge,
} from "../lib/x402.ts";

const ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const OTHER = "0x0000000000000000000000000000000000000bad1" as const;
const PAYEE = "0x00000000000000000000000000000000000feed01" as const;
const NETWORK = "eip155:8453";

const accept = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  payTo: PAYEE,
  amount: "1000",
  ...over,
});

const challenge = (...accepts: unknown[]): X402Challenge =>
  ({ x402Version: 2, accepts }) as X402Challenge;

const policy = { asset: ASSET, network: NETWORK };

describe("reading a 402", () => {
  it("decodes the header form", async () => {
    const body = { x402Version: 2, accepts: [accept()] };
    const res = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64") },
    });
    const out = await readChallenge(res);
    assert.equal(out?.accepts.length, 1);
  });

  it("decodes the body form", async () => {
    const res = new Response(JSON.stringify({ x402Version: 1, accepts: [accept()] }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal((await readChallenge(res))?.x402Version, 1);
  });

  it("is not fooled by a 200, or by a 402 that carries nothing usable", async () => {
    assert.equal(await readChallenge(new Response("{}", { status: 200 })), null);
    assert.equal(await readChallenge(new Response("not json", { status: 402 })), null);
    assert.equal(await readChallenge(new Response("{}", { status: 402 })), null);
  });

  it("reads either name for the price", () => {
    assert.equal(amountOf(accept({ amount: "42" })), 42n);
    assert.equal(amountOf(accept({ amount: undefined, maxAmountRequired: "43" })), 43n);
    assert.equal(amountOf(accept({ amount: undefined })), 0n);
  });
});

describe("deciding whether to pay", () => {
  beforeEach(() => resetDataSpend());
  afterEach(() => {
    delete process.env.X402_MAX_PER_CALL;
    delete process.env.X402_MAX_TOTAL;
    resetDataSpend();
  });

  it("takes the cheapest offer it is allowed to take", () => {
    const out = choose(challenge(accept({ amount: "5000" }), accept({ amount: "900" })), policy);
    assert.ok(out.ok);
    assert.equal(out.amount, 900n);
  });

  /* The agent's key is the one the contract knows. Letting a random endpoint
     name any asset would make "the plant vetted who gets paid" untrue by a
     different route. */
  it("refuses an asset the plant did not authorise", () => {
    const out = choose(challenge(accept({ asset: OTHER })), policy);
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /not the asset/);
  });

  it("refuses another network", () => {
    const out = choose(challenge(accept({ network: "eip155:1" })), policy);
    assert.equal(out.ok, false);
  });

  it("refuses a scheme it cannot sign rather than guessing", () => {
    const out = choose(challenge(accept({ scheme: "upto" })), policy);
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /not a scheme/);
  });

  it("refuses an offer with no price", () => {
    assert.equal(choose(challenge(accept({ amount: "0" })), policy).ok, false);
  });

  it("refuses a single call priced over the per-call limit", () => {
    process.env.X402_MAX_PER_CALL = "500";
    const out = choose(challenge(accept({ amount: "501" })), policy);
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /per-call limit/);
  });

  it("names every reason when nothing is payable", () => {
    const out = choose(challenge(accept({ scheme: "upto" }), accept({ network: "eip155:1" })), policy);
    assert.equal(out.ok, false);
    // An agent that stops paying and cannot say which rule stopped it is an
    // outage nobody can diagnose.
    assert.match((out as { reason: string }).reason, /not a scheme.*not eip155:8453/s);
  });

  it("says so plainly when the server offered nothing at all", () => {
    const out = choose(challenge(), policy);
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /nothing payable/);
  });
});

describe("signing the authorization", () => {
  it("signs EIP-3009 with a fresh nonce and a bounded window", async () => {
    const seen: Record<string, unknown>[] = [];
    const signer = {
      address: "0x00000000000000000000000000000000000a9e07" as const,
      signTypedData: async (args: Record<string, unknown>) => {
        seen.push(args);
        return "0xdeadbeef" as const;
      },
    };

    const now = 1_800_000_000;
    const sel = choose(challenge(accept()), policy);
    assert.ok(sel.ok);
    const header = await buildPayment(challenge(accept()), sel, signer, now);

    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    assert.equal(decoded.scheme, "exact");
    assert.equal(decoded.payload.authorization.to, PAYEE);
    assert.equal(decoded.payload.authorization.value, "1000");
    assert.equal(Number(decoded.payload.authorization.validBefore) > now, true);
    // EIP-3009 replays anything reused, so the nonce must be random, not a count.
    assert.match(decoded.payload.authorization.nonce, /^0x[0-9a-f]{64}$/);

    const domain = seen[0].domain as Record<string, unknown>;
    assert.equal(domain.verifyingContract, ASSET);
    assert.equal(domain.chainId, 8453);
  });

  it("gives two payments different nonces", async () => {
    const signer = {
      address: "0x00000000000000000000000000000000000a9e07" as const,
      signTypedData: async () => "0xdeadbeef" as const,
    };
    const sel = choose(challenge(accept()), policy);
    assert.ok(sel.ok);

    const nonce = async () =>
      JSON.parse(
        Buffer.from(await buildPayment(challenge(accept()), sel, signer), "base64").toString("utf8"),
      ).payload.authorization.nonce;

    assert.notEqual(await nonce(), await nonce());
  });
});
