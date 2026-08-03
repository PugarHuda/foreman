import { NextResponse } from "next/server";
import { snapshot, series, DEFAULT_ELAPSED_HOURS } from "@/lib/agent.ts";
import { getState } from "@/lib/chain.ts";
import { getQuotes } from "@/lib/plant.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? DEFAULT_ELAPSED_HOURS);
  const machineId = Number(url.searchParams.get("machine") ?? 7);

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
    machines: snapshot(hours),
    series: series(machineId, hours),
    quotes: getQuotes(snapshot(hours).find((m) => m.id === machineId)?.criticalPart ?? ""),
    chain,
    chainError,
  });
}
