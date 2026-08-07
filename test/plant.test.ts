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

  it("takes a fitted part back off the shelf", () => {
    // Without this the store grows on every delivery and the agent, seeing
    // stock it does not have, stops ordering for good.
    assert.equal(stockOnHand([po("6205-2RS", "Fitted")], "6205-2RS"), 0);
    assert.equal(
      stockOnHand([po("6205-2RS", "Released"), po("6205-2RS", "Fitted")], "6205-2RS"),
      1,
      "one delivered and one fitted leaves one on the shelf",
    );
  });

  it("does not treat a fitted part as still on its way", () => {
    assert.equal(onOrderCount([po("6205-2RS", "Fitted")], "6205-2RS"), 0);
  });
});

describe("supplier record", () => {
  const quotes = [
    { supplier: "Reliable Ltd", address: "0xaaa" as `0x${string}`, priceUsd: 100, leadTimeHours: 24 },
    { supplier: "Flaky Ltd", address: "0xbbb" as `0x${string}`, priceUsd: 90, leadTimeHours: 24 },
  ];
  /* A fixed clock, because lateness is measured against one and a test that
     reads the wall is a test that fails at midnight. */
  const NOW = 1_000_000;
  const HOUR = 3600;
  const order = (address: string, status: string, agedHours = 0) => ({
    supplier: address,
    status,
    partNo: "x",
    since: NOW - agedHours * HOUR,
  });

  it("says nothing until there is a pattern", async () => {
    const { supplierRecords } = await import("../lib/plant.ts");
    const [reliable] = supplierRecords([order("0xaaa", "Released")], quotes, NOW);

    assert.equal(reliable.despatched, 1);
    assert.equal(reliable.reliability, null, "one order is an anecdote, not a rating");
  });

  it("rates a supplier once enough orders can be judged", async () => {
    const { supplierRecords } = await import("../lib/plant.ts");
    const pos = [
      order("0xaaa", "Released"),
      order("0xaaa", "Fitted"),
      order("0xaaa", "Shipped"),
      // Took the order, promised 24 hours, still has not despatched.
      order("0xbbb", "Funded", 100),
      order("0xbbb", "Funded", 100),
      order("0xbbb", "Released"),
    ];
    const [reliable, flaky] = supplierRecords(pos, quotes, NOW);

    assert.equal(reliable.reliability, 1, "a fitted part was still despatched");
    assert.equal(flaky.reliability, 1 / 3);
    assert.equal(flaky.late, 2);
  });

  /* The bug this replaced: only the plant can cancel an order — a supplier has
     no way to. Scoring cancellations pushed a supplier under the 0.7 line the
     agent routes on, for decisions the plant made. */
  it("does not blame a supplier for the plant's own cancellations", async () => {
    const { supplierRecords } = await import("../lib/plant.ts");
    const pos = [
      order("0xbbb", "Cancelled"),
      order("0xbbb", "Cancelled"),
      order("0xbbb", "Cancelled"),
      order("0xbbb", "Released"),
    ];
    const [, flaky] = supplierRecords(pos, quotes, NOW);

    assert.equal(flaky.despatched, 1);
    assert.equal(flaky.late, 0);
    assert.equal(flaky.reliability, null, "three plant decisions are not a supplier's record");
  });

  it("does not call an order late while it is still inside the lead time", async () => {
    const { supplierRecords } = await import("../lib/plant.ts");
    const pos = [order("0xaaa", "Funded", 4), order("0xaaa", "Proposed", 900)];
    const [reliable] = supplierRecords(pos, quotes, NOW);

    assert.equal(reliable.late, 0, "24 hours were promised and 4 have passed");
    assert.equal(reliable.reliability, null);
  });

  it("does not credit one supplier with another's history", async () => {
    const { supplierRecords } = await import("../lib/plant.ts");
    const pos = [order("0xAAA", "Released"), order("0xaaa", "Released"), order("0xaaa", "Released")];
    const [reliable, flaky] = supplierRecords(pos, quotes, NOW);

    assert.equal(reliable.despatched, 3, "address comparison must ignore case");
    assert.equal(flaky.despatched, 0);
  });
});

describe("delivery reference", () => {
  it("is not guessable from the order id alone", async () => {
    const { waybillFor } = await import("../lib/plant.ts");

    // A reference anyone could derive proves nothing about a despatch.
    assert.notEqual(waybillFor(0), "WB-000000");
    assert.match(waybillFor(0), /^WB-\d{4}-[0-9A-Z]+$/);
  });

  it("is stable for an order, and different between orders", async () => {
    const { waybillFor } = await import("../lib/plant.ts");

    assert.equal(waybillFor(7), waybillFor(7), "goods-in must reproduce what despatch committed");
    assert.notEqual(waybillFor(7), waybillFor(8));
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
