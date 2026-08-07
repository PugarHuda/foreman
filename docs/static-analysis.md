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

**19 findings. None medium or above.** Below is every one of them.

## Acted on

Nothing yet, and that is a deliberate trade rather than an omission — see
"Deferred to the next deployment" below.

## Deferred to the next deployment

Two findings are real and both need a redeployed contract to fix. The
deployed contract is verified on Base Sepolia and the README stakes its whole
argument on the bytecode there matching this source; changing the source
without redeploying breaks that claim, and redeploying invalidates every
transaction link the README asks a judge to check. Neither finding can lose
funds, so they wait for the deployment that mainnet needs anyway.

### `missing-zero-check` on `setPolicy(_agent)`

`setPolicy(address(0), cap, ceiling)` sets the agent to the zero address,
which disables the autonomous lane entirely — nobody can satisfy
`msg.sender == agent`. It is plant-only and the plant can undo it with another
`setPolicy`, so it is a footgun rather than a vulnerability. It is also
inconsistent: `setSupplier` already reverts with `BadSupplier` on the zero
address.

Fix at next deployment: `if (_agent == address(0)) revert BadSupplier();` —
or a dedicated `BadAgent` error.

### `unindexed-event-address` on `PolicySet`

`PolicySet(address agent, uint128 monthlyCap, uint128 autoApproveMax)` has no
indexed parameters, so a log consumer cannot filter policy changes by agent.
An observability gap, not a correctness one — the state is readable from
`agent()` at any time.

Fix at next deployment: `event PolicySet(address indexed agent, ...)`.

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

A false positive here. The zero address is the documented way to call off a
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
