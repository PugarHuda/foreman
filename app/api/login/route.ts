import {
  authenticate,
  clearFailures,
  clearedCookie,
  issueSession,
  lockedUntil,
  passwordAuthEnabled,
  recordFailure,
  sessionCookie,
} from "@/lib/auth.ts";

export const dynamic = "force-dynamic";

/**
 * Deliberately slow to fail. scrypt already costs ~100ms, which is most of
 * the rate limiting a single-operator login needs; this makes a wrong
 * password cost the same as a right one from the outside.
 */
export async function POST(req: Request) {
  if (!passwordAuthEnabled()) {
    return Response.json({ error: "No operator password is configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const { password, operator } = body as { password?: unknown; operator?: unknown };

  /* One operator is still the common case, and it was the only case until
     accounts existed — so a login that names nobody is the default account. */
  const name = typeof operator === "string" && operator !== "" ? operator : "operator";

  if (typeof password !== "string" || password === "") {
    return Response.json({ error: "Password required." }, { status: 400 });
  }

  const until = lockedUntil(name);
  if (until) {
    return Response.json(
      {
        error: `Too many failed attempts. Try again in ${Math.ceil((until - Date.now()) / 60_000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const found = authenticate(name, password);
  if (!found) {
    recordFailure(name);
    // Deliberately not "no such operator" — the login does not enumerate who
    // works here, and the timing does not either.
    return Response.json({ error: "Wrong operator or password." }, { status: 401 });
  }

  clearFailures(name);
  return Response.json(
    { ok: true, operator: found.name },
    { headers: { "Set-Cookie": sessionCookie(issueSession(found.name)) } },
  );
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie() } });
}
