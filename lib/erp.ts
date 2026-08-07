/**
 * Plant master data: which machines exist, what is on the shelf, who quotes
 * what. In the demo these are fixtures in plant.ts. In a pilot they come from
 * the systems that already own them — a CMMS for the asset register, an ERP
 * for stock and purchasing.
 *
 * Chosen by PLANT_SOURCE:
 *
 *   fixture (default) the tables in plant.ts
 *   http              a REST endpoint at PLANT_API_URL
 *
 * The asset register is separate from both: a one-machine pilot has a machine
 * list, not an integration, so MACHINES_FILE reads it off a JSON file whatever
 * PLANT_SOURCE says.
 *
 * ponytail: REST with a bearer token, because that is what a middleware team
 * will put in front of SAP PM or Fiix anyway. If you are integrating directly
 * against one product, replace the three fetches here rather than adding a
 * connector layer above them.
 */
import fs from "node:fs";
import { agentSigner } from "./chain.ts";
import { canonicalUsdc, activeChain } from "./chains.ts";
import { fetchPaid, x402Enabled } from "./x402.ts";
import {
  INVENTORY,
  MACHINES,
  PARTS,
  getQuotes as fixtureQuotes,
  type Machine,
  type Quote,
} from "./plant.ts";

export type PlantSource = "fixture" | "http";

export const plantSource = (): PlantSource =>
  process.env.PLANT_SOURCE === "http" ? "http" : "fixture";

const apiUrl = () => (process.env.PLANT_API_URL ?? "").replace(/\/$/, "");

/**
 * Master data changes on the timescale of a purchasing department, and the
 * agent reads stock and quotes several times in one run. Without this, one
 * shift assessment is six round trips to an ERP that is not built for them.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Exposed so a test can start from a known state rather than a warm cache. */
export const clearPlantCache = () => cache.clear();

async function get<T>(path: string): Promise<T> {
  const token = process.env.PLANT_API_TOKEN;
  const url = `${apiUrl()}${path}`;
  const init: RequestInit = {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
  };

  /* A supplier feed that meters itself answers 402 rather than 401. Paying it
     is a different kind of money from paying for the bearing — see x402.ts —
     and it stays off unless X402_ENABLED says otherwise. */
  const res = x402Enabled()
    ? await fetchPaid(url, init, agentSigner(), {
        asset: (process.env.X402_ASSET ?? canonicalUsdc() ?? "0x") as `0x${string}`,
        network: process.env.X402_NETWORK ?? `eip155:${activeChain().id}`,
      })
    : await fetch(url, init);

  if (res.status === 402) {
    throw new Error(
      `plant API ${path}: payment required and not paid. Set X402_ENABLED=1 and fund the agent, or check X402_MAX_PER_CALL.`,
    );
  }
  if (!res.ok) throw new Error(`plant API ${path}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json() as Promise<T>;
}

/**
 * The asset register.
 *
 * Read once at startup, not per request: a machine list that changes while a
 * shift assessment is mid-flight is a worse problem than a stale one, and
 * restarting the app is how a plant adds an asset anyway.
 */
let assets: Machine[] | null = null;

export function machines(): Machine[] {
  if (assets) return assets;

  const file = process.env.MACHINES_FILE;
  if (!file) return (assets = MACHINES);

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${file} must be a non-empty array of machines`);
  }
  for (const m of parsed) {
    if (typeof m.id !== "number" || !m.tag || !m.criticalPart) {
      throw new Error(`${file}: every machine needs a numeric id, a tag and a criticalPart`);
    }
    // Only the replay needs these, and only a fixture has them to give.
    m.seed ??= m.id;
    m.onsetHours ??= 0;
    m.downtimeCostPerHour ??= 0;
  }
  return (assets = parsed as Machine[]);
}

export function machineById(id: number): Machine {
  const m = machines().find((x) => x.id === id);
  if (!m) throw new Error(`unknown machine ${id}`);
  return m;
}

/** What the store says is on the shelf, before anything on chain is counted. */
export async function stockOf(partNo: string): Promise<number> {
  if (plantSource() === "fixture") return INVENTORY[partNo] ?? 0;
  return cached(`stock:${partNo}`, async () => {
    const body = await get<{ onHand?: number }>(`/stock/${encodeURIComponent(partNo)}`);
    return Number(body.onHand ?? 0);
  });
}

/**
 * Who may be paid for this part, at what price, arriving when.
 *
 * This is the list the agent chooses from and the price it is held to, so a
 * malformed row is dropped rather than defaulted: a quote with no address is
 * not a supplier, and a quote with no price would let the agent name one.
 */
export async function quotesFor(partNo: string): Promise<Quote[]> {
  if (plantSource() === "fixture") return fixtureQuotes(partNo);
  return cached(`quotes:${partNo}`, async () => {
    const rows = await get<Quote[]>(`/quotes/${encodeURIComponent(partNo)}`);
    return (Array.isArray(rows) ? rows : []).filter(
      (q) =>
        /^0x[0-9a-fA-F]{40}$/.test(String(q.address)) &&
        Number.isFinite(Number(q.priceUsd)) &&
        Number(q.priceUsd) > 0 &&
        Number.isFinite(Number(q.leadTimeHours)),
    );
  });
}

/** Human-readable part description. Cosmetic, so a miss is not an error. */
export async function describePart(partNo: string): Promise<string> {
  if (plantSource() === "fixture") return PARTS[partNo] ?? "unknown part";
  try {
    const body = await cached(`part:${partNo}`, () =>
      get<{ description?: string }>(`/parts/${encodeURIComponent(partNo)}`),
    );
    return body.description ?? "unknown part";
  } catch {
    return "unknown part";
  }
}
