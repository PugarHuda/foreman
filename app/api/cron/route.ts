import { runAgent, DEFAULT_ELAPSED_HOURS } from "@/lib/agent.ts";
import { machines } from "@/lib/erp.ts";
import { windowFor } from "@/lib/telemetry.ts";
import { recordRun } from "@/lib/journal.ts";
import { notify } from "@/lib/notify.ts";
import { mainnetBlockers } from "@/lib/safety.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The shift assessment, on a schedule.
 *
 * Until now the agent only ran when somebody pressed a button, which makes it
 * a demo of a decision rather than a thing that watches a line. A plant wants
 * it once a shift whether or not anyone has the panel open.
 *
 * Not an in-process timer: the platform already has a scheduler, a timer
 * inside a web server fires twice when you run two instances and not at all
 * while it is being redeployed.
 *
 *   Vercel      vercel.json  { "crons": [{ "path": "/api/cron", "schedule": "0 6,14,22 * * *" }] }
 *   systemd/cron 0 6,14,22 * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_TOKEN" $URL/api/cron
 *
 * ponytail: no in-process lock beyond the one /api/agent already has. Two
 * schedulers firing at once is a configuration mistake, and the on-chain
 * spend permission is the backstop that makes it survivable rather than
 * expensive.
 */
export async function POST(req: Request) {
  const token = process.env.CRON_TOKEN;
  if (!token) {
    return Response.json(
      { error: "CRON_TOKEN is not set — scheduled runs are closed." },
      { status: 503 },
    );
  }

  /* Vercel Cron sends its own header; a system cron sends a bearer. Accept
     either, and nothing else — this endpoint spends money without a human. */
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const blockers = mainnetBlockers();
  if (blockers.length > 0) {
    return Response.json({ error: "Refusing to run unattended.", blockers }, { status: 503 });
  }

  /* The newest hour on record, not a fixed one. A schedule pinned to run-hour
     300 would assess the same moment every night for the rest of the pilot. */
  const hours = windowFor(machines()).latest || DEFAULT_ELAPSED_HOURS;
  const at = new Date().toISOString();

  try {
    const result = await runAgent(hours);
    await recordRun({ at, hours: result.hours, summary: result.summary, steps: result.steps, trigger: "schedule" });

    /* Nobody is watching a scheduled run, so its summary has to travel. The
       approval notice fires from inside the agent; this is the shift report. */
    await notify({
      kind: "budget",
      key: `schedule:${at.slice(0, 13)}`,
      title: `Shift assessment at run hour ${result.hours}`,
      detail: result.summary,
    });

    return Response.json({ ok: true, hours: result.hours, summary: result.summary });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordRun({ at, hours, summary: "", steps: [], trigger: "schedule", error });
    await notify({
      kind: "failure",
      key: "agent-failure",
      title: "The scheduled shift assessment failed",
      detail: error,
    });
    return Response.json({ error }, { status: 500 });
  }
}
