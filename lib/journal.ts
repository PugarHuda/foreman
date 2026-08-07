/**
 * What the agent decided, and who approved what — kept.
 *
 * The reasoning trace was live-only: it streamed to whoever had the panel
 * open and was gone on reload. The order survives on chain, but "why did we
 * buy this" is exactly the question an auditor asks six months later, and the
 * answer was being thrown away as it was rendered.
 *
 * Two files, because they answer different questions and have different
 * retention: runs.jsonl is the agent's reasoning, actions.jsonl is which
 * operator pressed what. Both append-only.
 *
 * ponytail: JSONL on disk, read by tailing. One shift assessment is a few KB
 * and a plant runs a handful a day, so a year fits in a few MB and grep
 * answers most questions. A database earns its place when you want to query
 * across plants, not before.
 *
 * On a serverless host there is no disk that survives, and this wrote to one
 * anyway — the writes appeared to succeed and the records were gone with the
 * instance. When a store is configured it goes there instead, which is what
 * makes the journal true on Vercel rather than merely quiet.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentStep } from "./agent.ts";
import { push, storeKind, tail } from "./store.ts";

export const journalDir = () => process.env.JOURNAL_DIR ?? "data/journal";

const fileFor = (name: "runs" | "actions") => path.join(journalDir(), `${name}.jsonl`);

export interface RunRecord {
  at: string;
  hours: number;
  summary: string;
  steps: AgentStep[];
  /** Set when a person pressed the button; absent when the schedule ran it. */
  operator?: string;
  trigger: "operator" | "schedule";
  error?: string;
}

export interface ActionRecord {
  at: string;
  operator: string;
  action: string;
  poId: number;
  hash?: string;
  error?: string;
}

/**
 * Never throws. A journal that cannot be written must not fail the run it was
 * describing — losing the note is bad, losing the order is worse. Serverless
 * filesystems are read-only, which is a normal deployment rather than a fault.
 */
function append(name: "runs" | "actions", record: unknown): boolean {
  try {
    const file = fileFor(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    return true;
  } catch (e) {
    console.warn(`[foreman] journal ${name}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function recordRun(run: RunRecord): Promise<boolean> {
  if (storeKind() !== "memory") return push("foreman:runs", JSON.stringify(run));
  return append("runs", run);
}

export async function recordAction(action: ActionRecord): Promise<boolean> {
  if (storeKind() !== "memory") return push("foreman:actions", JSON.stringify(action));
  return append("actions", action);
}

/**
 * The most recent entries, newest first.
 *
 * Reads the whole file and takes the tail. At the size this reaches in a year
 * that is cheaper than the code to seek backwards through it, and it is
 * correct on a file being appended to concurrently, which seeking is not.
 */
function readTail<T>(name: "runs" | "actions", limit: number): T[] {
  try {
    const file = fileFor(name);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const out: T[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        out.push(JSON.parse(lines[i]) as T);
      } catch {
        /* A truncated last line is what a crash mid-append leaves behind.
           Skip it rather than refuse to show the history before it. */
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function recent<T>(name: "runs" | "actions", limit: number): Promise<T[]> {
  if (storeKind() !== "memory") {
    return (await tail(`foreman:${name}`, limit)).flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
  }
  return readTail<T>(name, limit);
}

export const recentRuns = (limit = 20) => recent<RunRecord>("runs", limit);
export const recentActions = (limit = 50) => recent<ActionRecord>("actions", limit);
