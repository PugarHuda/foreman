# Foreman

**The machine asks for its own spare part. A human sets the limit, once.**

Foreman watches vibration on a machining line, projects when a bearing will
cross the ISO 10816-3 "stop the machine" threshold, and — if the part is out of
stock and the supplier lead time will not beat the failure — buys it. Payment
settles into on-chain escrow against a spend permission the plant manager
signed weeks earlier, and releases to the supplier on confirmed receipt.

Routine orders execute autonomously. Anything above the auto-approve ceiling
lands in a human queue. The agent reasons; the contract constrains.

![The Foreman control room: machine health on the ISO 10816-3 severity rail, the
projected Zone D crossing, the agent's live reasoning, and the on-chain order
queue](docs/dashboard.png)

---

## Live

**[foreman-six-psi.vercel.app](https://foreman-six-psi.vercel.app)** — the real
thing, wired to Base Sepolia. Press *Run agent* and it spends actual testnet
money on your behalf.

That is deliberate, and the blast radius is the point: the agent key holds
0.002 ETH of gas, the on-chain spend permission caps it at $2,000 a month, and
nothing above $500 executes without a second key. A stranger hammering the
button is bounded by the same contract the plant relies on — which is easier
to show than to argue.

| | |
|---|---|
| Foreman | [`0xd15bf5b95dc29083eba236057e2dc9de90092725`](https://sepolia.basescan.org/address/0xd15bf5b95dc29083eba236057e2dc9de90092725) |
| USDC (mock) | [`0xa048d4f17282488b60d96e6fb01fbda106f38b8a`](https://sepolia.basescan.org/address/0xa048d4f17282488b60d96e6fb01fbda106f38b8a) |

**[Watch the demo](docs/demo.webm)** — the whole loop, unedited, recorded
straight off the running app by `scripts/record-demo.mjs`.

Those four transactions, which you can check yourself:

- [Agent signs a $180 bearing alone](https://sepolia.basescan.org/tx/0xbab9ce88d4df901a42b8baab9eeef2ef1f3f4e9d2c20ff8d499046dc84d41d0e) — `Proposed` and `Funded` in one transaction, because it is under the ceiling
- [Agent stops at a $4,000 spindle](https://sepolia.basescan.org/tx/0x5c435e0281d209b5bf30ef81c2a15498136918f7ab4569faa0f6492a7dd57142) — `Proposed` only. No `Funded` event, no money moved
- [A human approves it](https://sepolia.basescan.org/tx/0x4fda1a82940ecb0c058251350edd68bf8462a26702863ae4d7479d4e188da93a) — a separate transaction from a separate key, and the agent's budget is untouched: the cap bounds the agent, not the plant
- [Supplier commits to a waybill on despatch](https://sepolia.basescan.org/tx/0x3be275ece2945f555e0dd3596fc14c04d5665b31d69d804307811aad098ff413) — the `Shipped` event carries the document hash
- [Supplier paid once goods-in matched it](https://sepolia.basescan.org/tx/0x784546759b521760d8f35e92a5287853dd67afd2bed0d695c9aa58f0c4a516a7)

The split across two transactions is the whole argument. One key can commit
routine money; the other is required for anything that is not routine.

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
| Agent cannot invent a payee | `approvedSupplier` allowlist; only the plant may add to it. A hallucinated or injected address is rejected at the contract, not by a prompt |
| Agent cannot re-buy what is already coming | `check_inventory` reports on-hand **plus on order**; the agent orders only when both are zero. Without this it re-bought the same bearing on every run |
| Agent cannot overspend | `monthlyCap` per 30-day window, checked on every autonomous fund |
| Agent cannot make large commitments alone | `autoApproveMax`; above it the PO sits in `Proposed` |
| A human is never blocked by the agent's budget | `approvePO` bypasses the cap — the cap bounds the agent, not the plant |
| Escrow does not move on a bare click | The supplier commits a despatch document hash with their own key; `confirmReceipt` reverts unless goods-in submits a reference that matches |
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
node scripts/venice-check.mjs   # confirm the model actually tool-calls
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

To record that run rather than perform it: `node scripts/record-demo.mjs`
drives the whole sequence against a running dev server and writes
`docs/demo.webm`.

### Settling in real USDC

Foreman takes any ERC-20. Set `USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`
and it settles in Circle's testnet USDC on Base Sepolia instead of a mock.

The mock is the default deliberately. Circle's faucet issues 20 USDC every two
hours, and a plant treasury of $20 buying a $0.18 bearing demonstrates nothing
about maintenance economics. The mock keeps the figures at the size this
actually runs at; the token behind them is one environment variable.

## Tests

```bash
npm test          # 35 contract + unit tests, in-process EVM, no node needed
npm run test:e2e  # 20 browser tests, against localhost or a deployed instance
```

The agent loop is tested too, with the model replaced by a script: that it
feeds tool results back, stops when the model stops asking, surfaces a failed
tool call instead of throwing, tells the model not to retry a write that may
already be on chain, and gives up at the turn limit rather than spinning.

The e2e suite deliberately does not call the agent: that costs money, takes
~40s and depends on a model provider, none of which belongs in a suite you run
on every change. It covers what the browser can break — rendering, the trend
projection, machine selection, the run-hour scrub, phone width — and then
spends most of its effort on the paths that matter more than the happy one:

```
wrong path — bad input is refused, not crashed on
  ✔ a nonsense machine id falls back instead of 500ing
  ✔ a non-numeric run hour falls back to the default
  ✔ an out-of-range run hour is clamped
  ✔ an unknown order action is rejected with the valid ones named
  ✔ an order that does not exist is a 404
  ✔ a malformed order id is a 400
  ✔ acting on an order past that step is refused in plain language
  ✔ the dashboard surfaces a refused action instead of failing silently
```

That suite earned its keep immediately: it caught `id: null` being coerced to
`0` by `Number()`, so a request with no order id would have quietly acted on
order #0.

There is also a keyboard and screen-reader pass — machine selection, focus
visibility, the run-hour slider, the chart's own description, and a check that
no control ships without an accessible name.

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
  ✔ will not pay an address the plant never vetted
  ✔ lets only the plant vet a supplier
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

**Real:** the delivery control. The supplier signs a commitment to a document
reference before the plant can release anything, and a mismatched reference
reverts. What is staged is only where the reference comes from — it is derived
from the order id so the demo holds no hidden state. Point `waybillFor` at a
carrier API or a goods-in scanner and the contract is unchanged.

**Staged:** the vibration signal is a seeded replay, not a live accelerometer.
Its shape (flat baseline, exponential growth after fault onset) and its
severity bands are the real ones, and `lib/machine.ts` consumes a plain
`{hours, rms}` series — point it at a plant historian and nothing downstream
changes. Inventory and supplier quotes are a fixture standing in for a CMMS;
the agent reaches them through the tool surface it would use against a real
SAP PM instance. USDC is a mock ERC-20 on testnet.

## Where the trust actually sits

The interesting question about an agent that holds a wallet is not whether the
model is clever. It is what happens when the model is wrong, or when someone
feeds it text designed to make it wrong.

Three answers, in descending order of how much they are worth:

1. **The payee allowlist is in the contract.** Prompt injection, a
   hallucinated address, a compromised inference provider — none of them
   produce a payment to an attacker, because `proposePO` reverts on any
   address the plant has not vetted. The model chooses among suppliers; the
   plant decides who is choosable.
2. **The budget and ceiling are in the contract.** Worst case inside the
   allowlist is over-ordering from a real supplier, capped at $2,000 a month,
   and every order above $500 stops for a human first.
3. **The tool layer pre-checks the address** so a wrong guess comes back to
   the model as a correctable error rather than a raw revert.

What is *not* solved: `/api/agent` and `/api/po` sign with real keys and have
no user authentication. On localhost that is correct — the only caller is the
operator. On a public deployment it is not, so those routes refuse to serve
unless `DEMO_SECRET` is set (`lib/guard.ts`). That shared secret is a speed
bump against drive-by traffic, not authentication: it ships to the browser and
anyone loading the page can read it. Production needs real sessions and the
agent key in a KMS. Saying so plainly beats pretending otherwise.

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
