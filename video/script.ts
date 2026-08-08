/**
 * The pitch, as narration.
 *
 * One entry per spoken line. `say` is what the voice reads and `caption` is
 * what the viewer sees — they differ where a number reads badly aloud: a
 * synthesiser says "one hundred and eighty dollars" convincingly and "$180"
 * unpredictably, while a caption should show the figure.
 *
 * `scene` picks which visual the line plays over. Nothing here carries a
 * duration: those come from the rendered audio, measured with ffprobe, so a
 * caption cannot drift out of sync with the voice reading it. Guessing
 * timings and then recording to fit them is how subtitles end up a beat late
 * for the whole video.
 */
export type Scene =
  | "cold-open"
  | "problem"
  | "cost"
  | "loop"
  | "lanes"
  | "product"
  | "trust"
  | "live"
  | "close";

export interface Line {
  id: string;
  scene: Scene;
  say: string;
  caption: string;
}

export const LINES: Line[] = [
  {
    id: "01",
    scene: "cold-open",
    say: "A bearing on a machining line has fifty-eight hours of life left. Nobody is watching at two in the morning.",
    caption: "A bearing has 58 hours of life left.\nNobody is watching at 02:00.",
  },
  {
    id: "02",
    scene: "problem",
    say: "Industrial four point zero put sensors on the machine. It left a human to read the dashboard, raise a requisition, chase three quotes, and wait for a purchase order number.",
    caption:
      "Industrial 4.0 put sensors on the machine.\nIt left a human to raise a requisition, chase three\nquotes, and wait for a PO number.",
  },
  {
    id: "03",
    scene: "problem",
    say: "The data was automated. The decision to cash loop was not. And that is the one that costs a shift.",
    caption: "The data was automated.\nThe decision-to-cash loop was not.",
  },
  {
    id: "04",
    scene: "cost",
    say: "An unplanned stop on that machine costs eight hundred and ninety dollars an hour. The bearing costs one hundred and eighty.",
    caption: "The stop costs $890/hour.\nThe bearing costs $180.",
  },
  {
    id: "05",
    scene: "loop",
    say: "Foreman closes the loop. It fits the vibration trend log-linearly, and projects the hour the bearing crosses the standard's stop-the-machine threshold.",
    caption:
      "Foreman fits the trend log-linearly and projects\nthe ISO 10816-3 Zone D crossing.",
  },
  {
    id: "06",
    scene: "loop",
    say: "If the shelf is empty, and no supplier lead time beats the failure, it buys the part. Payment settles into on-chain escrow, against a spend permission the plant manager signed weeks earlier.",
    caption:
      "Empty shelf, no lead time that beats the failure —\nit buys, into escrow, under a permission\nsigned weeks earlier.",
  },
  {
    id: "07",
    scene: "lanes",
    say: "A one hundred and eighty dollar bearing executes alone.",
    caption: "$180 bearing — executes alone.",
  },
  {
    id: "08",
    scene: "lanes",
    say: "A four thousand dollar spindle stops, and waits for a person.",
    caption: "$4,000 spindle — stops for a person.",
  },
  {
    id: "09",
    scene: "lanes",
    say: "That split is enforced by the contract. Not by a policy document nobody opens.",
    caption: "The split is enforced on chain.\nNot in a policy document.",
  },
  {
    id: "10",
    scene: "product",
    say: "This is the control room. Machine health on the severity rail, the projected crossing, and the agent reasoning its way to a decision about money, as it happens.",
    caption:
      "The control room: severity rail, projected crossing,\nand the agent reasoning, live.",
  },
  {
    id: "11",
    scene: "trust",
    say: "The agent cannot invent a payee. It cannot re-buy a part already on its way. It cannot overspend, and it cannot release escrow on a bare click.",
    caption:
      "Cannot invent a payee. Cannot re-buy what is coming.\nCannot overspend. Cannot release escrow on a click.",
  },
  {
    id: "12",
    scene: "trust",
    say: "Prompt injection, a hallucinated address, a compromised model provider — all of them end at the same place. A revert.",
    caption:
      "Prompt injection, a hallucinated address,\na compromised provider — all end at a revert.",
  },
  {
    id: "13",
    scene: "live",
    say: "It is running on Base Sepolia right now, and it is verified. Press run agent, and it spends real testnet money on your behalf — bounded by the same contract a plant would rely on.",
    caption:
      "Live on Base Sepolia, verified.\nPress Run agent and it spends real testnet money,\nbounded by the same contract.",
  },
  {
    id: "14",
    scene: "close",
    say: "Foreman. The machine asks for its own spare part. A human sets the limit, once.",
    caption: "The machine asks for its own spare part.\nA human sets the limit, once.",
  },
];
