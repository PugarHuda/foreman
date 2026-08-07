import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgent, MAX_TURNS, type ChatFn } from "../lib/agent.ts";
import { getQuotes } from "../lib/plant.ts";

/** Whatever the app currently considers vetted — not a hardcoded copy of it,
    which silently inverts these tests when the environment differs. */
const APPROVED = getQuotes("6205-2RS")[0].address;
const UNVETTED = "0x00000000000000000000000000000000deadbeef" as const;

/**
 * The loop with the model and the chain both replaced. Nothing here touches a
 * network: a unit test that needs Base Sepolia to be up is not a unit test,
 * and takes ten seconds to tell you so.
 */
const reply = (content: string, calls: { name: string; args: object }[] = []) => ({
  role: "assistant",
  content,
  tool_calls: calls.map((c, i) => ({
    id: `call_${i}`,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  })),
});

/** Plays the given replies in order, recording what it was sent. */
function scripted(replies: unknown[]) {
  const seen: unknown[][] = [];
  const chat: ChatFn = async (messages) => {
    seen.push(structuredClone(messages) as unknown[]);
    return replies[Math.min(seen.length - 1, replies.length - 1)];
  };
  return { chat, seen };
}

const emptyBook = async () => ({ pos: [] });

/** A chain that accepts orders and remembers them. */
function fakeChain(pos: { partNo: string; status: string; supplier: string; since: number }[] = []) {
  const placed: { partNo: string; amountUsd: number }[] = [];
  return {
    placed,
    readOrders: async () => ({ pos }),
    placeOrder: async (
      _machineId: number,
      partNo: string,
      _supplier: `0x${string}`,
      amountUsd: number,
    ) => {
      placed.push({ partNo, amountUsd });
      return {
        hash: `0x${"ab".repeat(32)}`,
        id: placed.length - 1,
        status: amountUsd <= 500 ? "Funded" : "Proposed",
      };
    },
  };
}

const order = (amountUsd: number, part = "6205-2RS") => ({
  name: "create_purchase_order",
  args: {
    machine_id: 7,
    part_no: part,
    supplier_address: APPROVED,
    amount_usd: amountUsd,
    reason: "bearing is failing",
  },
});

const toolReplies = (messages: unknown[]) =>
  messages.filter((m) => (m as { role: string }).role === "tool") as { content: string }[];

describe("agent loop", () => {
  it("returns the closing message once the model stops calling tools", async () => {
    const { chat } = scripted([reply("Nothing needs ordering this shift.")]);
    const run = await runAgent(300, { chat, readOrders: emptyBook });

    assert.equal(run.summary, "Nothing needs ordering this shift.");
    assert.deepEqual(run.steps, [], "a closing message is the summary, not a step");
    assert.equal(run.hours, 300, "the run must report the hour it assessed");
  });

  it("reports the hour it assessed, not the default", async () => {
    const { chat } = scripted([reply("Nothing to do.")]);
    assert.equal((await runAgent(276, { chat, readOrders: emptyBook })).hours, 276);
  });

  it("feeds tool results back to the model", async () => {
    const { chat, seen } = scripted([
      reply("Checking.", [{ name: "get_machine_health", args: { machine_id: 7 } }]),
      reply("CNC-07 is degrading but covered."),
    ]);

    const run = await runAgent(300, { chat, readOrders: emptyBook });

    const payload = JSON.parse(toolReplies(seen[1])[0].content);
    assert.equal(payload.machine, "CNC-07");
    assert.equal(payload.iso_zone, "B");
    assert.ok(payload.rul_hours > 0);
    assert.equal(payload.planning_horizon_hours, 72);

    assert.equal(run.summary, "CNC-07 is degrading but covered.");
    assert.equal(run.steps.filter((s) => s.kind === "tool").length, 1);
  });

  it("reports a failed tool call to the model instead of throwing", async () => {
    const { chat, seen } = scripted([
      reply("Checking.", [{ name: "get_machine_health", args: { machine_id: 999 } }]),
      reply("That machine is not on this line."),
    ]);

    const run = await runAgent(300, { chat, readOrders: emptyBook });

    assert.match(JSON.parse(toolReplies(seen[1])[0].content).error, /unknown machine/);
    assert.ok(run.steps.some((s) => s.label.includes("failed")));
  });

  it("gives up rather than looping forever", async () => {
    const { chat, seen } = scripted([
      reply("Again.", [{ name: "check_inventory", args: { part_no: "6205-2RS" } }]),
    ]);

    const run = await runAgent(300, { chat, readOrders: emptyBook });

    assert.equal(seen.length, MAX_TURNS, "should stop at the turn limit");
    assert.match(run.summary, /turn limit/);
  });
});

describe("streaming", () => {
  it("reports each step as it happens, not at the end", async () => {
    const seen: string[] = [];
    const { chat } = scripted([
      reply("Checking.", [{ name: "get_machine_health", args: { machine_id: 7 } }]),
      reply("Checking stock.", [{ name: "check_inventory", args: { part_no: "6205-2RS" } }]),
      reply("Nothing needed."),
    ]);

    const run = await runAgent(300, {
      chat,
      readOrders: emptyBook,
      onStep: (step) => seen.push(step.label),
    });

    assert.deepEqual(
      seen,
      run.steps.map((s) => s.label),
      "everything recorded must also have been streamed",
    );
    assert.ok(seen.some((l) => l.startsWith("get_machine_health")));
    assert.ok(seen.some((l) => l.startsWith("check_inventory")));
  });

  it("streams a failure rather than swallowing it until the end", async () => {
    const seen: string[] = [];
    const { chat } = scripted([
      reply("Checking.", [{ name: "get_machine_health", args: { machine_id: 999 } }]),
      reply("Not on this line."),
    ]);

    await runAgent(300, { chat, readOrders: emptyBook, onStep: (s) => seen.push(s.label) });
    assert.ok(seen.some((l) => l.includes("failed")));
  });
});

