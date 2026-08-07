import { NextResponse } from "next/server";
import {
  approvePO,
  markShipped,
  confirmReceipt,
  cancelPO,
  fitPart,
  poCount,
  txUrl,
} from "@/lib/chain.ts";
import { denied } from "@/lib/guard.ts";
import { cookieFrom, sessionOperator } from "@/lib/auth.ts";
import { recordAction } from "@/lib/journal.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACTIONS = {
  approve: approvePO,
  ship: markShipped,
  confirm: confirmReceipt,
  cancel: cancelPO,
  fit: fitPart,
} as const;

/**
 * Contract reverts turned into something a technician can act on. A raw
 * revert string in front of a judge reads as a crash; the same condition
 * named properly reads as the system refusing an invalid move.
 */
const REVERTS: Record<string, string> = {
  BadStatus: "That order has already moved past this step.",
  NotPlant: "Only the plant may do that.",
  NotAgent: "Only the agent may propose orders.",
  NotSupplier: "Only the supplier named on that order may mark it shipped.",
  SupplierNotApproved: "That supplier is not on the plant's approved list.",
  CapExceeded: "The agent's monthly budget is used up.",
  Underfunded: "The treasury does not hold enough to cover that.",
  TooEarly: "The receipt timeout has not elapsed yet.",
  BadAmount: "That amount is not valid.",
  BadSupplier: "That supplier address is not valid.",
  AlreadyOnOrder: "That machine already has an open order for that part.",
  DeliveryRefMismatch:
    "The reference goods-in submitted does not match the document the supplier committed to on despatch.",
  NoDeliveryRef: "A despatch must name the document that proves it.",
  BadPartNo: "That part number is empty or too long to store.",
  NotNominated: "Only the nominated key may accept the plant role.",
};

function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  for (const [name, text] of Object.entries(REVERTS)) {
    if (raw.includes(name)) return text;
  }
  return raw.split("\n")[0];
}

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;

  const body = await req.json().catch(() => ({}));
  const { action, id } = body as { action?: string; id?: unknown };

  const run = ACTIONS[action as keyof typeof ACTIONS];
  if (!run) {
    return NextResponse.json(
      { error: `Unknown action "${action}". Expected one of: ${Object.keys(ACTIONS).join(", ")}.` },
      { status: 400 },
    );
  }

  // Number(null), Number("") and Number([]) are all 0, so a missing id would
  // silently act on order #0. Demand a real number before coercing.
  const idIsUsable =
    typeof id === "number" || (typeof id === "string" && id.trim() !== "");
  const n = Number(id);
  if (!idIsUsable || !Number.isInteger(n) || n < 0) {
    return NextResponse.json({ error: "Order id must be a non-negative integer." }, { status: 400 });
  }

  try {
    if (n >= (await poCount())) {
      return NextResponse.json({ error: `No order #${n}.` }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json({ error: explain(e) }, { status: 502 });
  }

  /* On chain every one of these is the plant key, so the chain cannot say
     which person pressed it. That is what the journal is for. */
  const operator = sessionOperator(cookieFrom(req)) ?? "unauthenticated";
  const name = String(action);

  try {
    const hash = await run(n);
    recordAction({ at: new Date().toISOString(), operator, action: name, poId: n, hash });
    return NextResponse.json({ hash, url: txUrl(hash) });
  } catch (e) {
    const error = explain(e);
    recordAction({ at: new Date().toISOString(), operator, action: name, poId: n, error });
    // The move was refused by the contract, not broken by us.
    return NextResponse.json({ error }, { status: 409 });
  }
}
