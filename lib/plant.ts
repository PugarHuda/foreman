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
    onsetHours: 1e9, // healthy through the demo window
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
 * Downtime avoided if the part lands before the machine reaches Zone D.
 * Deliberately conservative: only the lead-time gap is counted as saved,
 * because that is the window an unplanned stop would actually have cost.
 */
export function avoidedDowntimeUsd(machine: Machine, rulHours: number, leadTimeHours: number): number {
  const gap = Math.max(0, rulHours - leadTimeHours);
  const exposure = Math.min(gap, 24); // one shift-day of exposure, not a fantasy number
  return Math.round(exposure * machine.downtimeCostPerHour);
}
