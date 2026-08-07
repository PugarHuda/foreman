import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authenticate,
  clearFailures,
  hashPassword,
  issueSession,
  lockedUntil,
  operators,
  recordFailure,
  resetLockouts,
  sessionOperator,
} from "../lib/auth.ts";
import { resetNotifications, shouldSend } from "../lib/notify.ts";

const SECRET = "z".repeat(48);

describe("the operator register", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-ops-"));
  const file = path.join(dir, "operators.json");
  const prior = { ops: process.env.OPERATORS_FILE, single: process.env.OPERATOR_PASSWORD_HASH };

  before(() => {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { name: "siti", hash: hashPassword("siti's long password") },
        { name: "rahmat", hash: hashPassword("rahmat's long password") },
      ]),
    );
  });
  after(() => {
    if (prior.ops === undefined) delete process.env.OPERATORS_FILE;
    else process.env.OPERATORS_FILE = prior.ops;
    if (prior.single === undefined) delete process.env.OPERATOR_PASSWORD_HASH;
    else process.env.OPERATOR_PASSWORD_HASH = prior.single;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    resetLockouts();
    delete process.env.OPERATORS_FILE;
    delete process.env.OPERATOR_PASSWORD_HASH;
  });

  /* A shared password means the audit trail says "the plant" approved a
     $4,000 spindle, which is not an audit trail. */
  it("tells two people apart", () => {
    process.env.OPERATORS_FILE = file;
    assert.equal(authenticate("siti", "siti's long password")?.name, "siti");
    assert.equal(authenticate("rahmat", "rahmat's long password")?.name, "rahmat");
  });

  it("does not accept one person's password for another's account", () => {
    process.env.OPERATORS_FILE = file;
    assert.equal(authenticate("siti", "rahmat's long password"), null);
  });

  it("refuses a name that is not on the register", () => {
    process.env.OPERATORS_FILE = file;
    assert.equal(authenticate("nobody", "siti's long password"), null);
  });

  /* An existing single-password pilot must keep working without being edited. */
  it("still reads a lone OPERATOR_PASSWORD_HASH as one account", () => {
    process.env.OPERATOR_PASSWORD_HASH = hashPassword("the only password");
    assert.deepEqual(
      operators().map((o) => o.name),
      ["operator"],
    );
    assert.equal(authenticate("operator", "the only password")?.name, "operator");
  });

  it("has no operators at all when nothing is configured", () => {
    assert.deepEqual(operators(), []);
  });

  it("refuses a register that is not a list of operators", () => {
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify([{ name: "siti" }]));
    process.env.OPERATORS_FILE = bad;
    assert.throws(() => operators(), /needs a name and a hash/);
  });
});

describe("locking out a guesser", () => {
  beforeEach(() => resetLockouts());

  it("stays open while attempts are within the allowance", () => {
    for (let i = 0; i < 4; i++) recordFailure("siti");
    assert.equal(lockedUntil("siti"), null);
  });

  it("closes after enough wrong guesses, and reopens later", () => {
    const now = Date.parse("2026-08-07T09:00:00Z");
    for (let i = 0; i < 5; i++) recordFailure("siti", now);

    assert.ok(lockedUntil("siti", now), "five wrong guesses should lock the account");
    assert.equal(lockedUntil("siti", now + 16 * 60_000), null, "and it should expire");
  });

  it("locks one account without locking the shift", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) recordFailure("siti", now);
    assert.equal(lockedUntil("rahmat", now), null);
  });

  it("forgets the failures once someone signs in", () => {
    for (let i = 0; i < 4; i++) recordFailure("siti");
    clearFailures("siti");
    for (let i = 0; i < 4; i++) recordFailure("siti");
    assert.equal(lockedUntil("siti"), null, "the counter must start over, not accumulate");
  });
});

describe("the session names who is signed in", () => {
  const prior = process.env.SESSION_SECRET;
  before(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  after(() => {
    if (prior === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prior;
  });

  it("round-trips the operator", () => {
    assert.equal(sessionOperator(issueSession("siti")), "siti");
  });

  it("survives a name that needs encoding", () => {
    assert.equal(sessionOperator(issueSession("siti binti a.r")), "siti binti a.r");
  });

  /* The name is what lands in the journal, so a token whose name can be
     edited is a journal that can be forged. */
  it("rejects a token whose name was swapped", () => {
    const token = issueSession("siti");
    const [exp, , mac] = token.split(".");
    assert.equal(sessionOperator(`${exp}.rahmat.${mac}`), null);
  });

  it("rejects an expired token even with the right name", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(sessionOperator(issueSession("siti", now), now + 13 * 3_600_000), null);
  });
});

describe("not paging the same person twice", () => {
  beforeEach(() => resetNotifications());

  it("sends the first time and stays quiet after", () => {
    const now = Date.now();
    assert.equal(shouldSend("stale:CNC-07", now), true);
    assert.equal(shouldSend("stale:CNC-07", now + 60_000), false);
  });

  it("speaks again once the cooldown has passed", () => {
    const now = Date.now();
    shouldSend("stale:CNC-07", now);
    assert.equal(shouldSend("stale:CNC-07", now + 61 * 60_000), true);
  });

  it("does not let one machine's alert silence another's", () => {
    const now = Date.now();
    shouldSend("stale:CNC-07", now);
    assert.equal(shouldSend("stale:PRESS-02", now), true);
  });
});
