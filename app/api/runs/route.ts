import { recentActions, recentRuns } from "@/lib/journal.ts";
import { denied } from "@/lib/guard.ts";

export const dynamic = "force-dynamic";

/**
 * Past shift assessments, and who pressed what.
 *
 * Behind the same gate as the routes that move money. The reasoning trace
 * names machines, suppliers, prices and the plant's own stock position —
 * that is the plant's commercial position, not something a public demo hands
 * to anyone who asks.
 */
export async function GET(req: Request) {
  const no = denied(req);
  if (no) return no;

  const url = new URL(req.url);
  const raw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(raw) || 20, 1), 200);

  return Response.json({
    runs: recentRuns(limit),
    actions: recentActions(limit),
  });
}
