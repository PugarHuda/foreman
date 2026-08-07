import { NextResponse } from "next/server";
import { snapshot, series, DEFAULT_ELAPSED_HOURS } from "@/lib/agent.ts";
import { getState, explorerBase } from "@/lib/chain.ts";
import { MACHINES, getQuotes, avoidedDowntimeUsd, supplierRecords } from "@/lib/plant.ts";

export const dynamic = "force-dynamic";

/** Telemetry only exists over this window; anything outside it is a typo. */
const MIN_HOURS = 1;
const MAX_HOURS = 400;

export async function GET(req: Request) {
  const url = new URL(req.url);

  // A bad query string must never take the dashboard down — fall back to
  // something sane and keep serving.
  const rawHours = Number(url.searchParams.get("hours"));
  const hours = Number.isFinite(rawHours)
    ? Math.min(Math.max(rawHours, MIN_HOURS), MAX_HOURS)
    : DEFAULT_ELAPSED_HOURS;

  const rawMachine = Number(url.searchParams.get("machine"));
  const machineId = MACHINES.some((m) => m.id === rawMachine) ? rawMachine : MACHINES[0].id;

  const machines = snapshot(hours);
  const selected = machines.find((m) => m.id === machineId);

  // The plant view works even before the contracts are deployed, so a missing
  // deployment shows up as one clear banner rather than an empty page.
  let chain = null;
  let chainError: string | null = null;
  try {
    chain = await getState();
  } catch (e) {
    chainError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    hours,
    machineId,
    machines,
    series: series(machineId, hours),
    quotes: getQuotes(selected?.criticalPart ?? ""),
    // Reliability is derived from the order book, not stored anywhere.
    supplierRecords: supplierRecords(chain?.pos ?? [], getQuotes(selected?.criticalPart ?? "")),
    avoidedUsd: avoidedUsd(chain?.pos ?? [], machines),
    explorer: explorerBase(),
    chain,
    chainError,
  });
}

/**
 * What the committed orders are worth: for every order that is actually in
 * flight, the downtime it buys back. Conservative by construction — see
 * avoidedDowntimeUsd, which counts at most one shift of exposure rather than
 * the whole projected outage.
 */
function avoidedUsd(
  pos: {
    status: string;
    machineId: number;
    partNo: string;
    supplier: string;
    rulHoursAtOrder: number;
  }[],
  machines: { id: number; rulHours: number | null }[],
): number {
  /* Money committed to a part that has not reached the store yet. Released and
     Fitted are deliberately out: those savings are banked, and counting one
     but not the other made the strip drop at goods-in for a delivered order
     and again at fitting — the same order leaving "in flight" twice. */
  const inFlight = new Set(["Funded", "Shipped"]);

  // Per machine, not per order. One asset's downtime can only be bought back
  // once — two orders against the same machine do not save it twice, so take
  // the best single order rather than summing them.
  const bestPerMachine = new Map<number, number>();

  for (const po of pos) {
    if (!inFlight.has(po.status)) continue;

    const machine = MACHINES.find((m) => m.id === po.machineId);
    const quote = getQuotes(po.partNo).find(
      (q) => q.address.toLowerCase() === po.supplier.toLowerCase(),
    );
    // The projection recorded on chain when the order was placed, not today's
    // — otherwise moving the run hour rewrites what a past decision was worth.
    if (!machine || !quote || !po.rulHoursAtOrder) continue;

    const saved = avoidedDowntimeUsd(machine, po.rulHoursAtOrder, quote.leadTimeHours);
    bestPerMachine.set(machine.id, Math.max(bestPerMachine.get(machine.id) ?? 0, saved));
  }

  return [...bestPerMachine.values()].reduce((a, b) => a + b, 0);
}
