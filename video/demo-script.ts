/**
 * Narration for the demo recording.
 *
 * Each entry is keyed to a beat the recording emitted, so a line is spoken
 * while the thing it describes is on screen — however long the agent took
 * that day. `scripts/record-demo.mjs` writes video/demo-timeline.json with the
 * real second each beat happened at; nothing here carries a timing.
 *
 * What it does carry is a word budget. The first draft had one line per beat,
 * which put forty seconds of narration over sixteen seconds of picture and
 * left the supplier line arriving twenty-two seconds after that panel had
 * gone. The recording is paced for watching, not for talking over, so the
 * short tour beats are covered by one flowing line and the long agent beats
 * carry the argument.
 *
 * Roughly 2.4 words a second at speed 0.95. Beats and their windows:
 *
 *   opening              16.1s   ~38 words
 *   running the agent    33.1s   ~60
 *   escalates            24.9s   ~45
 *   it stops              8.0s   ~19
 *   a human approves     11.0s   ~26
 *   settling             14.1s   ~33
 *   issuing              10.4s   ~25
 *   final position       15.6s   ~37
 */
export interface DemoLine {
  /** Matches the `say()` label in scripts/record-demo.mjs. */
  beat: string;
  say: string;
  caption: string;
}

export const DEMO_LINES: DemoLine[] = [
  {
    beat: "opening the control room",
    say: "This is the control room, live on Base Sepolia. Three machines, and a fifty thousand dollar treasury. C N C oh seven is the one degrading — zone B, with fifty-eight hours before it must be stopped.",
    caption:
      "The control room, live on Base Sepolia.\nCNC-07 is degrading: Zone B, 58 hours left.",
  },
  {
    beat: "running the agent on the routine lane",
    say: "Now the agent runs. It reads the trend, checks the shelf and what is already on order, and prices the part against the two suppliers the plant has vetted. This is the model deciding, not a replay. Zero in stock, a supplier who can deliver inside the window — and one hundred and eighty dollars is under the ceiling, so it signs and funds it alone.",
    caption:
      "The agent reads the trend, the shelf, what is on order,\nand prices it against vetted suppliers.\n$180 is under the ceiling — it funds it alone.",
  },
  {
    beat: "advancing the run hour into Zone C",
    say: "Advance the run hour, and the machine crosses into zone C.",
    caption: "Advance the run hour. The machine crosses into Zone C.",
  },
  {
    beat: "now the bearing will not save it — the agent escalates",
    say: "A bearing no longer saves it. By zone C the shaft is already scored, so the agent escalates to the spindle cartridge — a different part, and a very different number.",
    caption:
      "By Zone C a bearing no longer saves it.\nThe agent escalates to the spindle.",
  },
  {
    beat: "it stops, because $4,000 is over the ceiling",
    say: "Four thousand dollars is over the ceiling. It stops. The order exists, and no money has moved.",
    caption: "$4,000 is over the ceiling. It stops.\nThe order exists. No money moved.",
  },
  {
    beat: "a human approves",
    say: "A human approves it, from a separate key. That approval bypasses the cap — because the cap bounds the agent, not the plant.",
    caption:
      "A human approves, from a separate key.\nThe cap bounds the agent, not the plant.",
  },
  {
    beat: "settling the bearing order",
    say: "Back to the bearing. The supplier despatches, committing to the waybill with their own key, and goods-in confirms against it. Only then does escrow release.",
    caption:
      "The supplier commits a waybill with their own key.\nEscrow releases only against a match.",
  },
  {
    beat: "issuing the part to the machine",
    say: "The part is issued to the machine. It leaves the store, which is what lets the agent order the next one.",
    caption: "The part leaves the store — which is what lets\nthe agent order the next one.",
  },
  {
    beat: "final position",
    say: "Every figure on this screen is a transaction you can look up on a block explorer. The agent committed one hundred and eighty dollars on its own, and stopped at four thousand.",
    caption:
      "Every figure is a transaction you can look up.\n$180 committed alone. Stopped at $4,000.",
  },
];
