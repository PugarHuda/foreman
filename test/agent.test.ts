import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgent, MAX_TURNS, type ChatFn } from "../lib/agent.ts";

/**
 * The loop, with the model replaced by a script. No network, no chain — this
 * is about control flow: does it feed tool results back, does it stop when
 * the model stops asking, does it give up rather than spin.
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

describe("agent loop", () => {
  it("returns the closing message once the model stops calling tools", async () => {
    const { chat } = scripted([reply("Nothing needs ordering this shift.")]);
    const run = await runAgent(300, chat);

    assert.equal(run.summary, "Nothing needs ordering this shift.");
    assert.deepEqual(run.steps, [], "a closing message is the summary, not a step");
  });

  it("feeds tool results back to the model", async () => {
    const { chat, seen } = scripted([
      reply("Checking.", [{ name: "get_machine_health", args: { machine_id: 7 } }]),
      reply("CNC-07 is degrading but covered."),
    ]);

    const run = await runAgent(300, chat);

    const secondCall = seen[1];
    const toolMsg = secondCall.find((m) => (m as { role: string }).role === "tool") as {
      content: string;
    };
    assert.ok(toolMsg, "the tool result must go back to the model");

    const payload = JSON.parse(toolMsg.content);
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

    const run = await runAgent(300, chat);

    const toolMsg = seen[1].find((m) => (m as { role: string }).role === "tool") as {
      content: string;
    };
    assert.match(JSON.parse(toolMsg.content).error, /unknown machine/);
    assert.ok(run.steps.some((s) => s.label.includes("failed")));
  });

  it("tells the model not to retry an order that may already be on chain", async () => {
    // No deployment here, so the write fails — which is the case that matters.
    const { chat, seen } = scripted([
      reply("Ordering.", [
        {
          name: "create_purchase_order",
          args: {
            machine_id: 7,
            part_no: "6205-2RS",
            supplier_address: "0x000000000000000000000000000000000000dEaD",
            amount_usd: 180,
            reason: "test",
          },
        },
      ]),
      reply("Could not place the order."),
    ]);

    await runAgent(300, chat);

    const result = JSON.parse(
      (seen[1].find((m) => (m as { role: string }).role === "tool") as { content: string }).content,
    );
    assert.equal(result.retry, false);
    assert.match(result.note, /Do not place this order again/);
  });

  it("gives up rather than looping forever", async () => {
    // A model that always asks for one more tool call.
    const { chat, seen } = scripted([
      reply("Again.", [{ name: "check_inventory", args: { part_no: "6205-2RS" } }]),
    ]);

    const run = await runAgent(300, chat);

    assert.equal(seen.length, MAX_TURNS, "should stop at the turn limit");
    assert.match(run.summary, /turn limit/);
  });
});
