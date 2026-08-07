# Demo script

Two minutes, two button presses. Everything below is live on Base Sepolia —
nothing is faked for the run.

Open **https://foreman-six-psi.vercel.app?hours=300** before you start talking,
so the panel is loaded when you need it.

---

## The setup (20 seconds)

> A bearing on a machining centre starts failing days before it stops the line.
> The sensor sees it. The dashboard shows it. And then a human still has to
> read the dashboard, raise a requisition, chase quotes, wait for a PO number,
> and phone a supplier — while the bearing keeps degrading.
>
> Industrial 4.0 automated the data. It left the decision-to-cash loop manual.
> This closes it.

Point at the three machines. They are not the same problem:

- **CNC-07** — 3.89 mm/s, 58 hours left, trend confidence 0.96. Inside the
  72-hour planning horizon.
- **PRESS-02** — also degrading, also trustworthy at 0.97, but 86 hours out.
  Beyond the horizon, so it waits.
- **CONV-11** — flat, and its trend confidence is 0.01. That is noise, not
  health, and the agent will say so rather than act on it.

> Three machines, three different answers. Only one of them is "buy something".

## Press one — the routine lane (40 seconds)

Press **Run agent**. While it runs:

> It reads all three machines, drops the two whose trend confidence is below
> r²=0.7 rather than acting on noise, checks stock, and prices both approved
> suppliers.

When the order appears:

> Zero bearings on the shelf, failure inside the 72-hour planning horizon, so
> it buys. Sundara at $180, 36-hour lead, which beats the 58 hours it has.
> That was under the $500 ceiling, so the agent signed it alone — and the
> budget went from $2,000 to $1,820.

Click the transaction hash. **That is a real transaction on Base Sepolia.**

## Press two — the human lane (40 seconds)

Drag **run hour** to 320.

> Now it is 5.02 mm/s, zone C, 35 hours left. A bearing no longer saves this
> machine — the shaft is scored. The remedy is a spindle cartridge.

Press **Run agent** again.

> $4,000. Over the ceiling. It does not sign. It goes to *Waiting on you*.
>
> That is the whole product in one screen: the machine handles routine, the
> human handles exceptions, and the split is enforced on chain rather than in
> a policy document.

Press **Approve $4,000**, then note the budget:

> Still $1,820. The cap bounds the agent, not the plant.

## Settle it (20 seconds)

**Supplier ships** → a waybill reference appears. **Confirm receipt & pay**.

> The supplier committed to that document with their own key. The plant's
> confirmation has to match it or the contract reverts. Money moves when two
> parties agree on a document — not when someone clicks a button.

Then **Fit to machine**:

> And it leaves the store. Goods receipt without consumption is how an MRP
> convinces itself it is fully stocked and quietly stops ordering.

## Resetting between runs

Press **Fit to machine** on the delivered order. The store goes back to zero,
and the agent will order again on the next run — so you can rehearse and then
present on the same deployment. No redeploy needed.

If you want a completely clean board anyway: `npm run deploy`, 30 seconds.

---

## The three questions you will be asked

**"What stops it ordering the same bearing every shift?"**

Two things. The agent sees on-hand *plus on order* — a part already on its way
covers the machine as well as one on the shelf. And if it gets that wrong,
`proposePO` reverts with `AlreadyOnOrder`. A guarantee that lives only in
application memory is not a guarantee.

*(You can show this: press Run agent again right now. It declines, and says
why.)*

**"What if the model is compromised or hallucinates?"**

It cannot invent a payee. `approvedSupplier` is an on-chain allowlist only the
plant can add to, so a hallucinated or injected address is rejected by the
contract, not by a prompt. Worst case inside the allowlist is over-ordering
from a real supplier, capped at $2,000 a month, with anything over $500
stopping for a human.

That is also why this deployment is open to the public. Press the button as
much as you like — the blast radius is exactly the mechanism the plant relies
on.

**"What proves the parts actually arrived?"**

The supplier signs a commitment to a despatch document before the plant can
release anything, and `confirmReceipt` reverts on a mismatch. In this demo the
reference is derived from the order id so there is no hidden state; in a plant
it comes off the carrier's waybill or the goods-in scanner. That is one
function, `waybillFor` — the contract does not change.

---

## If something breaks

- **Agent errors out** → it already tried four models before giving up, so this
  is Venice being down rather than one model being busy. The panel shows the
  reason. Say "that is the model provider, not the contract" and click the
  transaction links instead; the ones in the README tell the same story.
- **Panel shows "Cannot read the line"** → RPC hiccup. Reload. The orders are
  on chain, not in the page.
- **No network at all** → `npx hardhat node`, then `CHAIN=local npm run deploy`
  and `CHAIN=local npm run dev`. Same code path, no internet.
- **Worst case** → play `docs/demo.webm`. It is the same run, recorded.

---

## Numbers worth having in your head

| | |
|---|---|
| Contract | ~250 lines of code, verified on Blockscout and Sourcify |
| Test suite | 148 contract + unit (offline), 32 browser, 33 pilot |
| Agent budget | $2,000 per 30 days, $500 per order without a human |
| CNC-07 downtime | $890/hour |
| Bearing | $180, 36h lead · Spindle $4,000, 120h lead |
| Chain | Base Sepolia, contract verified on Blockscout and Sourcify |
