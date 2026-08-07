import { NextResponse } from "next/server";
import { runAgent, DEFAULT_ELAPSED_HOURS, type AgentStep } from "@/lib/agent.ts";
import { denied } from "@/lib/guard.ts";
import { cookieFrom, sessionOperator } from "@/lib/auth.ts";
import { recordRun } from "@/lib/journal.ts";
import { notify } from "@/lib/notify.ts";

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

/** One JSON object per line — no framing to get wrong, and curl reads it. */
const line = (obj: unknown) => new TextEncoder().encode(`${JSON.stringify(obj)}\n`);

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;

  const { hours = DEFAULT_ELAPSED_HOURS } = await req.json().catch(() => ({}));
  const operator = sessionOperator(cookieFrom(req)) ?? undefined;

  if (inFlight) {
    return NextResponse.json(
      { error: "The agent is already assessing this line. Wait for it to finish." },
      { status: 409 },
    );
  }

  /* Streamed rather than returned. A shift assessment takes twenty to forty
     seconds; holding the connection open and answering all at once turns the
     one part worth watching — the agent working through a decision about
     money — into a spinner. */
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(line(obj));
        } catch {
          /* Client hung up. The run finishes regardless: it may already have
             committed funds, and abandoning it half way is worse. */
        }
      };

      const steps: AgentStep[] = [];
      const run = runAgent(Number(hours), {
        onStep: (step: AgentStep) => {
          steps.push(step);
          send({ type: "step", step });
        },
      });
      inFlight = run;

      try {
        const result = await run;
        send({ type: "done", summary: result.summary, hours: result.hours });

        /* Kept, not just streamed. The order survives on chain; why it was
           placed was being thrown away as it rendered, and that is the
           question an auditor asks six months later. */
        recordRun({
          at: new Date().toISOString(),
          hours: result.hours,
          summary: result.summary,
          steps: result.steps,
          operator,
          trigger: operator ? "operator" : "schedule",
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        send({ type: "error", error });
        recordRun({
          at: new Date().toISOString(),
          hours: Number(hours),
          summary: "",
          steps,
          operator,
          trigger: operator ? "operator" : "schedule",
          error,
        });
        void notify({
          kind: "failure",
          key: "agent-failure",
          title: "The maintenance agent could not finish its assessment",
          detail: error,
        });
      } finally {
        inFlight = null;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Nginx and friends will buffer a stream into a single blob otherwise.
      "X-Accel-Buffering": "no",
    },
  });
}
