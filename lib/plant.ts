/**
 * The plant side of the demo: machines, spare-part inventory and suppliers.
 * Stands in for a CMMS/ERP — the agent talks to it through the same tool
 * surface it would use against a real SAP PM or Fiix instance.
 */

export interface Machine {
  id: number;
  tag: string;
  name: string;
  /** Consumable that fails first on this asset. */
  criticalPart: string;
  /**
   * Once severity reaches zone C the consumable no longer saves the machine —
   * a spalling bearing has already scored the shaft — so the remedy escalates
   * to a major assembly. This is what pushes an order over the auto-approve
   * ceiling and into a human's hands.
   */
  escalationPart?: string;
  /** What an unplanned stop costs, USD per hour. Drives the saved-cost claim. */
  downtimeCostPerHour: number;
  /** Seed for the telemetry replay, so each asset has its own signature. */
  seed: number;
  onsetHours: number;
}

export interface Quote {
  supplier: string;
  address: `0x${string}`;
  priceUsd: number;
  leadTimeHours: number;
}

/**
 * How far ahead maintenance buys. Not the same as "the last moment we could
 * order": with zero stock and a confirmed trend, waiting never makes the part
 * cheaper, and a lead time that slips costs a shift of production. Planners
 * order inside the horizon and stop thinking about it.
 */
export const PLANNING_HORIZON_HOURS = 72;

export const MACHINES: Machine[] = [
  {
    id: 7,
    tag: "CNC-07",
    name: "Mazak VCN-530 machining centre",
    criticalPart: "6205-2RS",
    escalationPart: "SPN-880",
    downtimeCostPerHour: 890,
    seed: 42,
    onsetHours: 220,
  },
  {
    id: 2,
    tag: "PRESS-02",
    name: "Aida 200t stamping press",
    criticalPart: "HYD-SEAL-88",
    downtimeCostPerHour: 1450,
    seed: 11,
    /**
     * Degrading, but slowly and late. Its trend is trustworthy and its failure
     * is real — it is simply beyond the planning horizon, which is the one
     * rule nothing else in the demo demonstrates. Without it the only reason
     * the agent ever declines is noisy telemetry, which reads as the agent
     * only knowing one trick.
     */
    onsetHours: 250,
  },
  {
    id: 11,
    tag: "CONV-11",
    name: "Interroll line conveyor",
    criticalPart: "6204-ZZ",
    downtimeCostPerHour: 320,
    seed: 5,
    onsetHours: 1e9,
  },
];

export const PARTS: Record<string, string> = {
  "6205-2RS": "Deep groove ball bearing 25x52x15",
  "6204-ZZ": "Deep groove ball bearing 20x47x14",
  "HYD-SEAL-88": "Hydraulic rod seal kit 88mm",
  "SPN-880": "Spindle cartridge assembly, 880 series",
};

/** On-hand stock. Zero on 6205-2RS is what forces the agent to buy. */
export const INVENTORY: Record<string, number> = {
  "6205-2RS": 0,
  "6204-ZZ": 4,
  "HYD-SEAL-88": 2,
  "SPN-880": 0,
};

function supplierAddress(slot: "a" | "b"): `0x${string}` {
  const env = slot === "a" ? process.env.NEXT_PUBLIC_SUPPLIER_A : process.env.NEXT_PUBLIC_SUPPLIER_B;
  return (env ?? "0x000000000000000000000000000000000000dEaD") as `0x${string}`;
}

/** Quotes are static here; a real deployment would hit supplier APIs. */
export function getQuotes(partNo: string): Quote[] {
  const table: Record<string, Quote[]> = {
    "6205-2RS": [
      { supplier: "Sundara Bearings Sdn Bhd", address: supplierAddress("a"), priceUsd: 180, leadTimeHours: 36 },
      { supplier: "KL Industrial Supply", address: supplierAddress("b"), priceUsd: 214, leadTimeHours: 18 },
    ],
    "6204-ZZ": [
      { supplier: "Sundara Bearings Sdn Bhd", address: supplierAddress("a"), priceUsd: 96, leadTimeHours: 36 },
    ],
    "HYD-SEAL-88": [
      { supplier: "KL Industrial Supply", address: supplierAddress("b"), priceUsd: 340, leadTimeHours: 48 },
    ],
    "SPN-880": [
      { supplier: "Precision Spindle Works", address: supplierAddress("b"), priceUsd: 4000, leadTimeHours: 120 },
    ],
  };
  return table[partNo] ?? [];
}

export function getMachine(id: number): Machine {
  const m = MACHINES.find((x) => x.id === id);
  if (!m) throw new Error(`unknown machine ${id}`);
  return m;
}

export function getStock(partNo: string): number {
  return INVENTORY[partNo] ?? 0;
}

/**
 * The despatch document reference for an order.
 *
 * In a real deployment this comes off the carrier's waybill and travels with
 * the goods — the supplier commits its hash on despatch, and goods-in reads
 * the paper and submits the same reference. Derived from the order id here so
 * the demo carries no hidden state and survives a page reload; swapping in a
 * carrier API changes this one function.
 */
