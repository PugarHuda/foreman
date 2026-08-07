/**
 * Walk the whole escrow lifecycle on a freshly deployed contract and print
 * every transaction, as the markdown the README shows a judge.
 *
 *   node --env-file=.env scripts/evidence.ts
 *
 * The README's proof used to be a hand-maintained list of hashes, which meant
 * a redeployment silently invalidated the one thing it asked people to check.
 * Regenerating it is now a command.
 *
 * The agent's *key* signs the agent's half; the model is not involved. What is
 * being demonstrated is the contract's behaviour, and a model in the loop
 * would only make the sequence non-deterministic.
 */
import fs from "node:fs";
import { getQuotes, MACHINES } from "../lib/plant.ts";
import {
  approvePO,
  cancelPO,
  confirmReceipt,
  fitPart,
  getState,
  markShipped,
  proposePO,
  publicClient,
  txUrl,
  type Address,
} from "../lib/chain.ts";
import { FOREMAN_ABI, FOREMAN_ADDRESS } from "../lib/deployment.ts";

/**
 * Base Sepolia hands back a receipt and then still answers eth_call from the
 * state before it, so a write immediately after another simulates against
 * storage that does not know about it yet. A human clicking buttons never
 * sees this; a script writing eight transactions in a row sees it every time.
 *
 * scripts/deploy.mjs solves the same thing by waiting two confirmations. Here
 * the retry is cheaper: only the simulation is stale, and it is right a second
 * later.
 */
async function settled<T>(what: string, run: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 2000 * i;
      const first = String(e).split(/\r?\n/)[0].slice(0, 90);
      console.log(`    ${what}: ${first} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const cnc = MACHINES[0];
if (!cnc?.escalationPart) throw new Error(`${cnc?.tag} has no escalation part`);

const bearing = getQuotes(cnc.criticalPart)[0];
const spindle = getQuotes(cnc.escalationPart)[0];
if (!bearing || !spindle) throw new Error("no vetted supplier — has the deploy run?");

const state = await getState();
if (state.pos.length > 2) {
  throw new Error(
    `${state.pos.length} order(s) already on ${state.foreman}. This writes the canonical sequence and wants a fresh deployment.`,
  );
}

/**
 * Recover the hashes of orders a previous run already placed.
 *
 * A partial run is the normal case when a public RPC drops a step, and losing
 * the first two transactions because the third failed would mean redeploying
 * to get the evidence back. The `Proposed` event carries the id, so the chain
 * already knows which transaction created which order.
 */
async function proposalHashes(): Promise<Map<number, string>> {
  /* The public RPC caps eth_getLogs at 2000 blocks and rejects `earliest`
     outright. That is fine here: this only ever resumes a run that was
     interrupted minutes ago on a contract deployed minutes before that. A
     deployment older than the window is not a partial run, it is a finished
     one, and its evidence is already in docs/evidence.md. */
  const head = await publicClient.getBlockNumber();
  const logs = await publicClient.getContractEvents({
    address: FOREMAN_ADDRESS,
    abi: FOREMAN_ABI,
    eventName: "Proposed",
    fromBlock: head > 1999n ? head - 1999n : 0n,
    toBlock: head,
  });
  return new Map(
    logs.map((l) => [
      Number((l as unknown as { args: { id: bigint } }).args.id),
      (l as unknown as { transactionHash: string }).transactionHash,
    ]),
  );
}

const existing = await proposalHashes();
console.log(
  state.pos.length > 0
    ? `resuming on ${state.foreman} — ${state.pos.length} order(s) already placed\n`
    : `writing the evidence sequence to ${state.foreman}\n`,
);

const rows: { what: string; hash: string }[] = [];
const step = async (what: string, run: () => Promise<string>) => {
  const hash = await settled(what.slice(0, 40), run);
  rows.push({ what, hash });
  console.log(`  ${what}\n    ${hash}`);
  return hash;
};

/* 1 — routine. Proposed and Funded in one transaction, because it is under
   the ceiling. This is the whole autonomous lane in a single receipt. */
const routine =
  state.pos[0] !== undefined
    ? { id: 0, hash: existing.get(0)!, status: state.pos[0].status }
    : await settled("bearing", () =>
        proposePO(cnc.id, cnc.criticalPart, bearing.address as Address, bearing.priceUsd, 58),
      );
rows.push({
  what: `Agent signs a $${bearing.priceUsd} bearing alone — \`Proposed\` and \`Funded\` in one transaction, because it is under the ceiling`,
  hash: routine.hash,
});
console.log(`  #${routine.id} bearing ${routine.status}\n    ${routine.hash}`);

/* 2 — the exception. Proposed only: no Funded event, no money moved. */
const escalated =
  state.pos[1] !== undefined
    ? { id: 1, hash: existing.get(1)!, status: state.pos[1].status }
    : await settled("spindle", () =>
        proposePO(cnc.id, cnc.escalationPart!, spindle.address as Address, spindle.priceUsd, 35),
      );
rows.push({
  what: `Agent stops at a $${spindle.priceUsd.toLocaleString("en-US")} spindle — \`Proposed\` only. No \`Funded\` event, no money moved`,
  hash: escalated.hash,
});
console.log(`  #${escalated.id} spindle ${escalated.status}\n    ${escalated.hash}`);

/* 3 — the human half, from a different key, and the agent's budget untouched. */
await step(
  "A human approves it — a separate transaction from a separate key, and the agent's budget is untouched: the cap bounds the agent, not the plant",
  () => approvePO(escalated.id),
);

/* 4-6 — the delivery control, on the routine order. */
await step(
  "Supplier commits to a waybill on despatch — the `Shipped` event carries the document hash",
  () => markShipped(routine.id),
);
await step("Supplier paid once goods-in matched it", () => confirmReceipt(routine.id));
await step(
  "The part is issued to the machine — it leaves the store, which is what lets the agent order the next one",
  () => fitPart(routine.id),
);

/* Cancel the approved spindle and re-propose it, so the panel ends with
   something genuinely waiting on a person — and so the refund path is on
   chain too, rather than only in the table of guarantees. */
await step(
  "The plant cancels a funded order — escrow and the agent's budget both come back",
  () => cancelPO(escalated.id),
);
const waiting = await settled("re-propose", () =>
  proposePO(cnc.id, cnc.escalationPart!, spindle.address as Address, spindle.priceUsd, 35),
);
console.log(`  #${waiting.id} spindle ${waiting.status} — left for a human`);

const after = await getState();
console.log(
  `\ndone. available $${after.availableUsd}, escrowed $${after.escrowedUsd}, budget left $${after.remainingBudgetUsd}`,
);

const md = [
  "<!-- Generated by scripts/evidence.ts. Regenerate after any redeployment. -->",
  "",
  ...rows.map((r) => `- [${r.what.split(" — ")[0]}](${txUrl(r.hash)})${r.what.includes(" — ") ? ` — ${r.what.split(" — ").slice(1).join(" — ")}` : ""}`),
  "",
].join("\n");

fs.writeFileSync("docs/evidence.md", md);
console.log("\nwrote docs/evidence.md");
