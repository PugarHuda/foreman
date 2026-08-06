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
import {
  MACHINES,
  PARTS,
  PLANNING_HORIZON_HOURS,
  getMachine,
  getQuotes,
  getStock,
  onOrderCount,
  stockOnHand,
  supplierRecords,
  type SupplierRecord,
} from "./plant.ts";
import { proposePO, getState } from "./chain.ts";

const VENICE_URL = "https://api.venice.ai/api/v1/chat/completions";

/** Hours of telemetry replayed. The demo advances this to walk the fault in. */
export const DEFAULT_ELAPSED_HOURS = 300;

/** A shift assessment that has not concluded in this many turns is stuck. */
export const MAX_TURNS = 8;

export interface AgentStep {
  kind: "thought" | "tool" | "action";
  label: string;
  detail: string;
  txHash?: string;
}

export interface AgentRun {
  steps: AgentStep[];
  summary: string;
  /** The run hour this assessment was made at — the slider may have moved since. */
  hours: number;
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
      description:
        "Stock position for a part number: what is on the shelf, what is already on order, and the two combined as `covered`. A part on its way covers the machine as well as one in the store.",
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

async function dispatch(
  name: string,
  args: any,
  elapsedHours: number,
  record: (step: AgentStep) => void,
  deps: Required<AgentDeps>,
) {
  switch (name) {
    case "get_machine_health": {
      const { machine, health } = healthOf(args.machine_id, elapsedHours);
      record({
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
        planning_horizon_hours: PLANNING_HORIZON_HOURS,
        downtime_cost_per_hour_usd: machine.downtimeCostPerHour,
      };
    }
    case "check_inventory": {
      /* Stock on the shelf is only half the question. An MRP that ignores
         what is already on order re-buys the same part every time it runs —
         which is exactly what this agent did until it could see this. */
      let onHand = getStock(args.part_no);
      let onOrder = 0;
      let orderBookRead = true;
      try {
        const { pos } = await deps.readOrders();
        onHand = stockOnHand(pos, args.part_no);
        onOrder = onOrderCount(pos, args.part_no);
      } catch {
        orderBookRead = false;
      }

      record({
        kind: "tool",
        label: `check_inventory(${args.part_no})`,
        detail: `${onHand} on hand, ${orderBookRead ? onOrder : "?"} already on order — ${
          PARTS[args.part_no] ?? "unknown part"
        }`,
      });

      return {
        part_no: args.part_no,
        on_hand: onHand,
        on_order: orderBookRead ? onOrder : null,
        covered: orderBookRead ? onHand + onOrder : null,
        ...(orderBookRead
          ? {}
          : { warning: "Could not read the order book. Do not order — you cannot tell if one is already in flight." }),
      };
    }
    case "get_supplier_quotes": {
      const quotes = getQuotes(args.part_no);

      // Price and lead time are what a supplier promises. Delivery history is
      // what they have actually done, and it is already on chain.
      let records: SupplierRecord[] = [];
      try {
        const { pos } = await deps.readOrders();
        records = supplierRecords(pos, quotes);
      } catch {
        /* No history is not the same as a bad record — say nothing. */
      }

      const withHistory = quotes.map((q) => {
        const r = records.find((x) => x.supplier === q.supplier);
        return {
          ...q,
          delivered_before: r?.delivered ?? null,
          cancelled_before: r?.cancelled ?? null,
          reliability: r?.reliability ?? null,
        };
      });

      record({
        kind: "tool",
        label: `get_supplier_quotes(${args.part_no})`,
        detail:
          withHistory
            .map((q) => {
              const settled = (q.delivered_before ?? 0) + (q.cancelled_before ?? 0);
              // Too little history is not the same as a bad record.
              const rate =
                q.reliability !== null
                  ? `${Math.round(q.reliability * 100)}% delivered over ${settled}`
                  : settled > 0
                    ? `${q.delivered_before} of ${settled} delivered, too few to rate`
                    : "nothing settled yet";
              return `${q.supplier} $${q.priceUsd} / ${q.leadTimeHours}h · ${rate}`;
            })
            .join("\n") || "none",
      });

      return { part_no: args.part_no, quotes: withHistory };
    }
    case "create_purchase_order": {
      // The contract rejects an unvetted payee anyway. Catching it here just
      // gives the model something it can act on instead of a raw revert.
      const known = getQuotes(args.part_no).map((q) => q.address.toLowerCase());
      if (!known.includes(String(args.supplier_address).toLowerCase())) {
        record({
          kind: "tool",
          label: "create_purchase_order rejected",
          detail: `${args.supplier_address} is not a vetted supplier for ${args.part_no}`,
        });
        return {
          error: "supplier_address is not on the plant's approved list for this part",
          approved_suppliers: getQuotes(args.part_no).map((q) => ({
            supplier: q.supplier,
            address: q.address,
          })),
        };
      }

      // The projection at the moment of the decision, fixed on chain so the
      // order's worth cannot drift as the machine keeps degrading.
      const { health } = healthOf(args.machine_id, elapsedHours);
      const po = await deps.placeOrder(
        args.machine_id,
        args.part_no,
        args.supplier_address,
        args.amount_usd,
        health.rulHours ?? 0,
      );
      record({
        kind: "action",
        label:
          po.status === "Funded"
            ? `PO #${po.id} funded autonomously — $${args.amount_usd}`
            : `PO #${po.id} queued for human approval — $${args.amount_usd}`,
        detail: args.reason,
        txHash: po.hash,
      });
      return {
        po_id: po.id,
        status: po.status,
        tx_hash: po.hash,
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
   - "covered" is zero — that is on-hand stock plus anything already on order, and
   - projected RUL is inside planning_horizon_hours.
   A part already on its way covers the machine just as well as one on the shelf. If "covered" is above zero, say so and order nothing. If the failure is beyond the horizon, say so and order nothing. Otherwise do not wait for the last possible moment: waiting never makes the part cheaper, and a lead time that slips costs a shift.

3. WHICH SUPPLIER? Among suppliers whose lead time is shorter than the RUL, take the cheapest — unless one of them has a reliability on record below 0.7, in which case prefer the next cheapest that does not and say why. Price and lead time are what a supplier promises; delivered_before and reliability are what they have actually done. A null reliability means too little history to judge, not a bad one. If no supplier can beat the RUL, take the fastest and say plainly that the part will land late.

Also:
- Never trust a trend with r² below 0.7. Report it and take no action on that machine.
- You are bounded on-chain by a monthly budget and a per-order auto-approve ceiling. Do not check them — the contract enforces them. An order above the ceiling landing in a human queue is the design working, not a failure. Place the correct order and let the contract route it.
- Be terse and use plain sentences. A technician reads this between machine cycles. No tables, no markdown, no asterisks or headings — this is rendered as plain text on a shop-floor panel.
- Keep the closing summary to two sentences. One machine per sentence at most.

Finish with a two-sentence summary: what you found, and what you did about it.`;

/** One round trip to the model. Swappable so the loop can be tested without one. */
export type ChatFn = (messages: unknown[], tools: unknown) => Promise<any>;

/**
 * Everything the agent reaches outside itself. Injectable so the loop can be
 * exercised without a model provider or a chain — a test that needs Base
 * Sepolia to be up is not a unit test, and takes ten seconds to say so.
 */
export interface AgentDeps {
  chat?: ChatFn;
  /**
   * Called as each step happens rather than after the run.
   *
   * A shift assessment takes twenty to forty seconds. Handing the operator a
   * spinner for all of it and then a wall of text hides the one thing worth
   * watching: the agent reasoning its way to a decision about money.
   */
  onStep?: (step: AgentStep) => void;
  readOrders?: () => Promise<{
    pos: readonly { partNo: string; status: string; supplier: string }[];
  }>;
  placeOrder?: (
    machineId: number,
    partNo: string,
    supplier: `0x${string}`,
    amountUsd: number,
    rulHoursAtOrder: number,
  ) => Promise<{ hash: string; id: number; status: string }>;
}

/**
 * Models to try, in order. One model was a single point of failure on
 * somebody else's infrastructure: if it is busy, rate limited or retired on
 * the morning of a demo, the only button that tells the story stops working.
 * Set VENICE_MODEL to pin the first choice; the rest are the fallback.
 */
const MODEL_FALLBACKS = ["zai-org-glm-5-2", "claude-opus-5", "qwen-3-8-max", "deepseek-v4-pro"];

/** A model that is missing or busy is worth retrying elsewhere; a bad key is not. */
const worthFallingBack = (status: number) => status !== 401 && status !== 403;

const veniceChat: ChatFn = async (messages, tools) => {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error("VENICE_API_KEY missing from .env");

  const preferred = process.env.VENICE_MODEL;
  const models = preferred
    ? [preferred, ...MODEL_FALLBACKS.filter((m) => m !== preferred)]
    : MODEL_FALLBACKS;

  let last = "";
  for (const model of models) {
    const res = await fetch(VENICE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, temperature: 0.2 }),
    });

    if (res.ok) {
      const msg = (await res.json()).choices?.[0]?.message;
      if (msg) return msg;
      last = `${model}: no message in response`;
      continue;
    }

    last = `${model}: ${res.status} ${(await res.text()).slice(0, 160)}`;
    if (!worthFallingBack(res.status)) break;
  }

  throw new Error(`No model answered. Last: ${last}`);
};

export async function runAgent(
  elapsedHours = DEFAULT_ELAPSED_HOURS,
  overrides: AgentDeps = {},
): Promise<AgentRun> {
  const deps: Required<AgentDeps> = {
    chat: overrides.chat ?? veniceChat,
    readOrders: overrides.readOrders ?? getState,
    placeOrder: overrides.placeOrder ?? proposePO,
    onStep: overrides.onStep ?? (() => {}),
  };
  const chat = deps.chat;

  /* Recorded and forwarded in one move, so the caller sees the run unfold
     rather than its transcript afterwards. */
  const steps: AgentStep[] = [];
  const record = (step: AgentStep) => {
    steps.push(step);
    deps.onStep(step);
  };
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Shift handover. Machines on this line: ${MACHINES.map((m) => `${m.tag} (id ${m.id})`).join(
        ", ",
      )}. Telemetry is current as of run-hour ${elapsedHours}. Assess and act.`,
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const msg = await chat(messages, TOOLS);
    messages.push(msg);

    const calls = msg.tool_calls ?? [];

    // The final message is the summary and is returned separately — pushing it
    // as a step too would print it twice on the panel.
    if (msg.content?.trim() && calls.length > 0) {
      record({ kind: "thought", label: "agent", detail: msg.content.trim() });
    }

    if (calls.length === 0) {
      return {
        steps,
        summary: msg.content?.trim() || "No action taken.",
        hours: elapsedHours,
      };
    }

    for (const call of calls) {
      let result: unknown;
      try {
        result = await dispatch(
          call.function.name,
          JSON.parse(call.function.arguments || "{}"),
          elapsedHours,
          record,
          deps,
        );
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);

        if (message.includes("AlreadyOnOrder")) {
          // Not a failure — the contract refusing a duplicate the agent
          // should have caught itself. Say so plainly so it moves on.
          result = {
            error: "This machine already has an open order for that part.",
            retry: false,
            note: "The contract allows one open order per machine and part. Nothing was spent. Report it and take no further action on this machine.",
          };
        } else if (call.function.name === "create_purchase_order") {
          // A write that throws may still have landed — the failure could be
          // in reading it back. Never invite a retry that double-spends.
          result = {
            error: message,
            retry: false,
            note: "The transaction may already be on chain. Do not place this order again. Report the failure and stop.",
          };
        } else {
          result = { error: message };
        }
        record({ kind: "tool", label: `${call.function.name} failed`, detail: message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return {
    steps,
    summary: "Agent hit the turn limit without concluding.",
    hours: elapsedHours,
  };
}

