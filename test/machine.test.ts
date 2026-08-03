import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateBearing, estimateRUL, zoneOf, ISO_10816_CLASS_II } from "../lib/machine.ts";

describe("bearing health", () => {
  it("maps RMS onto the ISO 10816-3 severity zones", () => {
    assert.equal(zoneOf(1.6), "A");
    assert.equal(zoneOf(ISO_10816_CLASS_II.zoneAB), "A");
    assert.equal(zoneOf(3.5), "B");
    assert.equal(zoneOf(5.0), "C");
    assert.equal(zoneOf(9.9), "D");
  });

  it("reports no RUL while the bearing is healthy", () => {
    const flat = simulateBearing({ hours: 100, onsetHours: 1e9 });
    const h = estimateRUL(flat);
    assert.equal(h.zone, "A");
    assert.equal(h.rulHours, null, "a flat trend must not be read as imminent failure");
  });

  it("projects a finite RUL once the fault is growing", () => {
    const run = simulateBearing();
    const atFault = run.filter((s) => s.hours <= 300);
    const h = estimateRUL(atFault);

    assert.ok(h.growthPerHour > 0, "should detect growth");
    assert.ok(h.r2 > 0.7, `fit should be confident, got r2=${h.r2}`);
    assert.ok(h.rulHours !== null && h.rulHours > 0, "should project a positive RUL");
    assert.ok(h.rulHours! < 200, `RUL should be near-term, got ${h.rulHours}h`);
  });

  it("shrinks RUL as the machine gets closer to Zone D", () => {
    const run = simulateBearing();
    const early = estimateRUL(run.filter((s) => s.hours <= 290)).rulHours;
    const later = estimateRUL(run.filter((s) => s.hours <= 320)).rulHours;

    assert.ok(early !== null && later !== null);
    assert.ok(later! < early!, `RUL should fall over time: ${early} -> ${later}`);
  });

  it("replays identically for a given seed", () => {
    const a = simulateBearing({ seed: 7 });
    const b = simulateBearing({ seed: 7 });
    assert.deepEqual(a, b, "demo replay must be deterministic");
  });

  it("crosses into Zone D by the end of the run", () => {
    const run = simulateBearing();
    assert.equal(zoneOf(run[run.length - 1].rms), "D");
  });
});
