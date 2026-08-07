/**
 * Where vibration samples come from.
 *
 * The demo replays a synthetic run-to-failure signature. A pilot reads the
 * real thing. Both hand back the same `Sample[]`, so nothing downstream —
 * the RUL fit, the agent's tools, the trend chart — knows which it got.
 *
 * Two sources, chosen by TELEMETRY_SOURCE:
 *
 *   sim   (default) the replay in machine.ts. Deterministic, offline, free.
 *   file            a directory of per-machine CSVs.
 *
 * `file` deliberately covers both ways real data arrives. A historian export
 * is a CSV you drop in the directory; a live gateway is a CSV that
 * /api/telemetry appends to as samples land. One reader, one storage format,
 * one thing to back up — rather than a provider per protocol, all of which
 * would end up parsing the same two columns.
 *
 * ponytail: flat files, not a time-series database. One machine at 2 samples
 * a minute is ~1 MB a month and the whole file is read per request, which is
 * nothing at pilot scale. Move to Postgres/Timescale when a second line
 * arrives or when reads start showing up in the response time.
 */
import fs from "node:fs";
import path from "node:path";
import { simulateBearing, type Sample } from "./machine.ts";

export type TelemetrySource = "sim" | "file";

export const telemetrySource = (): TelemetrySource =>
  process.env.TELEMETRY_SOURCE === "file" ? "file" : "sim";

/** Where per-machine CSVs live. One file per machine tag: CNC-07.csv */
export const telemetryDir = () => process.env.TELEMETRY_DIR ?? "data/telemetry";

const fileFor = (tag: string) => path.join(telemetryDir(), `${tag}.csv`);

/**
 * A reading a plant would actually send. Rejected rather than coerced: a
 * sensor that starts reporting nulls must look broken, not healthy, and an
 * RMS of NaN silently becomes a machine with no trend and no order.
 */
export interface Reading {
  /** ISO 8601, or epoch milliseconds. */
  at: string | number;
  /** Vibration velocity, mm/s RMS. */
  rms: number;
}

/** Physically implausible on a 15-75 kW machine; almost certainly a unit mix-up. */
const MAX_PLAUSIBLE_RMS = 200;

/**
 * Number(), minus the coercions that turn a broken sensor into a healthy one.
 *
 * `Number(null)`, `Number("")` and `Number([])` are all 0 — so a gateway that
 * starts publishing nulls reads as a machine sitting at 0 mm/s, which is not
 * "no data", it is the healthiest reading the scale has. Absent has to be
 * NaN, so it can be rejected.
 */
function strictNumber(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  if (typeof v !== "number" && typeof v !== "string") return NaN;
  return Number(v);
}

export function validateReadings(input: unknown): { ok: Reading[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "expected an array of readings" };
  if (input.length === 0) return { error: "no readings" };
  if (input.length > 10_000) return { error: "at most 10000 readings per request" };

  const ok: Reading[] = [];
  for (const [i, r] of input.entries()) {
    const at = (r as Reading)?.at;
    const rms = strictNumber((r as Reading)?.rms);
    const asNumber = strictNumber(at);
    const ms = Number.isFinite(asNumber) ? asNumber : Date.parse(String(at));

    if (!Number.isFinite(ms)) return { error: `reading ${i}: "at" is not a time` };
    if (!Number.isFinite(rms)) return { error: `reading ${i}: "rms" is not a number` };
    if (rms < 0) return { error: `reading ${i}: rms is negative` };
    if (rms > MAX_PLAUSIBLE_RMS) {
      return { error: `reading ${i}: rms ${rms} mm/s is implausible — is the sensor reporting µm/s?` };
    }
    ok.push({ at: ms, rms });
  }
  return { ok };
}

/**
 * Append readings for one machine. Called by /api/telemetry, which is what a
 * gateway or a bridge script posts to.
 *
 * Epoch milliseconds go on disk rather than the run-hour the rest of the app
 * works in: hours are relative to whenever the series happens to start, and
 * appending to a file whose meaning shifts with its first row is how a
 * historian backfill silently rewrites every reading after it.
 */
export function appendReadings(tag: string, readings: Reading[]): number {
  const file = fileFor(tag);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exists = fs.existsSync(file);

  /* Anything at or before the newest reading on file is dropped.
     scripts/telemetry-bridge.mjs re-queues a batch whose response it never
     saw, so a POST that succeeded on the way out and failed on the way back
     arrives twice — and a duplicated hour bends the log-linear fit towards
     whatever happened during it. Idempotent on the receiving side is cheaper
     than exactly-once on the sending side. */
  const newest = exists ? lastTimestamp(file) : -Infinity;
  const fresh = readings.filter((r) => Number(r.at) > newest);
  if (fresh.length === 0) return 0;

  const header = exists ? "" : "at,rms\n";
  const rows = fresh.map((r) => `${r.at},${r.rms}\n`).join("");
  fs.appendFileSync(file, header + rows);
  return fresh.length;
}

