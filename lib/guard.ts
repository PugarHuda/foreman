/**
 * The POST routes sign transactions with the plant's and the agent's keys, so
 * something has to decide who may call them.
 *
 * Two gates, and which one is in force depends on how this is deployed:
 *
 *   OPERATOR_PASSWORD_HASH set — a real session. The password is never sent to
 *   the browser, the cookie is HttpOnly, and it expires. This is what a pilot
 *   runs.
 *
 *   DEMO_SECRET set instead — the original speed bump, kept because the public
 *   demo is meant to be pressed by strangers and its blast radius is the
 *   point. It is not authentication: the secret ships in the page bundle and
 *   anyone who loads the page can read it. Said plainly rather than dressed up.
 *
 * Neither set, in production, means closed. An endpoint that moves funds does
 * not default to open because someone forgot an env var.
 */
import { timingSafeEqual } from "node:crypto";
import { cookieFrom, passwordAuthEnabled, validSession } from "./auth.ts";
import { announceOnce, mainnetBlockers } from "./safety.ts";

export function denied(req: Request): Response | null {
  announceOnce();

  /* On mainnet a misconfiguration is not a papercut, so it closes the door
     rather than logging a line nobody reads. Checked before the local-dev
     bypass: `CHAIN=base` on a laptop is still real money. */
  const blockers = mainnetBlockers();
  if (blockers.length > 0) {
    return Response.json(
      { error: "Refusing to move real funds until this is fixed.", blockers },
      { status: 503 },
    );
  }

  // Localhost is the operator's own machine. Requiring a login there only
  // locks you out of your own demo.
  if (process.env.NODE_ENV !== "production") return null;

  if (passwordAuthEnabled()) {
    return validSession(cookieFrom(req))
      ? null
      : Response.json({ error: "unauthorized", login: true }, { status: 401 });
  }

  const secret = process.env.DEMO_SECRET;
  if (!secret) {
    return Response.json(
      {
        error:
          "No operator password and no DEMO_SECRET. These endpoints move funds, so they stay closed on a public deployment. Set OPERATOR_PASSWORD_HASH (npm run passwd) for a real login, or DEMO_SECRET for the public demo gate.",
      },
      { status: 503 },
    );
  }

  return req.headers.get("x-demo-secret") === secret
    ? null
    : Response.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Machines do not hold cookies. A gateway posting telemetry authenticates
 * with a bearer token of its own, so rotating an operator password does not
 * silence the sensors and a leaked gateway token cannot spend anything.
 */
export function deniedIngest(req: Request): Response | null {
  /* A comma-separated list, so a key can be rotated without a window where
     nothing can report: add the new one, move the gateways over, drop the old.
     One value is still one value, so nothing existing has to change. */
  const accepted = (process.env.TELEMETRY_TOKEN ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (accepted.length === 0) {
    return Response.json(
      { error: "TELEMETRY_TOKEN is not set — telemetry ingest is closed." },
      { status: 503 },
    );
  }

  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  /* Compared in constant time against each candidate. A gateway token is a
     bearer credential like any other, and a length-varying compare on a
     public endpoint is a free hint. */
  const ok = accepted.some((t) => {
    const a = Buffer.from(t);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  });

  return ok ? null : Response.json({ error: "unauthorized" }, { status: 401 });
}