describe("placing an order", () => {
  it("records an autonomous order as signed by the agent", async () => {
    const chain = fakeChain();
    const { chat } = scripted([reply("Ordering.", [order(180)]), reply("Done.")]);

    const run = await runAgent(300, { chat, ...chain });

    assert.deepEqual(chain.placed, [{ partNo: "6205-2RS", amountUsd: 180 }]);
    const action = run.steps.find((s) => s.kind === "action")!;
    assert.match(action.label, /funded autonomously/);
    assert.ok(action.txHash, "the step must carry the transaction for the operator to check");
  });

  it("records an order over the ceiling as queued for a human", async () => {
    const chain = fakeChain();
    const { chat, seen } = scripted([reply("Ordering.", [order(4000, "SPN-880")]), reply("Done.")]);

    const run = await runAgent(320, { chat, ...chain });

    assert.match(run.steps.find((s) => s.kind === "action")!.label, /queued for human approval/);
    const result = JSON.parse(toolReplies(seen[1])[0].content);
    assert.equal(result.status, "Proposed");
    assert.match(result.note, /human must approve/);
  });

  it("refuses to pay a supplier the plant has not vetted", async () => {
    const chain = fakeChain();
    const bad = order(180);
    bad.args.supplier_address = UNVETTED;
    const { chat, seen } = scripted([reply("Ordering.", [bad]), reply("Stopped.")]);

    await runAgent(300, { chat, ...chain });

    assert.deepEqual(chain.placed, [], "the write must never be attempted");
    const result = JSON.parse(toolReplies(seen[1])[0].content);
    assert.match(result.error, /not on the plant's approved list/);
    assert.ok(result.approved_suppliers.length > 0, "tell the model who it may pay");
  });

  /* The allowlist bounds who gets paid and the cap bounds the total. Neither
     binds the figure, so a decimal point in the wrong place was a vetted
     supplier being handed ten times their quote, inside budget. */
  it("refuses to pay a vetted supplier an amount they did not quote", async () => {
    const chain = fakeChain();
    const { chat, seen } = scripted([reply("Ordering.", [order(1800)]), reply("Stopped.")]);

    await runAgent(300, { chat, ...chain });

    assert.deepEqual(chain.placed, [], "the write must never be attempted");
    const result = JSON.parse(toolReplies(seen[1])[0].content);
    assert.match(result.error, /quoted price/);
    assert.equal(result.quoted_price_usd, getQuotes("6205-2RS")[0].priceUsd);
  });

  it("tells the model not to retry an order that may already be on chain", async () => {
    const { chat, seen } = scripted([reply("Ordering.", [order(180)]), reply("Could not order.")]);

    await runAgent(300, {
      chat,
      readOrders: emptyBook,
      placeOrder: async () => {
        throw new Error("HTTP request failed: over rate limit");
      },
    });

    const result = JSON.parse(toolReplies(seen[1])[0].content);
    assert.equal(result.retry, false);
    assert.match(result.note, /Do not place this order again/);
  });

  it("passes on the contract's refusal of a duplicate without alarming the model", async () => {
    const { chat, seen } = scripted([reply("Ordering.", [order(180)]), reply("Already covered.")]);

    await runAgent(300, {
      chat,
      readOrders: emptyBook,
      placeOrder: async () => {
        throw new Error('reverted with custom error "AlreadyOnOrder()"');
      },
    });

    const result = JSON.parse(toolReplies(seen[1])[0].content);
    assert.match(result.error, /already has an open order/);
    assert.match(result.note, /Nothing was spent/);
    assert.equal(result.retry, false);
  });
});

describe("degraded chain", () => {
  it("will not order when it cannot see the order book", async () => {
    const { chat, seen } = scripted([
      reply("Checking.", [{ name: "check_inventory", args: { part_no: "6205-2RS" } }]),
      reply("Cannot confirm stock; taking no action."),
    ]);

    await runAgent(300, {
      chat,
      readOrders: async () => {
        throw new Error("over rate limit");
      },
    });

    const stock = JSON.parse(toolReplies(seen[1])[0].content);
    assert.equal(stock.covered, null, "an unknown position must not read as zero");
    assert.equal(stock.on_order, null);
    assert.match(stock.warning, /Do not order/);
  });

  it("counts a part already in transit as covered", async () => {
    const chain = fakeChain([
      { partNo: "6205-2RS", status: "Funded", supplier: APPROVED, since: 0 },
      { partNo: "6205-2RS", status: "Cancelled", supplier: APPROVED, since: 0 },
    ]);
    const { chat, seen } = scripted([
      reply("Checking.", [{ name: "check_inventory", args: { part_no: "6205-2RS" } }]),
      reply("Already on the way."),
    ]);

    await runAgent(300, { chat, ...chain });

    const stock = JSON.parse(toolReplies(seen[1])[0].content);
    assert.equal(stock.on_hand, 0);
    assert.equal(stock.on_order, 1, "cancelled orders are not on their way");
    assert.equal(stock.covered, 1);
  });
});
