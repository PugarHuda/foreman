# HackQuest submission — copy-paste sheet

Every field on the project form, filled. Character counts are against the
limits the form shows.

---

## Name (7 / 80)

```
Foreman
```

## Intro (limit 200)

```
An agent watches machine vibration and buys the spare part before the line stops, settling it in on-chain escrow. Routine orders execute alone; anything larger waits for a human.
```

**178 characters, 29 words** — comfortably inside the limit whether the form
counts characters or words.

The first draft here was 204 characters and overflowed. If you want it shorter
still, either of these says the same thing:

```
A maintenance agent watches machine vibration, buys the spare part before the line stops, and settles it in on-chain escrow under a limit a human signed once.
```
*(158 characters, 27 words)*

```
Predictive maintenance that settles its own invoice: an agent buys the bearing before the line stops, in on-chain escrow, under a spend limit a human signed once.
```
*(162 characters, 27 words)*

## Sector (max 4)

Select: **AI**, **RWA**, **Infra**, **DeFi**

- *AI* — the agent reasons over telemetry and places the order.
- *RWA* — the asset is a bearing on a machining line; the payment settles against physical goods receipt.
- *Infra* — a spend permission with an escrow lifecycle other agents could reuse.
- *DeFi* — USDC escrow, budget windows, timeouts both ways.

## Tech Tag (max 8)

Select from the list: **Next**, **React**, **Solidity**, **Node**, **Web3**

Add new: **viem**, **Base**, **Playwright**

## MVP Link

```
https://foreman-six-psi.vercel.app
```

The deck lives at `/deck` and the control room at `/dashboard`, both linked
from the landing page.

## Project Link

```
https://github.com/PugarHuda/foreman
```

## X (Twitter) Link

*Your handle — the form prefixes `x.com/` itself.*

## Wallet

Connect the wallet you want the reward paid to. It must be on the same network
as the hackathon (Base).

## Images (up to 4, 1280x720)

Purpose-made images are in `public/brand/` (`01-*.png` … `04-*.png`), sized
1280x720. `docs/dashboard.png` is the product screenshot if you would rather
lead with the real thing.

## Demo Video

```
https://foreman-six-psi.vercel.app/demo.mp4
```

2m19s, H.264. The whole loop, unedited, recorded straight off the running app
by `scripts/record-demo.mjs`. Every figure in it is a real transaction against
the deployed contract. Repo copy: `public/demo.mp4` (and `docs/demo.webm`, the
VP9 original).

## Pitch Video

```
https://foreman-six-psi.vercel.app/pitch.mp4
```

2m01s, 1920x1080, narrated with burned-in captions. Repo copy:
`public/pitch.mp4`. `docs/pitch.srt` is the subtitle track if the platform
wants one it can translate or let a viewer turn off.

---

## Description

```
Industrial 4.0 put sensors on machines. It left a human to read the dashboard, raise a requisition, chase three quotes, wait for a PO number, and phone the supplier — while the bearing kept degrading. The data was automated. The decision-to-cash loop was not.

Foreman closes it. It watches vibration on a machining line, fits the decay log-linearly to project when the bearing crosses the ISO 10816-3 Zone D threshold where the machine must be stopped, and — if the part is out of stock and no supplier lead time beats the failure — buys it. Payment settles into on-chain escrow against a spend permission the plant manager signed weeks earlier, and releases to the supplier only when goods-in confirms receipt against the despatch document the supplier committed to.

The split is the whole argument. A $180 bearing executes autonomously. A $4,000 spindle stops and waits for a person. That boundary is enforced by the contract, not by policy documentation — and the two transactions are on Base Sepolia for anyone to check.

What the contract will not let the agent do:
- Invent a payee. Payment only reaches an allowlisted supplier, so a hallucinated or injected address is rejected at the contract, not by a prompt.
- Invent a price. The agent chooses whose quote to take; it cannot write the amount. (This one is enforced in the tool layer rather than on chain, because the supplier price list is not on chain.)
- Re-buy what is already coming. A second order for the same part on the same machine reverts.
- Overspend. A 30-day cap, checked on every autonomous fund.
- Release escrow on a bare click. The supplier commits a despatch document hash with their own key, and receipt reverts unless goods-in submits a reference that matches.

A human is never blocked by the agent's budget: approval bypasses the cap, because the cap bounds the agent, not the plant.

Telemetry never leaves for a model provider that retains it — the agent runs on Venice AI, which does not store inference data. That is the difference between a pilot a plant will sign and one its IT department kills.

It is not a mockup. Press Run agent on the live deployment and it spends actual testnet money on your behalf, bounded by the same contract a plant would rely on.
```

## Progress During Hackathon

