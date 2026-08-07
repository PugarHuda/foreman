# Static analysis

`slither` runs on every push and fails the build at medium and above
(`.github/workflows/ci.yml`). It is not an audit — it is the floor an audit
starts from, and this page is what it found and what was done about each thing,
because a suppression with no reasoning next to it is indistinguishable from a
finding nobody read.

Reproduce locally:

```bash
pip install slither-analyzer
npm run compile
python -m slither contracts/Foreman.sol \
  --solc-remaps "@openzeppelin=node_modules/@openzeppelin" \
  --exclude-dependencies
```

## Result

**19 findings on the first run. None medium or above.** The two that were real
have been fixed and redeployed; the rest are excluded with reasons below.

## Acted on

Both required a contract change, so they went out together with a fresh
deployment — and the evidence transactions the README asks a judge to check
were regenerated against it by `scripts/evidence.ts` rather than hand-copied.

### `missing-zero-check` on `setPolicy(_agent)` — fixed

`setPolicy(address(0), cap, ceiling)` set the agent to the zero address, which
disabled the autonomous lane entirely: nobody can satisfy
`msg.sender == agent`. Plant-only and undoable with another `setPolicy`, so a
footgun rather than a vulnerability — but inconsistent, because `setSupplier`
had always refused the zero address.

Now `revert BadAgent()`, in both `setPolicy` and the constructor. Standing the
agent down is `monthlyCap = 0`, which says so on chain instead of leaving an
address nobody can sign for. Covered by three contract tests.

### `unindexed-event-address` on `PolicySet` — fixed

`PolicySet(address agent, ...)` had no indexed parameters, so a log consumer
could not filter policy changes by the agent they applied to. Now
`event PolicySet(address indexed agent, ...)`, with a test that filters the
log by agent and asserts it gets one entry rather than both.

### What is left

One `missing-zero-check`, on `nominatePlant`, which is a false positive — see
below. Nothing else.

## Excluded, with reasons

These are suppressed in `slither.config.json`. The reasons live here because
JSON has no comments and Slither warns about unknown keys, so a config that
explains itself makes the CI log noisier every run.

### `timestamp` — 5 findings

Every deadline in this contract is a business deadline measured in days: a
14-day supplier claim window, a 7-day proposal TTL, a 30-day budget window.
Miner drift of a few seconds cannot matter to any of them. The alternative is
a block-number clock, which drifts against the calendar instead — worse for
something a supplier's contract terms refer to.

`cancelPO`'s `po.since >= windowStart` is flagged by the same detector and is
a comparison between two stored timestamps, not against `block.timestamp`.

### `missing-zero-check` on `nominatePlant(nominee)`

The one still reported, and a false positive. The zero address is the documented way to call off a
handover that has not been accepted — guarding it would remove the ability to
cancel a nomination, which is the safety property the two-step handover exists
to provide.

### `naming-convention` — 3 findings

`_agent`, `_monthlyCap`, `_autoApproveMax` are constructor and setter
parameters shadow-named against the state variables they assign. This is the
convention the contract uses throughout and renaming them makes the assignment
harder to read, not easier.

### `pragma`, `solc-version`, `assembly` — 9 findings

All from OpenZeppelin's `SafeERC20` and `IERC20`. Ours is a single
`^0.8.28`. Upgrading OpenZeppelin is the fix if they ever matter; suppressing
our own pragma would not.

## What this does not cover

Slither does not reason about the economics: whether the cap is the right
size, whether the auto-approve ceiling is set where a plant would want it,
whether the escrow lifecycle matches what a supplier would sign. It also does
not model the agent, which is the part that decides how the money moves.

Those need a human, and real money needs one before it moves.
