/**
 * The maintenance agent. Runs on Venice AI (OpenAI-compatible, no data
 * retention — plant telemetry is not kept by the model provider, which is
 * the difference between a pilot a factory will sign and one it will not).
 *
 * The agent reasons; the contract constrains. It cannot spend past the
 * on-chain cap no matter what it decides, and anything above the
 * auto-approve line lands in a human queue instead of executing.
 */
import { simulateBearing, estimateRUL } from "./machine.ts";
import { MACHINES, PARTS, getMachine, getQuotes, getStock, avoidedDowntimeUsd } from "./plant.ts";
import { proposePO, getState } from "./chain.ts";

const VENICE_URL = "https://api.venice.ai/api/v1/chat/completions";

/** Hours of telemetry replayed. The demo advances this to walk the fault in. */
export const DEFAULT_ELAPSED_HOURS = 300;

export interface AgentStep {
  kind: "thought" | "tool" | "action";
  label: string;
  detail: string;
  txHash?: string;
}

export interface AgentRun {
  steps: AgentStep[];
  summary: string;
}

// --- tools the agent may call ---

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_machine_health",
      description:
        "Current vibration severity and projected remaining useful life for one machine. RUL is hours until the bearing reaches ISO 10816-3 Zone D, where the machine must be stopped.",
      parameters: {
        type: "object",
        properties: { machine_id: { type: "integer" } },
        required: ["machine_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_inventory",
      description: "On-hand stock for a part number.",
      parameters: {
        type: "object",
        properties: { part_no: { type: "string" } },
        required: ["part_no"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_supplier_quotes",
      description: "Supplier prices and lead times in hours for a part number.",
      parameters: {
        type: "object",
        properties: { part_no: { type: "string" } },
        required: ["part_no"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_purchase_order",
      description:
        "Commit plant funds to a spare part on-chain. Below the auto-approve ceiling this funds escrow immediately; above it the PO waits for a human. Call this at most once per run.",
      parameters: {
        type: "object",
        properties: {
          machine_id: { type: "integer" },
          part_no: { type: "string" },
          supplier_address: { type: "string" },
          amount_usd: { type: "number" },
          reason: { type: "string", description: "One sentence a technician will read." },
        },
        required: ["machine_id", "part_no", "supplier_address", "amount_usd", "reason"],
      },
    },
  },
] as const;

function healthOf(machineId: number, elapsedHours: number) {
  const m = getMachine(machineId);
  const run = simulateBearing({ seed: m.seed, onsetHours: m.onsetHours }).filter(
    (s) => s.hours <= elapsedHours,
  );
  return { machine: m, health: estimateRUL(run) };
}

export function snapshot(elapsedHours = DEFAULT_ELAPSED_HOURS) {
  return MACHINES.map((m) => {
    const { health } = healthOf(m.id, elapsedHours);
    return {
      id: m.id,
      tag: m.tag,
      name: m.name,
      criticalPart: m.criticalPart,
      downtimeCostPerHour: m.downtimeCostPerHour,
      stock: getStock(m.criticalPart),
      ...health,
    };
  });
}

/** Telemetry series for the dashboard chart. */
export function series(machineId: number, elapsedHours = DEFAULT_ELAPSED_HOURS) {
  const m = getMachine(machineId);
  return simulateBearing({ seed: m.seed, onsetHours: m.onsetHours }).filter(
    (s) => s.hours <= elapsedHours,
  );
}

async function dispatch(name: string, args: any, elapsedHours: number, steps: AgentStep[]) {
  switch (name) {
    case "get_machine_health": {
      const { machine, health } = healthOf(args.machine_id, elapsedHours);
      steps.push({
        kind: "tool",
        label: `get_machine_health(${machine.tag})`,
        detail: `${health.currentRms.toFixed(2)} mm/s RMS, ISO zone ${health.zone}, RUL ${
          health.rulHours ?? "n/a"
        } h (fit r²=${health.r2.toFixed(2)})`,
      });
      return {
        machine: machine.tag,
        critical_part: machine.criticalPart,
        escalation_part: machine.escalationPart ?? null,
        rms_mm_s: health.currentRms,
        iso_zone: health.zone,
        rul_hours: health.rulHours,
        trend_confidence_r2: health.r2,
        downtime_cost_per_hour_usd: machine.downtimeCostPerHour,
      };
    }
    case "check_inventory": {
      const qty = getStock(args.part_no);
      steps.push({
        kind: "tool",
        label: `check_inventory(${args.part_no})`,
        detail: `${qty} on hand — ${PARTS[args.part_no] ?? "unknown part"}`,
      });
      return { part_no: args.part_no, on_hand: qty };
    }
    case "get_supplier_quotes": {
      const quotes = getQuotes(args.part_no);
      steps.push({
        kind: "tool",
        label: `get_supplier_quotes(${args.part_no})`,
        detail: quotes.map((q) => `${q.supplier} $${q.priceUsd} / ${q.leadTimeHours}h`).join(" · ") || "none",
      });
      return { part_no: args.part_no, quotes };
    }
    case "create_purchase_order": {
      const hash = await proposePO(
        args.machine_id,
        args.part_no,
        args.supplier_address,
        args.amount_usd,
      );
      const state = await getState();
      const po = state.pos[state.pos.length - 1];
      steps.push({
        kind: "action",
        label:
          po.status === "Funded"
            ? `PO #${po.id} funded autonomously — $${args.amount_usd}`
            : `PO #${po.id} queued for human approval — $${args.amount_usd}`,
        detail: args.reason,
        txHash: hash,
      });
      return {
        po_id: po.id,
        status: po.status,
        tx_hash: hash,
        note:
          po.status === "Funded"
            ? "Escrow funded from the agent budget."
            : "Above the auto-approve ceiling. A human must approve before funds move.",
      };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

const SYSTEM = `You are Foreman, the maintenance planning agent for a Malaysian precision-machining plant.

Your job each run: check the machines, decide whether a spare part must be bought now, and if so place exactly one purchase order.

Work through three separate decisions in order. Do not merge them.

1. WHICH PART would fix this machine?
   Zone A or B: the consumable in critical_part.
   Zone C or D: the consumable is already too late — a spalling bearing has scored the shaft — so the remedy is escalation_part.

2. DO WE ORDER IT NOW? Only if both hold:
   - on-hand stock of that part is zero, and
   - projected RUL is below the fastest available lead time plus a 24 hour safety margin.
   If stock is on the shelf, or the RUL is comfortably beyond the lead time, do nothing and say why.

3. WHICH SUPPLIER? Among suppliers whose lead time is shorter than the RUL, take the cheapest. If none can beat the RUL, take the fastest and say the part will land late.

Also:
- Never trust a trend with r² below 0.7. Report it and take no action on that machine.
- You are bounded on-chain by a monthly budget and a per-order auto-approve ceiling. Do not check them — the contract enforces them. An order above the ceiling landing in a human queue is the design working, not a failure. Place the correct order and let the contract route it.
- Be terse and use plain sentences. A technician reads this between machine cycles. No tables.

Finish with a two-sentence summary: what you found, and what you did about it.`;

export async function runAgent(elapsedHours = DEFAULT_ELAPSED_HOURS): Promise<AgentRun> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error("VENICE_API_KEY missing from .env");
  const model = process.env.VENICE_MODEL || "claude-opus-5";

  const steps: AgentStep[] = [];
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Shift handover. Machines on this line: ${MACHINES.map((m) => `${m.tag} (id ${m.id})`).join(
        ", ",
      )}. Telemetry is current as of run-hour ${elapsedHours}. Assess and act.`,
    },
  ];

  for (let turn = 0; turn < 8; turn++) {
    const res = await fetch(VENICE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: TOOLS, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error(`Venice ${res.status}: ${await res.text()}`);

    const msg = (await res.json()).choices?.[0]?.message;
    if (!msg) throw new Error("Venice returned no message");
    messages.push(msg);

    if (msg.content?.trim()) {
      steps.push({ kind: "thought", label: "agent", detail: msg.content.trim() });
    }

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return { steps, summary: msg.content?.trim() || "No action taken." };
    }

    for (const call of calls) {
      let result: unknown;
      try {
        result = await dispatch(
          call.function.name,
          JSON.parse(call.function.arguments || "{}"),
          elapsedHours,
          steps,
        );
      } catch (e) {
        result = { error: String(e instanceof Error ? e.message : e) };
        steps.push({ kind: "tool", label: `${call.function.name} failed`, detail: String(e) });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { steps, summary: "Agent hit the turn limit without concluding." };
}

/** Headline number for the dashboard: what the early order is worth. */
export function savingsUsd(machineId: number, leadTimeHours: number, elapsedHours = DEFAULT_ELAPSED_HOURS) {
  const { machine, health } = healthOf(machineId, elapsedHours);
  if (health.rulHours === null) return 0;
  return avoidedDowntimeUsd(machine, health.rulHours, leadTimeHours);
}