```
Built from nothing during the hackathon: the contract, the agent, the control room, and the pilot integration layer.

The contract (~250 lines of Solidity, verified on Base Sepolia) covers the full escrow lifecycle — propose, fund, ship, confirm, fit — plus a 30-day budget window, a per-order auto-approve ceiling, two-step plant-key handover, a 14-day supplier claim timeout so a silent buyer cannot hold funds hostage, and a 7-day proposal TTL so one forgotten decision cannot block a machine-and-part line for good.

The agent runs on Venice AI with four tools and streams its reasoning as newline-delimited JSON, so tool calls appear as they happen rather than arriving in a block after thirty seconds of spinner.

Then we took it past demo. Every fixture became a seam with a real implementation behind it, with the fixture kept as the default so the public demo still runs offline:
- Telemetry: a historian CSV or a live gateway, via an ingest endpoint and an on-prem bridge that speaks MQTT, OPC-UA or CSV.
- Stock and supplier quotes: a REST endpoint in front of the plant's ERP.
- Auth: scrypt-hashed named operator accounts, HttpOnly signed sessions, account lockout — replacing the demo's shared secret.
- The agent key: a KMS-agnostic remote signer seam.
- Mainnet: refuses to serve if the operator password is missing or the deployed token is not Circle's canonical USDC.
- Operations: webhook notifications, scheduled shift assessments, and an append-only journal of what the agent decided and which operator approved what.
- x402: the agent can pay metered supplier data APIs, bounded per call and per process — deliberately separate from goods, which still settle through escrow.

Several real bugs were found and fixed along the way, each caught by a test written for it:
- The agent could pay a vetted supplier any amount — the allowlist bound who, the cap bound the monthly total, and nothing bound the figure.
- Supplier reliability was scored on cancellations, which only the plant can cause, so declining an order made the supplier look unreliable.
- Number(null) is 0, so a sensor publishing nulls read as a perfectly healthy machine at 0 mm/s.
- A gateway that stopped reporting left a flat tail on a healthy number, and nothing looked wrong.

Verified: 150 contract and unit tests offline, 32 browser tests, and 38 pilot tests covering happy path and wrong path. Slither runs on every push and its 19 findings are each triaged in writing. A one-machine pilot was exercised end to end — 401 readings posted through the bridge from a historian export, producing a 47.2 hour projected life at r² 0.976.
```

## Fundraising Status

```
Not raising. Self-funded, built for this hackathon.

The natural next step is a paid pilot with one Malaysian precision-machining plant: one line, one machine, testnet settlement, to prove the loop against real telemetry and a real ERP before any decision about real money. The integration layer for that is already built and tested.
```

---

## Deployment Details (judges only)

**Ecosystem Deployed:** Base

**Testnet / Mainnet:** Testnet

**Contract address & deployed link**

```
Foreman: 0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a
https://sepolia.basescan.org/address/0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a

Verified source:
https://base-sepolia.blockscout.com/address/0x6cc8fafc87328a087ac0da2d0c8cae7f9bec2e9a#code

USDC (mock): 0x4944908fa528e017340df511dbae5bbb8dc91720
https://sepolia.basescan.org/address/0x4944908fa528e017340df511dbae5bbb8dc91720
```

Transactions a judge can check without running anything:

| What it shows | Transaction |
|---|---|
| Agent signs a $180 bearing alone — `Proposed` and `Funded` in one transaction, because it is under the ceiling | [`0x26e3e684…`](https://sepolia.basescan.org/tx/0x26e3e68400067772bde0b556245b3614d72b1693b81782960d58af2cd28ca0b6) |
| Agent stops at a $4,000 spindle — `Proposed` only. No `Funded` event, no money moved | [`0x6710c125…`](https://sepolia.basescan.org/tx/0x6710c1252d52004dc11f99558f0ea4e661ba33b1a9b394d51727199c1ab50707) |
| A human approves it — a separate transaction from a separate key, and the agent's budget is untouched: the cap bounds the agent, not the plant | [`0xea977baf…`](https://sepolia.basescan.org/tx/0xea977baf240626397d6a95036f986fcd931ebb0bde93ad85d28a9b109c6df251) |
| Supplier commits to a waybill on despatch — the `Shipped` event carries the document hash | [`0xb263725c…`](https://sepolia.basescan.org/tx/0xb263725c6e3f3c98db5d5a040e0dc66221d8cb6fdf7d295cc36fee89a53bc366) |
| Supplier paid once goods-in matched it | [`0xd64e789c…`](https://sepolia.basescan.org/tx/0xd64e789c6c7d7acc1590e593f729bcd88ad4d09fbdf5ccf8e030f0087d128df9) |
| The part is issued to the machine — it leaves the store, which is what lets the agent order the next one | [`0x64db40fa…`](https://sepolia.basescan.org/tx/0x64db40fad8f23cd7f4f84e5abb42d2cb741695088a78d495451713c5cd74fd70) |
| The plant cancels a funded order — escrow and the agent's budget both come back | [`0xa33292d7…`](https://sepolia.basescan.org/tx/0xa33292d7e28546f0c82046e3913ff2df4aca190f1f96d39881527a08623aedce) |
