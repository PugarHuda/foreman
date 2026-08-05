import { NextResponse } from "next/server";
import { runAgent, DEFAULT_ELAPSED_HOURS } from "@/lib/agent.ts";
import { denied } from "@/lib/guard.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One run at a time. Two overlapping runs each read the order book before the
 * other's transaction lands, so both conclude nothing is on order and both
 * buy — which is exactly what happened when two requests were fired at the
 * deployment together.
 *
 * This holds within one server instance. Across instances the on-chain spend
 * permission is still the backstop, and a real deployment would take a lease
 * in shared storage; that is the honest limit of a queue that lives in memory.
 */
let inFlight: Promise<unknown> | null = null;

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;

  const { hours = DEFAULT_ELAPSED_HOURS } = await req.json().catch(() => ({}));

  if (inFlight) {
    return NextResponse.json(
      { error: "The agent is already assessing this line. Wait for it to finish." },
      { status: 409 },
    );
  }

  const run = runAgent(Number(hours));
  inFlight = run;
  try {
    return NextResponse.json(await run);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    inFlight = null;
  }
}
