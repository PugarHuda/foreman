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

**[foreman-six-psi.vercel.app](https://foreman-six-psi.vercel.app)** — the
pitch in one page, the full argument as slides at
[`/deck`](https://foreman-six-psi.vercel.app/deck), and the control room
itself one click away at
[`/dashboard`](https://foreman-six-psi.vercel.app/dashboard). It is wired to
Base Sepolia: press *Run agent* and it spends actual testnet money on your
behalf.

That is deliberate, and the blast radius is the point: the agent key holds
0.002 ETH of gas, the on-chain spend permission caps it at $2,000 a month, and
nothing above $500 executes without a second key. A stranger hammering the
button is bounded by the same contract the plant relies on — which is easier
to show than to argue.

| | | |
|---|---|---|
| Foreman | [`0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a`](https://sepolia.basescan.org/address/0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a) | [read the verified source](https://base-sepolia.blockscout.com/address/0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a#code) |
| USDC (mock) | [`0x4944908fa528e017340df511dbae5bbb8dc91720`](https://sepolia.basescan.org/address/0x4944908fa528e017340df511dbae5bbb8dc91720) | [verified on Sourcify](https://sourcify.dev/server/repo-ui/84532/0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a) |

Both are verified, so the bytecode running on Base Sepolia can be checked
against the source in this repo rather than taken on trust.

**[The deck](https://foreman-six-psi.vercel.app/deck)** — eleven slides at a
URL rather than a file somebody has to be sent, so there is exactly one
version of it and its numbers are read off the contract at render time rather
than off a screenshot taken three days ago. Print to PDF from the browser: the
stylesheet swaps to a light palette that is contrast-checked like the dark one.

Two videos, both served from the live site so nothing has to be downloaded to
be watched:

| | | |
|---|---|---|
| **Demo** | [foreman-six-psi.vercel.app/demo.mp4](https://foreman-six-psi.vercel.app/demo.mp4) | 2m19s — the whole loop, unedited, recorded straight off the running app. Every figure in it is a real transaction against the contract above |
| **Pitch** | [foreman-six-psi.vercel.app/pitch.mp4](https://foreman-six-psi.vercel.app/pitch.mp4) | 2m01s — narrated, captioned |

The demo is recorded by `scripts/record-demo.mjs`, which drives the real app
with Playwright. It writes `docs/demo.webm` and the H.264 copy the site serves
— Playwright records VP9, which Safari will not play, so the two are produced
together rather than by hand.

**The pitch** — two minutes, narrated, with captions
([`docs/pitch.srt`](docs/pitch.srt) for anywhere burned-in is not enough).
Built with Remotion from `video/`, and its product footage is real screenshots
of the running deployment rather than a redrawn mock: a pitch that illustrates
its product with an illustration is saying the product cannot be filmed.

The narration is synthesised, and the timings are measured off the rendered
audio with ffprobe rather than estimated — so a caption cannot drift from the
line it belongs to. `npm run voice` re-renders the voice (`-- --voice am_adam`
picks another), `npm run capture` retakes the footage, `npm run video:pitch`
renders. Editing one line re-renders one line.

The transactions behind it, which you can check yourself:

- [Agent signs a $180 bearing alone](https://sepolia.basescan.org/tx/0x26e3e68400067772bde0b556245b3614d72b1693b81782960d58af2cd28ca0b6) — `Proposed` and `Funded` in one transaction, because it is under the ceiling
- [Agent stops at a $4,000 spindle](https://sepolia.basescan.org/tx/0x6710c1252d52004dc11f99558f0ea4e661ba33b1a9b394d51727199c1ab50707) — `Proposed` only. No `Funded` event, no money moved
- [A human approves it](https://sepolia.basescan.org/tx/0xea977baf240626397d6a95036f986fcd931ebb0bde93ad85d28a9b109c6df251) — a separate transaction from a separate key, and the agent's budget is untouched: the cap bounds the agent, not the plant
- [Supplier commits to a waybill on despatch](https://sepolia.basescan.org/tx/0xb263725c6e3f3c98db5d5a040e0dc66221d8cb6fdf7d295cc36fee89a53bc366) — the `Shipped` event carries the document hash
- [Supplier paid once goods-in matched it](https://sepolia.basescan.org/tx/0xd64e789c6c7d7acc1590e593f729bcd88ad4d09fbdf5ccf8e030f0087d128df9)
- [The part is issued to the machine](https://sepolia.basescan.org/tx/0x64db40fad8f23cd7f4f84e5abb42d2cb741695088a78d495451713c5cd74fd70) — it leaves the store, which is what lets the agent order the next one
- [The plant cancels a funded order](https://sepolia.basescan.org/tx/0xa33292d7e28546f0c82046e3913ff2df4aca190f1f96d39881527a08623aedce) — escrow and the agent's budget both come back

That list is generated, not maintained: `node --env-file=.env scripts/evidence.ts`
walks the whole lifecycle on a fresh deployment and writes
[`docs/evidence.md`](docs/evidence.md). The old version was hand-copied, which
meant a redeployment silently invalidated the one thing the README asks anyone
to check.

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

The reasoning trace really is live. `/api/agent` streams newline-delimited
JSON, one object per step, so tool calls appear as they happen rather than
arriving in a block after thirty seconds of spinner. It is also the honest
shape for the work: a shift assessment is a sequence of decisions, and the
sequence is the part worth watching.

### The contract

`Foreman.sol` is the whole trust model, in about 250 lines.

| Guarantee | How |
|---|---|
| Agent cannot invent a payee | `approvedSupplier` allowlist; only the plant may add to it. A hallucinated or injected address is rejected at the contract, not by a prompt |
| Agent cannot re-buy what is already coming | Two layers: `check_inventory` reports on-hand **plus on order** so the agent decides correctly, and `proposePO` reverts with `AlreadyOnOrder` if that machine already has an open order for that part. A guarantee that lives only in application memory is not a guarantee |
| Agent cannot overspend | `monthlyCap` per 30-day window, checked on every autonomous fund |
| Agent cannot make large commitments alone | `autoApproveMax`; above it the PO sits in `Proposed` |
| A human is never blocked by the agent's budget | `approvePO` bypasses the cap — the cap bounds the agent, not the plant |
| Escrow does not move on a bare click | The supplier commits a despatch document hash with their own key; `confirmReceipt` reverts unless goods-in submits a reference that matches. The reference is not derivable from the order id — one that anyone could compute would make the match ceremony rather than evidence |
| A fitted part stops counting as stock | `fitPart` issues a delivered part to the machine. Goods receipt without consumption makes the store look fuller after every delivery until the agent stops ordering entirely |
| A lost plant key does not freeze the treasury | `nominatePlant` / `acceptPlant`, two-step so a mistyped address cannot lock the contract. Only the plant can withdraw, approve or confirm, so an immutable owner was a single point of permanent failure |
| An order's worth cannot drift | `rulHoursAtOrder` is fixed on chain when the order is placed. Recomputing avoided downtime from today's projection rewrites what a past decision was worth |
| Supplier cannot be stiffed | `claimAfterTimeout` after 14 days from shipping |
| Plant cannot be stiffed | escrow only releases on `confirmReceipt` or that timeout |
| A forgotten decision cannot block a line for good | An open order blocks its machine-and-part line; `expireProposal` lets anyone clear one nobody answered after 7 days. A proposal holds no escrow, so there is nothing to steal by expiring it |
| The audit trail is checkable, not just printable | `/api/audit` exports the order book as CSV, every row naming the contract it came from. An auditor can re-derive any line from a block explorer instead of trusting the file |
| Supplier reliability is derived, not maintained | `supplierRecords` scores despatch against the lead time the supplier quoted, straight off the order book. Nobody keeps the scorecard, so nobody can quietly revise it, and a plant switching systems carries it with them. It deliberately ignores cancellations: only the plant can cancel, so scoring them rated the plant's own decisions and dragged suppliers under the line the agent routes on |
| The panel is readable, not just tidy | Every text tier clears WCAG AA on every surface it lands on, checked in `test/contrast.test.ts`. The old third tier sat at 2.8:1 while carrying machine names, status badges and the ISO zone labels |
| A cancelled order does not burn the month | `cancelPO` refunds budget and escrow |

One guard deliberately lives a layer up, and it is worth naming rather than
folding into the table above:

| Guard | Where | Why there |
|---|---|---|
| Agent cannot invent a price | `lib/agent.ts`, **not** the contract | The allowlist binds *who* is paid and the cap binds the monthly total. Between them nothing bound the *figure* — a decimal in the wrong place was a vetted supplier handed ten times their quote, inside budget, with every guarantee above still true. The agent's tool now refuses any `amount_usd` that is not the quoted price. It is not on chain because the price list is not on chain: the quotes come from the plant's ERP, and putting them on chain would mean writing every supplier price change as a transaction. The honest description is a tool-layer guard, and calling it a contract guarantee would put the rest of this table in doubt |

## Run it

```bash
npm install
npm run compile
npm test                  # escrow lifecycle, caps, access control, RUL trending

npm run keys              # writes .env and every burner key it needs
# put your Venice key in .env — the only thing without a working default
node scripts/venice-check.mjs   # confirm the model actually tool-calls
npm run deploy            # Base Sepolia; writes lib/deployment.ts
npm run dev
```

Node 22.18 or newer (`.nvmrc` pins it): the tests import TypeScript directly,
which needs Node's type stripping.

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

Two minutes, two button presses — [docs/demo-script.md](docs/demo-script.md)
has the walkthrough, the three questions this always gets asked, and what to
do if the venue wifi dies.

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
`docs/demo.webm`, plus the still at the top of this file. `STILL_ONLY=1` stops
after the routine lane and refreshes only the still — a UI change dates the
image while the recording is still accurate, and that should not cost another
video in git history.

### Settling in real USDC

Foreman takes any ERC-20. Set `USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`
and it settles in Circle's testnet USDC on Base Sepolia instead of a mock.

The mock is the default deliberately. Circle's faucet issues 20 USDC every two
hours, and a plant treasury of $20 buying a $0.18 bearing demonstrates nothing
about maintenance economics. The mock keeps the figures at the size this
actually runs at; the token behind them is one environment variable.

## Tests

```bash
npm test          # 169 contract + unit tests, in-process EVM, no node needed
npm run test:e2e  # 32 browser tests, against localhost or a deployed instance

# The pilot surfaces — ingest, the asset register, an ERP, a real login —
# need an instance started in pilot configuration, so they are skipped unless
# you point them at one. 40 pilot tests, happy path and wrong path.
PILOT_BASE_URL=http://localhost:3000 PILOT_TELEMETRY_TOKEN=… PILOT_PASSWORD=…   npx playwright test pilot
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

## Running a pilot

The demo defaults are fixtures. Every one of them is a seam with an env var in
front of it, so a pilot is configuration rather than a fork. Nothing below
changes the contract.

Run it **on-prem** — a box in the plant, `npm run build && npm start`. That is
not a deployment preference: the file store needs a disk that survives a
restart, and telemetry that never leaves the site is the same argument the
model provider choice makes.

### 1. The asset register

```jsonc
// machines.json
[{ "id": 1, "tag": "CNC-07", "name": "Mazak VCN-530",
   "criticalPart": "6205-2RS", "escalationPart": "SPN-880",
   "downtimeCostPerHour": 890 }]
```

`MACHINES_FILE=machines.json`. The tag is what telemetry is posted against, so
it has to match what the gateway calls the machine. Give each asset a `line`
and the panel groups by it — a plant is several lines, and forty machines under
one heading is a list rather than an instrument. Several *plants* is a
deployment each: the contract has one `plant` address and one treasury, and a
tenancy model in Solidity would be solving what a second `FOREMAN_ADDRESS`
already solves.

### 2. Telemetry

`TELEMETRY_SOURCE=file` switches the replay off. Readings arrive at
`POST /api/telemetry`, authenticated with `TELEMETRY_TOKEN` — which is a
comma-separated list, so a key can be rotated without a window where nothing
can report: add the new one, move the gateways over, drop the old:

```
Authorization: Bearer $TELEMETRY_TOKEN
{ "tag": "CNC-07", "readings": [{ "at": "2026-08-07T09:00:00Z", "rms": 3.91 }] }
```

There is no MQTT client in the web app on purpose — the protocol is the
bridge's problem, and this endpoint speaks the one thing every gateway can
already send. `scripts/telemetry-bridge.mjs` runs on-prem and does the
translating:

```bash
npm i mqtt          && npm run bridge -- --source mqtt      # MQTT_TOPICS maps topic -> tag
npm i node-opcua    && npm run bridge -- --source opcua     # OPCUA_NODES maps nodeId -> tag
npm run bridge -- --source csv --file export.csv --tag CNC-07   # a historian export, once
```

It batches on a timer and re-queues on failure, so a Foreman that is briefly
down costs a retry rather than an hour of trend.

What it reads is the RMS a condition-monitoring gateway has already computed,
not a raw accelerometer stream. If your sensors emit raw waveform, the RMS
integration belongs in the gateway, which is where every vendor already puts
it.

A machine that is registered but has never reported reads as *not reporting* —
never as a healthy one. The agent is told it cannot assess it and takes no
action.

### 3. Stock and purchasing

`PLANT_SOURCE=http` plus `PLANT_API_URL` points the agent at whatever sits in
front of the ERP:

```
GET /stock/:partNo    -> { "onHand": 3 }
GET /quotes/:partNo   -> [{ "supplier": "...", "address": "0x…",
                            "priceUsd": 180, "leadTimeHours": 36 }]
GET /parts/:partNo    -> { "description": "Deep groove ball bearing 25x52x15" }
```

Quotes are the list the agent chooses from **and** the price it is held to, so
a row with no address or no price is dropped rather than defaulted. Responses
are cached 30 seconds — one shift assessment reads stock and quotes several
times, and an ERP is not built for that.

The supplier addresses in `/quotes` still have to be vetted on chain with
`setSupplier`. The ERP proposes; the contract decides who is payable.

### 4. Login

```bash
npm run passwd 'a long operator password'
```

Paste the three lines into `.env`. `OPERATOR_PASSWORD_HASH` turns off the
`DEMO_SECRET` gate. The panel shows a sign-in field when the session expires.

### 5. Supplier keys

Delete `SUPPLIER_A_KEY` and `SUPPLIER_B_KEY`. The demo holds them so one
person can drive every role; in a pilot the supplier despatches from their own
wallet, which the contract already requires — `markShipped` reverts for anyone
but `po.supplier`. Without the keys the *Supplier ships* button says so
instead of failing with a missing-env error.

### 6. The agent key, once it is worth stealing

`AGENT_SIGNER_URL` plus `AGENT_SIGNER_ADDRESS` moves signing to a service you
run. It sends a 32-byte digest and expects a 65-byte signature back:

```
POST $AGENT_SIGNER_URL
{ "role": "agent", "digest": "0x…" }   ->   { "signature": "0x…" }
```

No cloud vendor's SDK ends up in this repo — AWS KMS, GCP KMS, Vault,
Fireblocks and an HSM in a rack all fit behind that. The service returns a
complete signature including the recovery byte, because recovering it means
trying both and checking which yields the expected address, and that is
vendor-shaped work that belongs next to the vendor. `REMOTE_SIGNER_URL` sets
one endpoint for every role.

### Mainnet, and what refuses to start on it

`CHAIN=base` is the only setting where a mistake costs money, so it checks
itself before serving any route that moves funds (`lib/safety.ts`):

**Refuses to serve** without `OPERATOR_PASSWORD_HASH` — the demo gate ships to
the browser and is not acceptable against real money; without a signable
`SESSION_SECRET`; or if the deployed token is not Circle's canonical USDC for
the chain. That last one catches pointing a live contract at the mock ERC-20
this repo deploys, which would settle every invoice in tokens nobody accepts.

**Warns and continues** when the agent key is a plain environment variable, or
when a supplier key is on the plant's server. A supervised pilot may
reasonably accept both, and being unable to start is its own kind of failure.

### 7. Shared state, when there is more than one process

Three things kept their own in-memory copy and each carried a `ponytail:`
comment admitting the ceiling: the notification cooldown, the agent's
one-run-at-a-time lock, and the journal. On a single on-prem box that is
correct. On serverless every cold start forgets — the cooldown stopped
damping (it fired twice in testing for exactly this reason), two instances
could both conclude no run was in flight, and the journal wrote to a disk that
was discarded while reporting success.

`REDIS_REST_URL` and `REDIS_REST_TOKEN` point all three at one store. Upstash
over its REST API rather than a Redis client, because it is a fetch and a
token and this repo does not need a connection pool for three keys.

It fails **open**: a store that cannot be reached costs a duplicate
notification, or at worst a second agent run that `AlreadyOnOrder` rejects on
chain. Failing closed would mean no assessment at all because a cache blinked.
Unset, everything behaves exactly as it did.

### 8. Running it unattended

The last three pieces turn a panel somebody watches into a thing that watches
a line.

**Notifications.** `NOTIFY_WEBHOOK_URL` gets a JSON POST carrying the same
message under both `text` and `content`, because the two most likely
destinations disagree about the name and neither tolerates the other's — Slack
(and Google Chat, Mattermost, Teams) reads `text`, Discord reads `content` and
rejects a body without it as an empty message. The structured fields
(`kind`, `title`, `detail`, `url`) ride alongside for anything that parses
rather than renders. Any endpoint that accepts a POST works; there is no
per-destination integration to pick.

Telegram also needs a recipient, so `NOTIFY_CHAT_ID` goes in the body next to
the message:

```
NOTIFY_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage
NOTIFY_CHAT_ID=<chat id>
```

It could have ridden in the URL's query string and probably would have worked,
but mixing query parameters with a JSON body is not something Telegram's docs
promise, and the night an order needs approving is a bad time to find out. It
is omitted entirely when unset, because Slack and Discord reject fields they
do not know. It fires when an order needs a human, when a machine stops
reporting, when a run fails, and once per scheduled assessment. One webhook
rather than an integration per destination, with a per-key cooldown so a
polling dashboard does not page anyone sixty times an hour.

**The schedule.** `POST /api/cron` with `CRON_TOKEN` runs a shift assessment
at the newest hour on record — not a pinned one, or a schedule would assess
the same moment every night for the rest of the pilot. `vercel.json` declares one
daily run, which is all a Vercel Hobby plan permits — anything more frequent
is rejected at deploy time, not at runtime, so a schedule that looks right in
the file takes the whole deployment down. On-prem there is no such limit and a
crontab line does shift changeover properly:

```
0 6,14,22 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_TOKEN" $URL/api/cron
```
 Deliberately not an
in-process timer: a timer inside a web server fires twice with two instances
and not at all while it is redeploying.

**The journal.** `JOURNAL_DIR` holds two append-only JSONL files. `runs.jsonl`
is what the agent decided and why — previously live-only, streamed to whoever
had the panel open and gone on reload, which is exactly the record an auditor
asks for later. `actions.jsonl` is which operator pressed what: on chain every
one of those is the plant key, so the chain cannot say which person approved
the spindle. `GET /api/runs` serves both behind the operator gate, and the
panel restores the last assessment on load.

### 9. Named operators

`OPERATORS_FILE` is a JSON array of `{ name, hash }` from `npm run passwd`. A
lone `OPERATOR_PASSWORD_HASH` still works and reads as one account called
`operator`, so an existing pilot keeps running unedited.

The session names who is signed in, inside the signed payload, and that name
lands in the journal. Five wrong guesses locks that account for fifteen
minutes — scrypt already makes each guess cost ~100ms, and this is the rest of
it. Locking one account does not lock the shift out, and the login does not
reveal whether a name exists: an unknown operator is still charged a hash
against a throwaway salt, so the timing and the message are identical.

### 10. x402 — paying for data, never for goods

`X402_ENABLED=1` lets the agent pay a metered supplier or quote API that
answers HTTP 402, signing EIP-3009 with the same key the contract knows.

This is deliberately **not** how a spare part is paid for. The whole argument
here is that goods settle into escrow and release on confirmed receipt;
pay-now-get-response-now is the model the contract exists to avoid, and
routing a purchase order through it would quietly undo the thing being
demonstrated. Two kinds of money, two sets of rules:

| | goods | data |
|---|---|---|
| Settles | on-chain escrow, released on receipt | x402, immediately |
| Payee | allowlisted by the plant | whoever answers the endpoint |
| Bound by | `monthlyCap`, `autoApproveMax` | `X402_MAX_PER_CALL`, `X402_MAX_TOTAL` |

What it buys is the thing the agent could not do before: it could reason about
a purchase but could not buy the information to reason with. A supplier feed
that meters itself no longer needs Foreman onboarded to answer it.

Every refusal is named rather than filtered silently — wrong scheme, wrong
network, an asset the plant did not authorise, a price over the per-call
limit. An agent that stops paying for its supplier feed and cannot say which
rule stopped it is an outage nobody can diagnose.

Proved end to end against a metered supplier API that offers the same asset on
two chains, with the wrong-chain offer priced at 1 unit against 2500. The
agent takes the expensive correct one: the cheap optimisation would have sent
money to a chain the plant never authorised. The suite asserts that, plus that
nothing is paid before a 402 asks for it, and that no two payments share a
nonce — EIP-3009 replays anything reused.

### What a pilot still is not

Testnet USDC and an unaudited contract. Both are deliberate: get the plant
data and the loop right where a mistake costs nothing, then decide whether
real money is worth an audit.

## What is real and what is staged

Stated plainly, because a demo that hides its seams is not worth piloting.

**Real:** the contract and every guarantee in the table above, running on Base
Sepolia with real transactions. The RUL trending — log-linear extrapolation to
a standards-defined threshold is how condition monitoring actually does it.
The ISO 10816-3 Class II severity bands. The agent's reasoning and tool calls.

**Real:** the static analysis. `slither` runs on every push and fails the
build on anything medium or above (`.github/workflows/ci.yml`). It reported 19
findings, none medium or above. The two that were real — a missing zero-check
on `setPolicy`'s agent, and an unindexed address in `PolicySet` — are fixed and
redeployed, with tests. Every other finding is triaged in writing in
[`docs/static-analysis.md`](docs/static-analysis.md), including the one that is
still reported and is a false positive. That is
not an audit — it is the floor an audit starts from.

**Real:** the delivery control. The supplier signs a commitment to a document
reference before the plant can release anything, and a mismatched reference
reverts. What is staged is only where the reference comes from — it is derived
from the order id so the demo holds no hidden state. `CARRIER_API_URL` points
it at the real thing — the number printed on the consignment note travelling
with the goods — and the contract is unchanged. It throws rather than falling
back when a carrier is configured and unreachable: silently reverting to a
guessable reference would turn the check back into ceremony at exactly the
moment nobody is watching.

**Staged by default, switchable by configuration:** out of the box the
vibration signal is a seeded replay, and inventory and supplier quotes are
fixtures. Each is a seam with a real implementation behind it —
`TELEMETRY_SOURCE=file` reads a plant's own readings, `PLANT_SOURCE=http`
reads its ERP — and the default stays the fixture so the public demo keeps
working offline. See **Running a pilot** below.

**Still staged in every configuration:** USDC is a mock ERC-20 on testnet, and
the contract has not had a third-party audit. Neither is a code change.

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

`/api/agent` and `/api/po` sign with real keys, so who may call them matters.
There are two gates and the deployment picks one:

- **`OPERATOR_PASSWORD_HASH` set** — a real session. scrypt-hashed password
  that never reaches the browser, an HMAC-signed HttpOnly cookie, a 12-hour
  expiry. This is what a pilot runs. `npm run passwd 'your password'` prints
  the lines to paste into `.env`.
- **`DEMO_SECRET` set instead** — the original speed bump, kept because the
  public demo is meant to be pressed by strangers and its blast radius is the
  point. It is *not* authentication: the secret ships in the page bundle and
  anyone who loads the page can read it.

Neither set, in production, means closed. An endpoint that moves funds does
not default to open because someone forgot an env var.

Still not solved: the agent key is an environment variable, not a KMS. Real
money on mainnet needs it in one, and needs an audit.

## Next

- A third-party audit before real money.
- Multi-line and multi-plant: one contract, one plant, today.
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
