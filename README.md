# Foreman

**The machine asks for its own spare part. A human sets the limit, once.**

Foreman watches vibration on a machining line, projects when a bearing will
cross the ISO 10816-3 "stop the machine" threshold, and — if the part is out of
stock and the supplier lead time will not beat the failure — buys it. Payment
settles into on-chain escrow against a spend permission the plant manager
signed weeks earlier, and releases to the supplier on confirmed receipt.

Routine orders execute autonomously. Anything above the auto-approve ceiling
lands in a human queue. The agent reasons; the contract constrains.

---

## Why this is Industrial 5.0

Industrial 4.0 put sensors on machines. It left a human to read the dashboard,
raise a requisition, chase three quotes, wait for a PO number, and phone the
supplier — while the bearing kept degrading. The data was automated and the
decision-to-cash loop was not.

Foreman closes that loop, and does it the human-centric way Industrial 5.0
actually asks for:

- **Humans handle exceptions, machines handle routine.** A $180 bearing goes
  through untouched. A $4,000 spindle stops and waits for a person. The split
  is enforced on-chain, not by policy documentation.
- **The authority is explicit and revocable.** A spend permission is a signed,
  auditable, on-chain object with a budget and a ceiling — not an API key with
  unbounded access to a corporate card.
- **Resilient supply chains.** The order is placed against a projected failure
  instead of a monthly reorder cycle.
- **Safer workplaces.** Bearings that reach Zone D do not fail politely.

Telemetry never leaves for a model provider that retains it: the agent runs on
Venice AI, which does not store inference data. That is the difference between
a pilot a plant will sign and one its IT department will kill.

## What actually runs

```
vibration telemetry          lib/machine.ts    ISO 10816-3 zones, log-linear RUL trending
        │
        ▼
maintenance agent            lib/agent.ts      Venice AI tool-calling, 4 tools
        │  get_machine_health · check_inventory · get_supplier_quotes · create_purchase_order
        ▼
spend permission + escrow    contracts/Foreman.sol
        │  autonomous lane ≤ ceiling · human lane above it · 30-day budget
        ▼
supplier paid on receipt     Base Sepolia
```

The dashboard (`app/`) is the plant's control room: machine cards on the ISO
severity rail, a trend chart whose dashed projection points at the Zone D
crossing, the agent's live reasoning trace with transaction links, and the
approval queue.

### The contract

`Foreman.sol` is the whole trust model, in about 200 lines.

| Guarantee | How |
|---|---|
| Agent cannot overspend | `monthlyCap` per 30-day window, checked on every autonomous fund |
| Agent cannot make large commitments alone | `autoApproveMax`; above it the PO sits in `Proposed` |
| A human is never blocked by the agent's budget | `approvePO` bypasses the cap — the cap bounds the agent, not the plant |
| Supplier cannot be stiffed | `claimAfterTimeout` after 14 days from shipping |
| Plant cannot be stiffed | escrow only releases on `confirmReceipt` or that timeout |
| A cancelled order does not burn the month | `cancelPO` refunds budget and escrow |

## Run it

```bash
npm install
npm run compile
npm test                  # 15 tests: escrow lifecycle, caps, access control, RUL trending

cp .env.example .env      # fill DEPLOYER_KEY and VENICE_API_KEY
npm run keys              # burner keys for the agent and suppliers
npm run deploy            # Base Sepolia; writes lib/deployment.ts
npm run dev
```

Fund the deployer at the [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia)
before deploying — `npm run deploy` distributes gas to the agent and supplier
roles from there.

No Base Sepolia ETH, or no venue wifi? `CHAIN=local` runs everything against
`npx hardhat node` instead — same code path, same contracts.

```bash
npx hardhat node                       # terminal 1
CHAIN=local npm run deploy             # terminal 2
CHAIN=local npm run dev
```

### Driving the demo

**Run hour 300 — the routine lane.** CNC-07 sits at 3.89 mm/s, zone B, 58.4 h
of life left, zero bearings on the shelf. Press **Run agent**. It checks all
three machines, drops the two whose trend confidence is below r²=0.7, prices
both bearing suppliers, and orders the $180 Sundara part because a 36 h lead
still beats a 58.4 h RUL. Under the $500 ceiling, so it signs alone and the
agent budget falls to $1,820.

**Drag run hour to 320 — the human lane.** Now 5.02 mm/s, zone C, 34.8 h. A
bearing no longer fixes this; the shaft is scored. The agent switches to the
$4,000 spindle cartridge, notes honestly that the 120 h lead time will not
beat the RUL, and places the order anyway — where it stops, in *Waiting on
you*, because it is over the ceiling. The agent budget does not move: the cap
bounds the agent, not the plant.

Approve it, ship the bearing, confirm receipt, and the supplier's USDC balance
goes from 0 to 180.

## Tests

```
Foreman
  ✔ funds a routine PO autonomously and draws it from the agent budget
  ✔ holds a PO above the auto-approve line until a human approves
  ✔ stops the agent at the monthly cap and reopens the budget a window later
  ✔ pays the supplier on confirmed receipt
  ✔ lets a shipped supplier collect after the receipt timeout, but not before
  ✔ returns escrow and budget when the plant cancels a funded PO
  ✔ refuses a cancelled PO a second time and blocks shipping it
  ✔ keeps outsiders out of the agent and plant lanes
  ✔ will not commit more than the plant deposited
bearing health
  ✔ maps RMS onto the ISO 10816-3 severity zones
  ✔ reports no RUL while the bearing is healthy
  ✔ projects a finite RUL once the fault is growing
  ✔ shrinks RUL as the machine gets closer to Zone D
  ✔ replays identically for a given seed
  ✔ crosses into Zone D by the end of the run
```

## What is real and what is staged

Stated plainly, because a demo that hides its seams is not worth piloting.

**Real:** the contract and every guarantee in the table above, running on Base
Sepolia with real transactions. The RUL trending — log-linear extrapolation to
a standards-defined threshold is how condition monitoring actually does it.
The ISO 10816-3 Class II severity bands. The agent's reasoning and tool calls.

**Staged:** the vibration signal is a seeded replay, not a live accelerometer.
Its shape (flat baseline, exponential growth after fault onset) and its
severity bands are the real ones, and `lib/machine.ts` consumes a plain
`{hours, rms}` series — point it at a plant historian and nothing downstream
changes. Inventory and supplier quotes are a fixture standing in for a CMMS;
the agent reaches them through the tool surface it would use against a real
SAP PM instance. USDC is a mock ERC-20 on testnet.

## Next

- Replace the replay with an MQTT/OPC-UA bridge from a real accelerometer.
- Delivery confirmation from goods-receipt scanning instead of a button.
- Parametric cover: if the machine reaches Zone D anyway, the same escrow pays
  out a downtime claim. The contract barely changes.
- Multi-plant treasury with per-line budgets under one permission.

## Hackathon declaration

Built for **ChainHack 2026 / NeuralLedger 5.0**, hosted by CCACC.

This repository was created on **3 August 2026**, after the sponsor track
reveal on 24 July. Every line in it — contracts, tests, agent, dashboard — was
written during the hackathon period. Nothing here is recycled from a previous
event or a pre-existing project.

Dependencies are stock: Hardhat, viem, OpenZeppelin, Next.js, React.

## Licence

MIT
