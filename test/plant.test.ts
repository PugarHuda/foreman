import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onOrderCount, stockOnHand, avoidedDowntimeUsd, getMachine } from "../lib/plant.ts";

const po = (partNo: string, status: string) => ({ partNo, status });

describe("stock coverage", () => {
  it("counts orders still on their way", () => {
    const pos = [po("6205-2RS", "Proposed"), po("6205-2RS", "Funded"), po("6205-2RS", "Shipped")];
    assert.equal(onOrderCount(pos, "6205-2RS"), 3);
  });

  it("does not count orders that are finished or dead", () => {
    const pos = [po("6205-2RS", "Released"), po("6205-2RS", "Cancelled")];
    assert.equal(
      onOrderCount(pos, "6205-2RS"),
      0,
      "a delivered or cancelled order covers nothing that is still coming",
    );
  });

  it("does not let one part's orders cover another", () => {
    const pos = [po("SPN-880", "Funded"), po("6204-ZZ", "Funded")];
    assert.equal(onOrderCount(pos, "6205-2RS"), 0);
  });

  it("reports nothing inbound on an empty order book", () => {
    assert.equal(onOrderCount([], "6205-2RS"), 0);
  });

  it("puts a delivered order on the shelf", () => {
    // 6205-2RS starts at zero in the fixture.
    assert.equal(stockOnHand([], "6205-2RS"), 0);
    assert.equal(
      stockOnHand([po("6205-2RS", "Released")], "6205-2RS"),
      1,
      "a part that arrived and was paid for is stock, not thin air",
    );
  });

  it("does not count an order still in transit as stock", () => {
    const inFlight = [po("6205-2RS", "Funded"), po("6205-2RS", "Shipped")];
    assert.equal(stockOnHand(inFlight, "6205-2RS"), 0);
    assert.equal(onOrderCount(inFlight, "6205-2RS"), 2);
  });

  it("keeps the fixture's existing stock", () => {
    assert.equal(stockOnHand([], "6204-ZZ"), 4);
    assert.equal(stockOnHand([po("6204-ZZ", "Released")], "6204-ZZ"), 5);
  });
});

describe("avoided downtime", () => {
  const cnc = getMachine(7); // $890/h

  it("credits the gap between failure and delivery", () => {
    // 58.4h of life, 36h lead → 22.4h of exposure bought back.
    assert.equal(avoidedDowntimeUsd(cnc, 58.4, 36), Math.round(22.4 * 890));
  });

  it("credits nothing when the part lands after the failure", () => {
    assert.equal(
      avoidedDowntimeUsd(cnc, 34.8, 120),
      0,
      "an order that arrives late buys back no downtime",
    );
  });

  it("caps the claim at one shift rather than the whole outage", () => {
    // A 1000h gap must not be sold as 1000h of avoided downtime.
    assert.equal(avoidedDowntimeUsd(cnc, 1000, 1), 24 * 890);
  });
});
