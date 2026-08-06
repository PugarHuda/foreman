import { getState, explorerBase } from "@/lib/chain.ts";
import { MACHINES, getQuotes } from "@/lib/plant.ts";

export const dynamic = "force-dynamic";

/**
 * The order book as a file somebody can hand to an auditor.
 *
 * Every column here is read off the contract, so the export and the chain
 * cannot disagree — and the reference column lets anyone re-derive the row
 * from a block explorer rather than trusting the file. That is the difference
 * between an audit trail and a report.
 */
const COLUMNS = [
  "order_id",
  "machine",
  "part",
  "supplier",
  "amount_usd",
  "status",
  "signed_by",
  "rul_hours_at_order",
  "waybill",
  "contract",
  "explorer",
] as const;

const escape = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export async function GET() {
  let state;
  try {
    state = await getState();
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message.split("\n")[0] : String(e) },
      { status: 502 },
    );
  }

  const explorer = explorerBase();
  const rows = state.pos.map((po) => {
    const machine = MACHINES.find((m) => m.id === po.machineId);
    const quote = getQuotes(po.partNo).find(
      (q) => q.address.toLowerCase() === po.supplier.toLowerCase(),
    );
    return [
      po.id,
      machine?.tag ?? po.machineId,
      po.partNo,
      quote?.supplier ?? po.supplier,
      po.amountUsd.toFixed(2),
      po.status,
      po.agentFunded ? "agent" : "plant",
      po.rulHoursAtOrder || "",
      po.waybill ?? "",
      state.foreman,
      explorer ? `${explorer}/address/${state.foreman}` : "",
    ];
  });

  const csv = [COLUMNS.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const day = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="foreman-orders-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