/** The newest timestamp on file, or -Infinity if there is nothing to compare. */
function lastTimestamp(file: string): number {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const cell = lines[i].split(",")[0]?.trim();
    if (!cell || cell === "at") continue;
    const t = Number.isFinite(Number(cell)) ? Number(cell) : Date.parse(cell);
    if (Number.isFinite(t)) return t;
  }
  return -Infinity;
}

/**
 * How long a machine may go quiet before its readings stop counting as
 * current.
 *
 * A gateway that dies mid-shift leaves a series that ends on a healthy
 * number, and a flat tail is exactly what a machine in good condition looks
 * like — so silence would read as health, which is the same failure as a
 * sensor publishing nulls and worse, because nothing looks wrong.
 */
export const stalenessHours = () => Number(process.env.TELEMETRY_STALE_HOURS ?? 6);

/** Whether this machine's newest reading is recent enough to act on. */
export function isStale(samples: Sample[], tag: string, nowMs = Date.now()): boolean {
  if (telemetrySource() === "sim" || samples.length === 0) return false;
  const file = fileFor(tag);
  if (!fs.existsSync(file)) return false;
  const newest = lastTimestamp(file);
  if (!Number.isFinite(newest)) return false;
  return nowMs - newest > stalenessHours() * 3_600_000;
}

/**
 * Parse a CSV of readings into the run-hour series the app works in.
 *
 * Accepts what a historian actually exports: `at,rms` in epoch ms or ISO, or
 * `hours,rms` already relative. Column order is read off the header when
 * there is one, because "the first column is time" is true right up until
 * somebody exports it the other way round.
 */
export function parseSeries(csv: string): Sample[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  let timeCol = 0;
  let rmsCol = 1;
  let relative = false;
  let start = 0;

  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  if (head.some((h) => Number.isNaN(Number(h)) && h !== "")) {
    const t = head.findIndex((h) => h === "at" || h === "time" || h === "timestamp" || h === "hours");
    const r = head.findIndex((h) => h === "rms" || h === "value" || h === "mm/s");
    if (t >= 0) timeCol = t;
    if (r >= 0) rmsCol = r;
    relative = head[timeCol] === "hours";
    start = 1;
  }

  const rows: { t: number; rms: number }[] = [];
  for (const line of lines.slice(start)) {
    const cells = line.split(",");
    const raw = cells[timeCol]?.trim();
    const rms = strictNumber(cells[rmsCol]);
    const asNumber = strictNumber(raw);
    const t = Number.isFinite(asNumber) ? asNumber : Date.parse(String(raw));
    // A malformed row is skipped, not fatal: one bad line from a gateway must
    // not take the panel down for a machine that is otherwise reporting.
    if (!Number.isFinite(t) || !Number.isFinite(rms) || rms < 0) continue;
    rows.push({ t, rms });
  }
  if (rows.length === 0) return [];

  rows.sort((a, b) => a.t - b.t);
  const t0 = rows[0].t;
  return rows.map((r) => ({
    hours: relative ? Number(r.t.toFixed(2)) : Number(((r.t - t0) / 3_600_000).toFixed(2)),
    rms: Number(r.rms.toFixed(4)),
  }));
}

export interface MachineTelemetry {
  tag: string;
  seed: number;
  onsetHours: number;
}

/** The full series for a machine, newest last. Empty if it has never reported. */
export function seriesFor(m: MachineTelemetry): Sample[] {
  if (telemetrySource() === "sim") {
    return simulateBearing({ seed: m.seed, onsetHours: m.onsetHours });
  }
  const file = fileFor(m.tag);
  if (!fs.existsSync(file)) return [];
  return parseSeries(fs.readFileSync(file, "utf8"));
}

/**
 * The run-hour range the slider may span.
 *
 * The replay is a fixed 400-hour run. Real telemetry is however long the
 * machine has been reporting, which is not known until it has — so the panel
 * has to read the window off the data rather than off a constant, or a pilot
 * on its third day shows a slider ending 397 hours into the future.
 */
export function windowFor(machines: MachineTelemetry[]): { min: number; max: number; latest: number } {
  if (telemetrySource() === "sim") return { min: 1, max: 400, latest: 300 };

  const latest = machines.reduce((acc, m) => {
    const s = seriesFor(m);
    return Math.max(acc, s.length ? s[s.length - 1].hours : 0);
  }, 0);
  // A machine that has only just started reporting still needs a usable
  // slider, so never hand back a zero-width range.
  return { min: 1, max: Math.max(1, Math.ceil(latest)), latest: Math.max(1, latest) };
}
