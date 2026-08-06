/**
 * Bootstrap .env: create it from the example if missing, then generate any
 * burner key that is still blank and write the matching addresses.
 *
 * Idempotent — existing keys are kept, so running it twice is safe.
 */
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Key variable -> the address variable derived from it, if any. */
const ROLES = [
  ["DEPLOYER_KEY", null],
  ["AGENT_KEY", "NEXT_PUBLIC_AGENT_ADDRESS"],
  ["SUPPLIER_A_KEY", "NEXT_PUBLIC_SUPPLIER_A"],
  ["SUPPLIER_B_KEY", "NEXT_PUBLIC_SUPPLIER_B"],
];

if (!fs.existsSync(".env")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("created .env from .env.example");
}

let env = fs.readFileSync(".env", "utf8");

function upsert(name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
}

for (const [keyVar, addrVar] of ROLES) {
  const existing = env.match(new RegExp(`^${keyVar}=(0x[0-9a-fA-F]{64})$`, "m"))?.[1];
  const pk = existing ?? generatePrivateKey();
  const address = privateKeyToAccount(pk).address;

  upsert(keyVar, pk);
  if (addrVar) upsert(addrVar, address);

  const label = addrVar ?? `${keyVar.replace("_KEY", "").toLowerCase()} address`;
  console.log(`${label.padEnd(28)} ${address}${existing ? " (kept)" : " (new)"}`);
}

fs.writeFileSync(".env", env);

const missing = ["VENICE_API_KEY"].filter(
  (v) => !new RegExp(`^${v}=.+$`, "m").test(env),
);
if (missing.length) {
  console.log(`\nStill to fill in by hand: ${missing.join(", ")}`);
  console.log("Everything else has a working default.");
}
