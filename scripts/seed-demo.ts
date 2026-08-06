/**
 * Put a realistic board on a freshly deployed contract, without the model.
 *
 *   node --env-file=.env scripts/seed-demo.ts
 *
 * The agent's *key* signs these; the model is not involved. That makes it
 * useful for screenshots, for rehearsing the human half of the flow, and for
 * CI, where a fresh chain has no history for the API tests to act against.
 *
 * Leaves: one bearing order fully settled and fitted, and one spindle waiting
 * on a human — the same shape the demo ends in.
 */
import { getQuotes, MACHINES } from "../lib/plant.ts";
import {
  proposePO,
  markShipped,
  confirmReceipt,
  fitPart,
  getState,
  type Address,
} from "../lib/chain.ts";

const cnc = MACHINES[0];
const bearing = getQuotes(cnc.criticalPart)[0];
const spindle = getQuotes(cnc.escalationPart!)[0];

const before = await getState();
if (before.pos.length > 0) {
  console.log(`${before.pos.length} order(s) already on this deployment — nothing to seed.`);
  process.exit(0);
}

console.log(`seeding ${before.foreman}`);

// A routine order the agent could sign alone, taken all the way through.
const routine = await proposePO(
  cnc.id,
  cnc.criticalPart,
  bearing.address as Address,
  bearing.priceUsd,
  58,
);
console.log(`  #${routine.id} ${cnc.criticalPart} $${bearing.priceUsd} ${routine.status}`);

await markShipped(routine.id);
console.log("    despatched, waybill committed");
await confirmReceipt(routine.id);
console.log("    received and paid");
await fitPart(routine.id);
console.log("    fitted to the machine");

// And one the agent may not sign, left where a human has to decide.
const escalated = await proposePO(
  cnc.id,
  cnc.escalationPart!,
  spindle.address as Address,
  spindle.priceUsd,
  35,
);
console.log(`  #${escalated.id} ${cnc.escalationPart} $${spindle.priceUsd} ${escalated.status}`);

const after = await getState();
console.log(
  `\ndone. available $${after.availableUsd}, escrowed $${after.escrowedUsd}, budget left $${after.remainingBudgetUsd}`,
);
