/**
 * Operator sessions for the endpoints that move money.
 *
 * The demo gate was a shared secret that shipped to the browser in the page
 * bundle — it said so itself, and it was honest about being a speed bump.
 * A pilot needs a password that is never sent to the client, a session that
 * expires, and a cookie a page script cannot read.
 *
 * ponytail: scrypt and HMAC out of node:crypto, one operator password, a
 * stateless signed cookie. No session store, no user table, no auth library.
 * A plant with named operators and per-person audit needs real accounts —
 * that is a schema and a login page, and it replaces this file rather than
 * extending it.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "foreman_session";

/** Long enough for a shift, short enough that a walk-away logs itself out. */
const SESSION_HOURS = 12;

const N = 16384;
const KEYLEN = 32;

/** `scrypt:<salt>:<hash>`, both hex. Written by `npm run passwd`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N });
  // Length is checked first because timingSafeEqual throws on a mismatch, and
  // a thrown comparison is a comparison that leaks by crashing.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters to sign sessions");
  }
  return s;
};

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("hex");

/** A token carrying only its own expiry — there is one operator to identify. */
export function issueSession(nowMs = Date.now()): string {
  const exp = String(nowMs + SESSION_HOURS * 3_600_000);
  return `${exp}.${sign(exp)}`;
}

export function validSession(token: string | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac) return false;

  const expected = Buffer.from(sign(exp), "hex");
  const actual = Buffer.from(mac, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(exp) > nowMs;
}

/** Set-Cookie for a fresh session. Secure everywhere but a local dev server. */
export function sessionCookie(token: string, secure = process.env.NODE_ENV === "production"): string {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function cookieFrom(req: Request): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return undefined;
}

/** Whether an operator password is configured at all. */
export const passwordAuthEnabled = () => Boolean(process.env.OPERATOR_PASSWORD_HASH);
