import {
  clearedCookie,
  issueSession,
  passwordAuthEnabled,
  sessionCookie,
  verifyPassword,
} from "@/lib/auth.ts";

export const dynamic = "force-dynamic";

/**
 * Deliberately slow to fail. scrypt already costs ~100ms, which is most of
 * the rate limiting a single-operator login needs; this makes a wrong
 * password cost the same as a right one from the outside.
 */
export async function POST(req: Request) {
  const stored = process.env.OPERATOR_PASSWORD_HASH;
  if (!passwordAuthEnabled() || !stored) {
    return Response.json({ error: "No operator password is configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const password = (body as { password?: unknown }).password;
  if (typeof password !== "string" || password === "") {
    return Response.json({ error: "Password required." }, { status: 400 });
  }

  if (!verifyPassword(password, stored)) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie(issueSession()) } },
  );
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie() } });
}
