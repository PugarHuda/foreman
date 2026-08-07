import { NextResponse } from "next/server";
import { snapshot, series } from "@/lib/agent.ts";
import { getState, explorerBase } from "@/lib/chain.ts";
import { avoidedDowntimeUsd, supplierRecords } from "@/lib/plant.ts";
import { machines as assets, quotesFor } from "@/lib/erp.ts";
import { telemetrySource, windowFor } from "@/lib/telemetry.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);

  /* The replay is a fixed 400-hour run; live telemetry is however long the
     machine has been reporting. Reading the window off the data is what stops
     a three-day-old pilot offering a slider that runs into next month. */
  const span = windowFor(assets());

  /* A bad query string must never take the dashboard down — fall back to
     something sane and keep serving.

     Read as a string first: Number(null) is 0, and 0 is finite, so an absent
     `hours` used to clamp to the start of the window instead of the default.
     It never showed, because the panel always sends one. */
  const rawHours = url.searchParams.get("hours");
  const asked = rawHours === null ? NaN : Number(rawHours);
  const hours = Number.isFinite(asked)
    ? Math.min(Math.max(asked, span.min), span.max)
    : span.latest;

  const rawMachine = Number(url.searchParams.get("machine"));
  const known = assets();
  const machineId = known.some((m) => m.id === rawMachine) ? rawMachine : known[0].id;

  const machines = await snapshot(hours);
  const selected = machines.find((m) => m.id === machineId);
  const quotes = await quotesFor(selected?.criticalPart ?? "");

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
    hoursMin: span.min,
    hoursMax: span.max,
    live: telemetrySource() === "file",
    machineId,
    machines,
    series: series(machineId, hours),
    quotes,
    // Reliability is derived from the order book, not stored anywhere.
    supplierRecords: supplierRecords(chain?.pos ?? [], quotes),
    avoidedUsd: await avoidedUsd(chain?.pos ?? [], machines),
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
async function avoidedUsd(
  pos: {
    status: string;
    machineId: number;
    partNo: string;
    supplier: string;
    rulHoursAtOrder: number;
  }[],
  machines: { id: number; rulHours: number | null }[],
): Promise<number> {
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

    const machine = assets().find((m) => m.id === po.machineId);
    const quote = (await quotesFor(po.partNo)).find(
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
