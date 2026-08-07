import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mainnetBlockers, mainnetWarnings } from "../lib/safety.ts";
import { CANONICAL_USDC } from "../lib/chains.ts";
import { USDC_ADDRESS } from "../lib/deployment.ts";

/**
 * These only bite on CHAIN=base. Everything below sets it deliberately and
 * puts it back, because a test that leaves the process pointed at mainnet is
 * a test that arms the next one.
 */
const KEYS = [
  "CHAIN",
  "OPERATOR_PASSWORD_HASH",
  "SESSION_SECRET",
  "AGENT_SIGNER_URL",
  "REMOTE_SIGNER_URL",
  "SUPPLIER_A_KEY",
  "SUPPLIER_B_KEY",
];

describe("mainnet safety", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("says nothing at all on testnet", () => {
    assert.deepEqual(mainnetBlockers(), []);
    assert.deepEqual(mainnetWarnings(), []);
  });

  it("says nothing on a local node either", () => {
    process.env.CHAIN = "local";
    assert.deepEqual(mainnetBlockers(), []);
  });

  /* The demo gate is a secret that ships in the page bundle. It is a fine
     speed bump for testnet and an open door for real money. */
  it("refuses mainnet without a real operator password", () => {
    process.env.CHAIN = "base";
    const out = mainnetBlockers();
    assert.ok(out.some((b) => b.includes("OPERATOR_PASSWORD_HASH")));
  });

  it("refuses mainnet without a signable session secret", () => {
    process.env.CHAIN = "base";
    process.env.OPERATOR_PASSWORD_HASH = "scrypt:aa:bb";
    process.env.SESSION_SECRET = "too short";
    assert.ok(mainnetBlockers().some((b) => b.includes("SESSION_SECRET")));
  });

  /* The failure this catches is settling every invoice in the mock ERC-20
     this repo deploys, which no supplier can do anything with. */
  it("refuses to settle in a token that is not Circle's USDC", () => {
    process.env.CHAIN = "base";
    process.env.OPERATOR_PASSWORD_HASH = "scrypt:aa:bb";
    process.env.SESSION_SECRET = "s".repeat(48);

    const out = mainnetBlockers();
    const isCanonical = USDC_ADDRESS.toLowerCase() === CANONICAL_USDC[8453];
    assert.equal(
      out.some((b) => b.includes("USDC")),
      !isCanonical,
      "the deployed mock must not pass as mainnet USDC",
    );
  });

  it("warns, but does not block, on an agent key in the environment", () => {
    process.env.CHAIN = "base";
    const warnings = mainnetWarnings();
    assert.ok(warnings.some((w) => w.includes("KMS")));
    assert.ok(
      !mainnetBlockers().some((b) => b.includes("KMS")),
      "a supervised pilot may accept this; being unable to start is its own failure",
    );
  });

  it("warns when a supplier key is on the plant's server", () => {
    process.env.CHAIN = "base";
    process.env.SUPPLIER_A_KEY = "0x" + "11".repeat(32);
    assert.ok(mainnetWarnings().some((w) => w.includes("supplier")));
  });

  it("stops warning about the key once a signer is configured", () => {
    process.env.CHAIN = "base";
    process.env.AGENT_SIGNER_URL = "https://signer.internal/sign";
    assert.ok(!mainnetWarnings().some((w) => w.includes("KMS")));
  });
});
