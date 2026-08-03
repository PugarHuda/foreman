import { NextResponse } from "next/server";
import { approvePO, markShipped, confirmReceipt, cancelPO, txUrl } from "@/lib/chain.ts";
import { denied } from "@/lib/guard.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACTIONS = {
  approve: approvePO,
  ship: markShipped,
  confirm: confirmReceipt,
  cancel: cancelPO,
} as const;

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;

  const { action, id } = await req.json();
  const run = ACTIONS[action as keyof typeof ACTIONS];
  if (!run) return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });

  try {
    const hash = await run(Number(id));
    return NextResponse.json({ hash, url: txUrl(hash) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
