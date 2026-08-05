/**
 * The two POST routes sign transactions with the plant's and the agent's
 * keys. On localhost that is fine — the only caller is the person running it.
 * Exposed on the open internet it is not: anyone could drain the treasury or
 * burn inference credits.
 *
 * This is a demo speed bump, not authentication. A shared secret sent from
 * the browser is readable by anyone who loads the page; it stops drive-by
 * traffic and nothing more. Production needs real sessions and the agent key
 * in a KMS, not an env var. Said plainly rather than dressed up.
 */
export function denied(req: Request): Response | null {
  // Localhost is the operator's own machine. Requiring the header there only
  // locks you out of your own demo — and you will be setting DEMO_SECRET on
  // the same machine you deploy from.
  if (process.env.NODE_ENV !== "production") return null;

  const secret = process.env.DEMO_SECRET;
  if (!secret) {
    return Response.json(
      {
        error:
          "DEMO_SECRET is not set. These endpoints move funds, so they stay closed on a public deployment. Set DEMO_SECRET (and NEXT_PUBLIC_DEMO_SECRET) to open them, or run the demo locally.",
      },
      { status: 503 },
    );
  }

  return req.headers.get("x-demo-secret") === secret
    ? null
    : Response.json({ error: "unauthorized" }, { status: 401 });
}