export function waybillFor(poId: number): string {
  // A reference anyone can compute proves nothing: a supplier who never
  // despatched could commit to it, and goods-in "matching" it is ceremony.
  // The salt stands in for a carrier-issued number that is unpredictable and
  // arrives physically with the parts. Set DELIVERY_SALT in production; the
  // fallback keeps the demo self-contained and is documented as such.
  const salt = process.env.DELIVERY_SALT ?? "foreman-demo";
  let h = 2166136261;
  for (const ch of `${salt}:${poId}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return `WB-${String(poId).padStart(4, "0")}-${h.toString(36).toUpperCase().padStart(7, "0")}`;
}

export interface SupplierRecord {
  supplier: string;
  /** Orders they actually got out of the door: Shipped, Released or Fitted. */
  despatched: number;
  /** Funded, promised by a lead time that has since passed, still not shipped. */
  late: number;
  /** 0..1, or null when there is not enough history to say anything. */
  reliability: number | null;
}

/**
 * Supplier reliability, derived from the order book rather than maintained.
 *
 * Every despatch and every settlement is already on chain, so how a supplier
 * has actually performed is a query, not a spreadsheet somebody updates and
 * nobody trusts. A plant switching suppliers can carry this record with it;
 * the supplier cannot quietly revise it.
 *
 * Scored on despatch against the lead time they quoted, and on nothing else.
 * The earlier version scored delivered-versus-cancelled, which was measuring
 * the wrong party: a supplier cannot cancel anything here — only the plant can
 * (`cancelPO`) and only a proposal nobody answered lapses (`expireProposal`).
 * Every cancellation was therefore the plant's own decision, and counting it
 * dragged the supplier under the 0.7 line the agent routes on. A human
 * declining two spindles made the spindle supplier look unreliable.
 *
 * ponytail: a Funded order carries its funding time in `since`, which is why
 * lateness is readable without touching the chain twice. Once an order ships,
 * `since` moves on and how long it took is gone — read the Funded and Shipped
 * events if a plant ever needs the historic figure rather than the live one.
 */
export function supplierRecords(
  pos: readonly { supplier: string; status: string; since: number }[],
  quotes: readonly Quote[],
  nowSeconds: number = Date.now() / 1000,
): SupplierRecord[] {
  return quotes.map((q) => {
    const theirs = pos.filter((p) => p.supplier.toLowerCase() === q.address.toLowerCase());
    const despatched = theirs.filter(
      (p) => p.status === "Shipped" || p.status === "Released" || p.status === "Fitted",
    ).length;
    const late = theirs.filter(
      (p) => p.status === "Funded" && nowSeconds - p.since > q.leadTimeHours * 3600,
    ).length;
    const judged = despatched + late;
    return {
      supplier: q.supplier,
      despatched,
      late,
      // One order is an anecdote. Say nothing until there is a pattern.
      reliability: judged >= 3 ? despatched / judged : null,
    };
  });
}

/** An order still on its way to the plant. Cancelled and Released are done. */
const OPEN_STATUSES = new Set(["Proposed", "Funded", "Shipped"]);

/**
 * How many of a part are already inbound. Stock on the shelf is only half the
 * question: an agent that cannot see its own open orders re-buys the same
 * bearing every time it runs.
 */
export function onOrderCount(
  pos: readonly { partNo: string; status: string }[],
  partNo: string,
): number {
  return pos.filter((p) => p.partNo === partNo && OPEN_STATUSES.has(p.status)).length;
}

/**
 * On-hand stock: what the fixture starts with, plus deliveries that have
 * landed, minus anything issued to a machine.
 *
 * Both halves matter. Without the delivered count the store reads zero
 * immediately after a delivery and the agent buys another one; without the
 * fitted count a part that was bolted onto the machine still sits on the
 * shelf forever, the store looks fuller after every delivery, and eventually
 * the agent stops ordering anything at all.
 */
export function stockOnHand(
  pos: readonly { partNo: string; status: string }[],
  partNo: string,
  /* Passed in rather than read from the fixture, so the store of record can be
     an ERP without this function knowing there is one. */
  baseStock: number = getStock(partNo),
): number {
  const onShelf = pos.filter((p) => p.partNo === partNo && p.status === "Released").length;
  return baseStock + onShelf;
}

/**
 * Downtime avoided if the part lands before the machine reaches Zone D.
 * Deliberately conservative: only the lead-time gap is counted as saved,
 * because that is the window an unplanned stop would actually have cost.
 */
export function avoidedDowntimeUsd(machine: Machine, rulHours: number, leadTimeHours: number): number {
  const gap = Math.max(0, rulHours - leadTimeHours);
  const exposure = Math.min(gap, 24); // one shift-day of exposure, not a fantasy number
  return Math.round(exposure * machine.downtimeCostPerHour);
}
