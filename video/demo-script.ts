/**
 * Narration for the demo recording.
 *
 * Each entry is keyed to a beat the recording emitted, so a line is spoken
 * while the thing it describes is on screen — however long the agent took that
 * day. `scripts/record-demo.mjs` writes video/demo-timeline.json with the real
 * second each beat happened at, and the on-screen position of the thing it is
 * about. Nothing here carries a timing or a coordinate.
 *
 * `after` places a line partway into a beat's window. The two agent beats are
 * twenty and thirty seconds of the model working, and a single line over them
 * left fourteen seconds of silence twice — so those windows carry several
 * lines rather than one.
 *
 * `box` draws a frame around the region the recording measured for that beat.
 * Measured at the moment, not afterwards: the page scrolls and the agent panel
 * grows as its log fills, so a position taken later points at the wrong place.
 */
export interface DemoLine {
  /** Matches the `say()` label in scripts/record-demo.mjs. */
  beat: string;
  /** Seconds after the beat. Omit for "as it happens". */
  after?: number;
  say: string;
  caption: string;
  /** Frame the region this beat measured. */
  box?: boolean;
  /**
   * Dropped when there is no gap to put it in.
   *
   * The agent beats are the model working, and that took 27 seconds in one
   * recording and 50 in the next. A fixed script cannot fill both: written for
   * the long one it talks over itself on the short one, written for the short
   * one it leaves half a minute of silence on the long one.
   *
   * So the filler lines are optional, and the timing pass keeps only the ones
   * whose slot is still open when it gets there. A slow run uses more of them.
   */
  optional?: boolean;
}

export const DEMO_LINES: DemoLine[] = [
  {
    beat: "opening the control room",
    say: "The control room, live on Base Sepolia. Three machines, fifty thousand dollars in USDC.",
    caption: "The control room, live on Base Sepolia.\nThree machines, a $50,000 treasury.",
  },
  {
    beat: "CNC-07 is the one degrading",
    say: "C N C oh seven is degrading. Fifty-eight hours before it must be stopped.",
    caption: "CNC-07 is degrading — 58 hours left.",
    box: true,
  },
  {
    beat: "the trend and its projection to Zone D",
    say: "The dashed line is the projection, fitted to the trend.",
    caption: "The projection, fitted to the trend.",
    box: true,
  },
  {
    beat: "the trend and its projection to Zone D",
    after: 5,
    optional: true,
    say: "Hours of life left, rather than a red light after the fact.",
    caption: "Hours of life left — not a red light after the fact.",
  },
  {
    beat: "who the plant will pay, and nobody else",
    say: "And the only two addresses the plant will pay.",
    caption: "The only addresses the plant will pay.\nThe contract rejects any other.",
    box: true,
  },
  {
    beat: "running the agent on the routine lane",
    say: "Now the agent runs.",
    caption: "The agent runs.",
  },
  {
    beat: "running the agent on the routine lane",
    after: 4,
    say: "It reads each machine's health, then the shelf — on hand, and what is already on order, because a part on its way covers the machine just as well as one in the store.",
    caption:
      "It reads machine health, then the shelf — on hand\nand already on order.",
  },
  {
    beat: "running the agent on the routine lane",
    after: 15,
    say: "Then the quotes, with each supplier's delivered-on-time record read off the order book rather than kept in a spreadsheet. This is the model deciding, not a replay.",
    caption:
      "Then the quotes, with each supplier's record\nread off the order book.",
  },
  {
    beat: "running the agent on the routine lane",
    after: 26,
    optional: true,
    say: "Nothing here is hardcoded. It is reading the same tools a technician would, and it has to justify what it does with them.",
    caption: "Nothing is hardcoded — the same tools\na technician would read.",
  },
  {
    beat: "running the agent on the routine lane",
    after: 34,
    optional: true,
    say: "The reasoning is streamed as it happens, rather than arriving in a block after thirty seconds of spinner. A shift assessment is a sequence of decisions, and the sequence is the part worth watching.",
    caption: "The reasoning streams as it happens.\nThe sequence is the part worth watching.",
  },
  {
    beat: "capturing the README still",
    say: "Zero in stock, a supplier inside the window, and one hundred and eighty dollars is under the ceiling. It funds it alone.",
    caption: "$180 is under the ceiling — it signs and funds it alone.",
    box: true,
  },
  {
    beat: "advancing the run hour into Zone C",
    say: "Advance the run hour, and the machine crosses into zone C.",
    caption: "Advance the run hour. The machine crosses into Zone C.",
    box: true,
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    say: "A bearing no longer saves it. By zone C the shaft is already scored, so the agent escalates to the spindle cartridge.",
    caption:
      "By Zone C a bearing no longer saves it.\nThe agent escalates to the spindle.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    after: 9,
    say: "Different part, and a very different number. Watch what it does with it.",
    caption: "A different part — and a very different number.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    after: 16,
    say: "It also checks the other two machines, and orders nothing for either: one is covered by shelf stock, and the other's trend is too noisy to trust.",
    caption:
      "It checks the other two and orders nothing —\none is covered, the other's trend is untrustworthy.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    after: 24,
    optional: true,
    say: "It is also weighing the lead time. The only supplier of this part quotes a hundred and twenty hours against thirty-four hours of life left, so the part will land late — and it says so rather than pretending otherwise.",
    caption: "It weighs the lead time: 120 hours against 34.\nThe part will land late, and it says so.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    after: 34,
    optional: true,
    say: "That is the honest answer. Ordering late beats not ordering, and planning downtime around a known date beats discovering it on a night shift.",
    caption: "Ordering late beats not ordering.\nA known date beats a night-shift surprise.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    after: 42,
    optional: true,
    say: "Every one of those steps is a tool call against the plant's own systems, and every number it quotes came back from one. It is not describing a decision it already made.",
    caption: "Every step is a tool call against the plant's systems.\nIt is not narrating a decision already made.",
  },
  {
    beat: "it stops, because $4,000 is over the ceiling",
    say: "Four thousand dollars is over the ceiling, so it stops. The order exists, and no money has moved.",
    caption: "$4,000 is over the ceiling. It stops.\nThe order exists. No money moved.",
    box: true,
  },
  {
    beat: "a human approves",
    say: "A human approves it, from a separate key. That approval bypasses the cap — because the cap bounds the agent, not the plant.",
    caption:
      "A human approves, from a separate key.\nThe cap bounds the agent, not the plant.",
    box: true,
  },
  {
    beat: "settling the bearing order",
    say: "Back to the bearing. The supplier despatches, committing to the waybill with their own key.",
    caption: "The supplier commits a waybill with their own key.",
    box: true,
  },
  {
    beat: "settling the bearing order",
    after: 7,
    say: "Goods-in confirms against that document, and only then does escrow release to the supplier.",
    caption: "Goods-in confirms against it.\nOnly then does escrow release.",
  },
  {
    beat: "issuing the part to the machine",
    say: "The part is issued to the machine. It leaves the store, which is what lets the agent order the next one.",
    caption: "The part leaves the store — which is what lets\nthe agent order the next one.",
    box: true,
  },
  {
    beat: "final position",
    say: "Every figure here is a real transaction. One hundred and eighty committed alone, four thousand stopped.",
    caption:
      "Every figure is a transaction you can look up.\n$180 committed alone. Stopped at $4,000.",
    box: true,
  },
];
