# HackQuest submission — copy-paste sheet

Every field on the project form, filled. Character counts are against the
limits the form shows.

---

## Name (7 / 80)

```
Foreman
```

## Intro (0 / 200)

```
A maintenance agent watches machine vibration, buys the spare part before the line stops, and settles it in on-chain escrow under a spend permission a human signed once. Routine executes; exceptions wait.
```

*(199 characters)*

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

`docs/demo.webm` — the whole loop, unedited, recorded straight off the running
app by `scripts/record-demo.mjs`. Upload it or link an unlisted YouTube copy.

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
Foreman: 0xaf34fcad7034ce9f220e71946e4fdf399bc07ca9
https://sepolia.basescan.org/address/0xaf34fcad7034ce9f220e71946e4fdf399bc07ca9

Verified source:
https://base-sepolia.blockscout.com/address/0xaf34fcad7034ce9f220e71946e4fdf399bc07ca9#code

USDC (mock): 0xc4798b4385c4c0c22e3eeac9fb5efa560883d501
https://sepolia.basescan.org/address/0xc4798b4385c4c0c22e3eeac9fb5efa560883d501
```

Transactions a judge can check without running anything:

| What it shows | Transaction |
|---|---|
| Agent signs a $180 bearing alone — `Proposed` and `Funded` in one transaction | [`0x4b5193a6…`](https://sepolia.basescan.org/tx/0x4b5193a67ff997c869980596adc686a30f751c947225c27f5b6dea0d6e002e81) |
| Agent stops at a $4,000 spindle — `Proposed` only, no money moved | [`0x6f553926…`](https://sepolia.basescan.org/tx/0x6f55392627d4f6eb5d0de5f55a4d323093e37c4504cd1d86b4aba43f88f2dae0) |
| A human approves it — separate transaction, separate key, budget untouched | [`0xe502ecb2…`](https://sepolia.basescan.org/tx/0xe502ecb2105e5d3d9e8cee8dfe30cdcc7e60b19cc08dd756e2efb289e4868e3d) |
| Supplier commits to a waybill on despatch | [`0xdd206882…`](https://sepolia.basescan.org/tx/0xdd206882bff9d441a97a8e9f259542c09bc267b7b4d2873bc1d0f6f55862b074) |
| Supplier paid once goods-in matched it | [`0x31d25b24…`](https://sepolia.basescan.org/tx/0x31d25b24ab0b6c757d36cca4f06de055b317284a5c41fc07b56dcd77fcecca46) |
| The part is issued to the machine | [`0xf45af170…`](https://sepolia.basescan.org/tx/0xf45af170bc3e2cf37a51dc6ee537958de25e9974174726ac0ec7859d0ceb4ca8) |
