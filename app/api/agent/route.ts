import { NextResponse } from "next/server";
import { runAgent, DEFAULT_ELAPSED_HOURS } from "@/lib/agent.ts";
import { denied } from "@/lib/guard.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;

  const { hours = DEFAULT_ELAPSED_HOURS } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await runAgent(Number(hours)));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
