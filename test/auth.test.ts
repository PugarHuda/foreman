import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  cookieFrom,
  hashPassword,
  issueSession,
  sessionCookie,
  validSession,
  verifyPassword,
} from "../lib/auth.ts";

const SECRET = "x".repeat(48);

describe("operator password", () => {
  it("verifies the password it hashed", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
    assert.equal(verifyPassword("correct horse battery stapl", stored), false);
  });

  it("salts, so the same password does not produce the same hash", () => {
    assert.notEqual(hashPassword("same password"), hashPassword("same password"));
  });

  /* A stored value that is empty, truncated or from some other scheme must
     fail closed. Returning true on a malformed hash is how a bad deploy
     becomes an open door. */
  it("refuses a stored hash it does not understand", () => {
    for (const bad of ["", "plain:salt:hash", "scrypt:", "scrypt:aa", "$2b$10$whatever"]) {
      assert.equal(verifyPassword("anything", bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe("session token", () => {
  const prior = process.env.SESSION_SECRET;
  before(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  after(() => {
    if (prior === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prior;
  });

  it("accepts one it just issued", () => {
    assert.equal(validSession(issueSession()), true);
  });

  it("rejects one that has expired", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const token = issueSession("operator", now);
    assert.equal(validSession(token, now + 60_000), true);
    assert.equal(validSession(token, now + 13 * 3_600_000), false);
  });

  /* The expiry is in the token, so the signature is the only thing stopping
     a client from writing its own. */
  it("rejects a token whose expiry was edited", () => {
    const token = issueSession();
    const [, mac] = token.split(".");
    const forged = `${Date.now() + 10 * 365 * 24 * 3_600_000}.${mac}`;
    assert.equal(validSession(forged), false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueSession();
    process.env.SESSION_SECRET = "y".repeat(48);
    assert.equal(validSession(token), false);
    process.env.SESSION_SECRET = SECRET;
  });

  it("rejects nonsense rather than throwing at it", () => {
    for (const bad of [undefined, "", "no-dot", "abc.def", ".", "1.2.3"]) {
      assert.equal(validSession(bad as string | undefined), false, `accepted ${bad}`);
    }
  });

  it("refuses to sign with a secret too short to be one", () => {
    process.env.SESSION_SECRET = "short";
    assert.throws(() => issueSession(), /SESSION_SECRET/);
    process.env.SESSION_SECRET = SECRET;
  });
});

describe("session cookie", () => {
  it("is HttpOnly and SameSite, and Secure once deployed", () => {
    const c = sessionCookie("token", true);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.match(c, /Secure/);
  });

  it("drops Secure on a local dev server, which is not https", () => {
    assert.doesNotMatch(sessionCookie("token", false), /Secure/);
  });

  it("finds its cookie among the others a browser sends", () => {
    const req = new Request("http://x/", {
      headers: { cookie: "other=1; foreman_session=abc.def; another=2" },
    });
    assert.equal(cookieFrom(req), "abc.def");
    assert.equal(cookieFrom(new Request("http://x/")), undefined);
  });
});
