import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendReadings, isStale, parseSeries, seriesFor, validateReadings } from "../lib/telemetry.ts";

describe("reading a historian export", () => {
  it("turns timestamps into hours from the first sample", () => {
    const csv = [
      "at,rms",
      "2026-08-01T00:00:00Z,1.60",
      "2026-08-01T06:00:00Z,1.90",
      "2026-08-02T00:00:00Z,3.20",
    ].join("\n");

    assert.deepEqual(parseSeries(csv), [
      { hours: 0, rms: 1.6 },
      { hours: 6, rms: 1.9 },
      { hours: 24, rms: 3.2 },
    ]);
  });

  it("takes epoch milliseconds as readily as ISO", () => {
    const t0 = Date.parse("2026-08-01T00:00:00Z");
    const csv = `at,rms\n${t0},1.60\n${t0 + 3_600_000},1.70`;
    assert.deepEqual(parseSeries(csv), [
      { hours: 0, rms: 1.6 },
      { hours: 1, rms: 1.7 },
    ]);
  });

  it("leaves an already-relative export alone", () => {
    assert.deepEqual(parseSeries("hours,rms\n0,1.6\n12,2.4"), [
      { hours: 0, rms: 1.6 },
      { hours: 12, rms: 2.4 },
    ]);
  });

  /* "The first column is time" holds right up until somebody exports it the
     other way round, and a silently transposed series reads as a machine that
     has been degrading since the epoch. */
  it("reads the columns off the header rather than assuming an order", () => {
    assert.deepEqual(parseSeries("rms,at\n1.60,0\n1.70,3600000"), [
      { hours: 0, rms: 1.6 },
      { hours: 1, rms: 1.7 },
    ]);
  });

  it("sorts out-of-order rows instead of trusting the file", () => {
    const out = parseSeries("hours,rms\n12,2.4\n0,1.6\n6,1.9");
    assert.deepEqual(
      out.map((s) => s.hours),
      [0, 6, 12],
    );
  });

  it("skips a malformed row rather than losing the machine", () => {
    const out = parseSeries("at,rms\n0,1.6\n,\nbroken,line\n3600000,1.7");
    assert.equal(out.length, 2, "one bad line from a gateway must not blank the panel");
  });

  it("survives a file with no readings in it", () => {
    assert.deepEqual(parseSeries(""), []);
    assert.deepEqual(parseSeries("at,rms"), []);
  });
});

describe("accepting readings from a gateway", () => {
  const ok = (r: unknown) => validateReadings(r);

  it("takes a plausible batch", () => {
    const out = ok([{ at: "2026-08-01T00:00:00Z", rms: 3.9 }]);
    assert.ok("ok" in out);
    assert.equal(out.ok[0].rms, 3.9);
    assert.equal(typeof out.ok[0].at, "number", "stored as epoch ms, not as whatever arrived");
  });

  /* A sensor that starts reporting nulls has to look broken, not healthy. An
     RMS of NaN becomes a machine with no trend, no order, and no alarm. */
  it("refuses a reading that is not a number", () => {
    for (const bad of [{ at: 0, rms: null }, { at: 0, rms: "n/a" }, { at: 0 }]) {
      assert.ok("error" in ok([bad]), `${JSON.stringify(bad)} was accepted`);
    }
  });

  it("refuses a time it cannot read", () => {
    assert.ok("error" in ok([{ at: "last tuesday", rms: 3.9 }]));
  });

  it("refuses a negative reading", () => {
    assert.ok("error" in ok([{ at: 0, rms: -1 }]));
  });

  /* 3.9 mm/s and 3900 µm/s are the same reading, and only one of them stops
     the machine. Catching the unit at the door beats explaining the alarm. */
  it("catches a unit mix-up rather than declaring an emergency", () => {
    const out = ok([{ at: 0, rms: 3900 }]);
    assert.ok("error" in out);
    assert.match(out.error, /µm\/s/);
  });

  it("refuses an empty or oversized batch", () => {
    assert.ok("error" in ok([]));
    assert.ok("error" in ok("not an array"));
    assert.ok("error" in ok(Array.from({ length: 10_001 }, () => ({ at: 0, rms: 1 }))));
  });
});

describe("readings that arrive twice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-telemetry-"));
  const prior = { src: process.env.TELEMETRY_SOURCE, dir: process.env.TELEMETRY_DIR };

  before(() => {
    process.env.TELEMETRY_SOURCE = "file";
    process.env.TELEMETRY_DIR = dir;
  });
  after(() => {
    process.env.TELEMETRY_SOURCE = prior.src ?? "";
    process.env.TELEMETRY_DIR = prior.dir ?? "";
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /* The bridge re-queues a batch whose response it never saw, so a POST that
     succeeded on the way out and failed on the way back arrives twice. A
     duplicated hour bends the log-linear fit towards whatever happened in it. */
  it("stores a batch once, however many times it is sent", () => {
    const batch = [
      { at: 1_000_000_000, rms: 1.6 },
      { at: 1_000_003_600, rms: 1.7 },
    ];
    assert.equal(appendReadings("DUP-01", batch), 2);
    assert.equal(appendReadings("DUP-01", batch), 0, "the replay must store nothing");
    assert.equal(seriesFor({ tag: "DUP-01", seed: 1, onsetHours: 0 }).length, 2);
  });

  it("still takes the genuinely newer readings in a partly-replayed batch", () => {
    appendReadings("DUP-02", [{ at: 2_000_000_000, rms: 1.6 }]);
    const stored = appendReadings("DUP-02", [
      { at: 2_000_000_000, rms: 1.6 },
      { at: 2_000_003_600, rms: 1.8 },
    ]);
    assert.equal(stored, 1);
  });
});

describe("a gateway that stops sending", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-stale-"));
  const prior = { src: process.env.TELEMETRY_SOURCE, dir: process.env.TELEMETRY_DIR };

  before(() => {
    process.env.TELEMETRY_SOURCE = "file";
    process.env.TELEMETRY_DIR = dir;
  });
  after(() => {
    process.env.TELEMETRY_SOURCE = prior.src ?? "";
    process.env.TELEMETRY_DIR = prior.dir ?? "";
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /* A dead gateway leaves a flat tail on a healthy number, which is exactly
     what a machine in good condition looks like. Silence must not read as
     health — that is the same failure as a sensor publishing nulls, and worse,
     because nothing on the panel looks wrong. */
  it("goes stale once its last reading is older than the window", () => {
    const now = Date.now();
    appendReadings("STALE-01", [{ at: now - 30 * 3_600_000, rms: 4.2 }]);
    const samples = seriesFor({ tag: "STALE-01", seed: 1, onsetHours: 0 });

    assert.equal(isStale(samples, "STALE-01", now), true, "30 h of silence is stale");
  });

  it("is not stale while it is still reporting", () => {
    const now = Date.now();
    appendReadings("STALE-02", [{ at: now - 60_000, rms: 4.2 }]);
    const samples = seriesFor({ tag: "STALE-02", seed: 1, onsetHours: 0 });

    assert.equal(isStale(samples, "STALE-02", now), false);
  });

  it("never calls the replay stale, because it has no clock to be late against", () => {
    process.env.TELEMETRY_SOURCE = "sim";
    assert.equal(isStale([{ hours: 0, rms: 1.6 }], "CNC-07", Date.now()), false);
    process.env.TELEMETRY_SOURCE = "file";
  });
});
