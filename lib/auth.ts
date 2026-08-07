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
import fs from "node:fs";
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

/**
 * The token carries who, as well as until when.
 *
 * A shared password means the audit trail says "the plant" approved a $4,000
 * spindle, which is not an audit trail. The name is inside the signed payload
 * so it cannot be edited without invalidating the signature.
 */
export function issueSession(operator = "operator", nowMs = Date.now()): string {
  /* base64url, not encodeURIComponent: the token is three dot-separated
     fields, and encodeURIComponent leaves a dot alone. An operator called
     "siti a.r" — or anyone identified by an email address — produced a
     four-field token that failed to parse, so the login succeeded and the
     session did not. base64url has no dot in its alphabet. */
  const payload = `${nowMs + SESSION_HOURS * 3_600_000}.${Buffer.from(operator).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

/** The operator this token names, or null if it is not a valid token. */
export function sessionOperator(token: string | undefined, nowMs = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [exp, name, mac] = parts;

  const expected = Buffer.from(sign(`${exp}.${name}`), "hex");
  const actual = Buffer.from(mac, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!(Number(exp) > nowMs)) return null;
  return Buffer.from(name, "base64url").toString("utf8");
}

export const validSession = (token: string | undefined, nowMs = Date.now()): boolean =>
  sessionOperator(token, nowMs) !== null;

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

export interface Operator {
  name: string;
  hash: string;
}

/**
 * The people who may approve spending.
 *
 * OPERATORS_FILE is a JSON array of { name, hash }. A single
 * OPERATOR_PASSWORD_HASH still works and reads as one operator called
 * "operator", so an existing pilot keeps running without being edited.
 */
export function operators(): Operator[] {
  const file = process.env.OPERATORS_FILE;
  if (file) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`${file} must be a non-empty array of { name, hash }`);
    }
    for (const o of parsed) {
      if (!o?.name || typeof o.hash !== "string") {
        throw new Error(`${file}: every operator needs a name and a hash`);
      }
    }
    return parsed as Operator[];
  }
  const single = process.env.OPERATOR_PASSWORD_HASH;
  return single ? [{ name: "operator", hash: single }] : [];
}

/** Whether any operator password is configured at all. */
export const passwordAuthEnabled = () => operators().length > 0;

/**
 * Failed attempts, per operator name.
 *
 * scrypt already makes each guess cost ~100ms, which is most of what a
 * single-operator login needs. This is the rest of it: after enough wrong
 * guesses the name stops being tryable for a while, so an unattended panel on
 * a plant network is not a password oracle with a slow clock.
 *
 * ponytail: in memory, so a restart clears it and a second instance counts
 * separately. Both are acceptable when the alternative is a shared store for
 * lockout state; neither is acceptable if you ever expose this to the open
 * internet, where the answer is a rate limiter in front, not in here.
 */
const LOCK_AFTER = Number(process.env.LOGIN_LOCK_AFTER ?? 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES ?? 15);

const failures = new Map<string, { count: number; until: number }>();

export const resetLockouts = () => failures.clear();

export function lockedUntil(name: string, nowMs = Date.now()): number | null {
  const f = failures.get(name);
  return f && f.until > nowMs ? f.until : null;
}

export function recordFailure(name: string, nowMs = Date.now()): void {
  const f = failures.get(name) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOCK_AFTER) {
    f.until = nowMs + LOCK_MINUTES * 60_000;
    f.count = 0;
  }
  failures.set(name, f);
}

export const clearFailures = (name: string) => failures.delete(name);

/**
 * Checks a name and password against the register.
 *
 * An unknown name is still charged a scrypt hash against a throwaway salt, so
 * "no such operator" and "wrong password" take the same time and the login
 * does not enumerate who works here.
 */
export function authenticate(name: string, password: string): Operator | null {
  const found = operators().find((o) => o.name === name);
  const stored = found?.hash ?? hashPassword("this password matches nothing");
  const ok = verifyPassword(password, stored);
  return ok && found ? found : null;
}
