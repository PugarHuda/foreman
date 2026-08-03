/**
 * Smoke test for the Venice connection: does the configured model actually
 * emit a tool call, and does it come back with a sane answer after the tool
 * result? Run before trusting the agent: node scripts/venice-check.mjs
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const key = env.VENICE_API_KEY;
const model = env.VENICE_MODEL || "zai-org-glm-5-2";
if (!key) throw new Error("VENICE_API_KEY missing from .env");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_machine_health",
      description: "Vibration severity and remaining useful life for a machine.",
      parameters: {
        type: "object",
        properties: { machine_id: { type: "integer" } },
        required: ["machine_id"],
      },
    },
  },
];

const messages = [
  { role: "system", content: "You are a maintenance agent. Use tools before answering." },
  { role: "user", content: "Is machine 7 in trouble? Check it." },
];

async function call(body) {
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Venice ${res.status}: ${await res.text()}`);
  return res.json();
}

console.log(`model: ${model}`);

const first = await call({ model, messages, tools: TOOLS, temperature: 0.2 });
const msg = first.choices?.[0]?.message;
const calls = msg?.tool_calls ?? [];

console.log(`tool_calls: ${calls.length}`);
if (calls.length === 0) {
  console.log("content:", msg?.content?.slice(0, 300));
  throw new Error("model did not call the tool — pick a different VENICE_MODEL");
}
console.log(`  -> ${calls[0].function.name}(${calls[0].function.arguments})`);

messages.push(msg, {
  role: "tool",
  tool_call_id: calls[0].id,
  content: JSON.stringify({ machine: "CNC-07", rms_mm_s: 3.89, iso_zone: "B", rul_hours: 58.4 }),
});

const second = await call({ model, messages, tools: TOOLS, temperature: 0.2 });
console.log("\nfinal answer:\n" + second.choices?.[0]?.message?.content?.trim());
console.log("\nOK — tool calling works.");
