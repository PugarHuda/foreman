/**
 * Generate the operator password hash and a session secret.
 *
 *   node scripts/passwd.mjs 'the password'
 *
 * Prints the two lines to put in .env. The password itself is never written
 * anywhere — that is the point of hashing it here rather than storing it.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../lib/auth.ts";

const password = process.argv[2];

if (!password) {
  console.error("usage: node scripts/passwd.mjs 'the password'");
  process.exit(1);
}
if (password.length < 12) {
  // The only thing standing between a stranger and the plant's treasury.
  console.error("Use at least 12 characters.");
  process.exit(1);
}

console.log(`OPERATOR_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`TELEMETRY_TOKEN=${randomBytes(24).toString("hex")}`);
console.log("\nAdd these to .env (and to your host's environment settings).");
console.log("Setting OPERATOR_PASSWORD_HASH turns off the DEMO_SECRET gate.");
