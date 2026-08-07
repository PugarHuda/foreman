import { appendReadings, telemetrySource, validateReadings } from "@/lib/telemetry.ts";
import { machines } from "@/lib/erp.ts";
import { deniedIngest } from "@/lib/guard.ts";

export const dynamic = "force-dynamic";

/**
 * Where a plant's telemetry lands.
 *
 * A gateway, a historian job or scripts/telemetry-bridge.mjs posts readings
 * here; the file store behind it is the same one the dashboard reads. That is
 * why there is no MQTT client in the web app: the protocol is the bridge's
 * problem, this endpoint speaks the one thing every gateway can already send.
 *
 *   POST /api/telemetry
 *   Authorization: Bearer $TELEMETRY_TOKEN
 *   { "tag": "CNC-07", "readings": [{ "at": "2026-08-07T09:00:00Z", "rms": 3.91 }] }
 */
export async function POST(req: Request) {
  const no = deniedIngest(req);
  if (no) return no;

  if (telemetrySource() !== "file") {
    return Response.json(
      {
        error:
          "TELEMETRY_SOURCE is not 'file' — this instance is replaying the simulation and would ignore anything posted here.",
      },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const { tag, readings } = body as { tag?: unknown; readings?: unknown };

  /* The tag names a file on disk, so it is checked against the asset register
     rather than sanitised. An allowlist cannot be traversed out of, and a
     reading for a machine nobody registered is a misconfigured gateway worth
     hearing about rather than a new file appearing quietly. */
  const known = machines().find((m) => m.tag === tag);
  if (!known) {
    return Response.json(
      {
        error: `Unknown machine tag ${JSON.stringify(tag)}.`,
        known: machines().map((m) => m.tag),
      },
      { status: 404 },
    );
  }

  const checked = validateReadings(readings);
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });

  try {
    appendReadings(known.tag, checked.ok);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, tag: known.tag, accepted: checked.ok.length });
}
