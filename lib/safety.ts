/**
 * The checks that only matter once the money is real.
 *
 * Everything here is inert on testnet and on a local node. On `CHAIN=base` it
 * is the difference between a pilot and an incident: the demo's own gate is a
 * secret that ships to the browser, and pointing a live contract at the mock
 * ERC-20 this repo deploys would settle every invoice in tokens nobody
 * accepts.
 *
 * Blockers refuse to serve. Warnings are printed and let you through, because
 * an operator running a supervised pilot may reasonably accept them and being
 * unable to start is its own kind of failure.
 */
import { USDC_ADDRESS } from "./deployment.ts";
import { canonicalUsdc, isMainnet } from "./chains.ts";

export function mainnetBlockers(): string[] {
  if (!isMainnet()) return [];
  const out: string[] = [];

  if (!process.env.OPERATOR_PASSWORD_HASH) {
    out.push(
      "OPERATOR_PASSWORD_HASH is not set. On mainnet the DEMO_SECRET gate is not acceptable — it ships to the browser. Run `npm run passwd`.",
    );
  }
  if ((process.env.SESSION_SECRET ?? "").length < 32) {
    out.push("SESSION_SECRET is missing or shorter than 32 characters, so sessions cannot be signed.");
  }

  const expected = canonicalUsdc();
  if (expected && USDC_ADDRESS.toLowerCase() !== expected) {
    out.push(
      `The deployed token is ${USDC_ADDRESS}, which is not Circle's USDC on this chain (${expected}). Refusing to settle invoices in it.`,
    );
  }
  return out;
}

export function mainnetWarnings(): string[] {
  if (!isMainnet()) return [];
  const out: string[] = [];

  if (!process.env.AGENT_SIGNER_URL && !process.env.REMOTE_SIGNER_URL) {
    out.push(
      "The agent key is a plain environment variable. Anything that can read the environment can spend up to the monthly cap — put it behind a KMS and set AGENT_SIGNER_URL.",
    );
  }
  if (process.env.SUPPLIER_A_KEY || process.env.SUPPLIER_B_KEY) {
    out.push(
      "A supplier key is on this server. Suppliers should despatch from their own wallet; the contract already requires it.",
    );
  }
  return out;
}

/** Printed once at startup by the routes that can move funds. */
let announced = false;
export function announceOnce(): void {
  if (announced || !isMainnet()) return;
  announced = true;
  for (const w of mainnetWarnings()) console.warn(`[foreman] mainnet warning: ${w}`);
  for (const b of mainnetBlockers()) console.error(`[foreman] mainnet blocker: ${b}`);
}
