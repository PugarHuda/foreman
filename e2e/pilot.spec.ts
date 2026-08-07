import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * The pilot surfaces: telemetry ingest, the asset register, an ERP behind
 * HTTP, and a real operator login.
 *
 * These need an instance started with pilot environment, which is not the one
 * `npm run test:e2e` brings up — so they are skipped unless PILOT_BASE_URL
 * points at one. A skipped test that says why beats a suite that only passes
 * on one person's machine.
 *
 *   PILOT_BASE_URL=http://localhost:3112 \
 *   PILOT_TELEMETRY_TOKEN=… PILOT_PASSWORD=… npx playwright test pilot
 */
const BASE = process.env.PILOT_BASE_URL;
const CRON = process.env.PILOT_CRON_TOKEN ?? "";
const TOKEN = process.env.PILOT_TELEMETRY_TOKEN ?? "";
const PASSWORD = process.env.PILOT_PASSWORD ?? "";
const TAG = process.env.PILOT_TAG ?? "LATHE-01";
/** A pilot instance whose ERP charges per call, plus that merchant's log URL. */
const X402 = process.env.PILOT_X402_BASE;
const MERCHANT = process.env.PILOT_X402_MERCHANT;

test.skip(!BASE, "set PILOT_BASE_URL to an instance running in pilot configuration");

const api = () => playwrightRequest.newContext({ baseURL: BASE });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

test.describe("happy path — a plant's own machine and its own readings", () => {
  test("serves the asset register from the file, not the fixture", async () => {
    const ctx = await api();
    const body = await (await ctx.get("/api/state")).json();

    expect(body.live, "TELEMETRY_SOURCE should be file in a pilot").toBe(true);
    expect(body.machines.map((m: { tag: string }) => m.tag)).toContain(TAG);
    expect(
      body.machines.some((m: { tag: string }) => m.tag === "CNC-07"),
      "the demo fixture must not leak into a pilot",
    ).toBe(false);
    await ctx.dispose();
  });

  test("accepts a batch of readings and trends them", async () => {
    const ctx = await api();

    const before = await (await ctx.get("/api/state")).json();
    const readings = Array.from({ length: 24 }, (_, i) => ({
      at: Date.now() + i * 60_000,
      // Climbing, so the fit has something to extrapolate.
      rms: 4.0 + i * 0.05,
    }));

    const res = await ctx.post("/api/telemetry", { headers: bearer(TOKEN), data: { tag: TAG, readings } });
    expect(res.status()).toBe(200);
    expect((await res.json()).accepted).toBe(24);

    const after = await (await ctx.get("/api/state")).json();
    expect(after.series.length).toBeGreaterThan(before.series.length);
    expect(after.hoursMax).toBeGreaterThanOrEqual(before.hoursMax);
    await ctx.dispose();
  });

  test("quotes come from the ERP and carry a price the agent is held to", async () => {
    const ctx = await api();
    const body = await (await ctx.get("/api/state")).json();

    expect(body.quotes.length).toBeGreaterThan(0);
    for (const q of body.quotes) {
      expect(q.priceUsd).toBeGreaterThan(0);
      expect(q.leadTimeHours).toBeGreaterThan(0);
    }
    await ctx.dispose();
  });

  test("the panel renders the pilot machine rather than an empty page", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await expect(page.getByText(TAG, { exact: true })).toBeVisible();
    await expect(page.locator(".machine .rms").first()).toHaveText(/^\d+\.\d{2}$/);
  });

  /* A dead gateway leaves a flat tail on a healthy number, which is what a
     machine in good condition looks like. Whether this machine is currently
     stale depends on how the instance was seeded, so assert the invariant
     that has to hold either way rather than one particular state. */
  test("never reports a projected life for a machine that is not reporting", async () => {
    const ctx = await api();
    const body = await (await ctx.get("/api/state")).json();

    for (const m of body.machines) {
      if (!m.reporting) {
        expect(m.rulHours, `${m.tag} is not reporting but claims a life`).toBeNull();
        expect(m.r2, `${m.tag} is not reporting but claims a fit`).toBe(0);
      }
      if (m.stale) expect(m.reporting, `${m.tag} is stale but reads as reporting`).toBe(false);
    }
    await ctx.dispose();
  });
});

test.describe("wrong path — ingest refuses what it should", () => {
  /* Written out rather than looped: test/audit.test.ts counts `test(` in the
     source to keep the documented totals honest, and a loop turns one source
     line into two running tests. */
  const postAs = async (headers: Record<string, string>) => {
    const ctx = await api();
    const res = await ctx.post("/api/telemetry", {
      headers,
      data: { tag: TAG, readings: [{ at: Date.now(), rms: 4 }] },
    });
    const status = res.status();
    await ctx.dispose();
    return status;
  };

  test("rejects no token at all", async () => {
    expect(await postAs({ "Content-Type": "application/json" })).toBe(401);
  });

  test("rejects a token that is not the one", async () => {
    expect(await postAs(bearer("not-the-token"))).toBe(401);
  });

  /* The tag names a file on disk. It is checked against the asset register
     rather than sanitised, because an allowlist cannot be traversed out of. */
  test("rejects a tag that is not a registered machine, traversal included", async () => {
    const ctx = await api();
    for (const tag of ["../../etc/passwd", "..\\..\\windows\\system32", "NOPE-99", "", null]) {
      const res = await ctx.post("/api/telemetry", {
        headers: bearer(TOKEN),
        data: { tag, readings: [{ at: Date.now(), rms: 4 }] },
      });
      expect(res.status(), `tag ${JSON.stringify(tag)} was accepted`).toBe(404);
    }
    await ctx.dispose();
  });

  /* Number(null) is 0, and 0 mm/s is the healthiest reading on the scale. A
     sensor publishing nulls has to look broken, not perfect. */
  test("rejects a reading that would read as a healthy machine", async () => {
    const ctx = await api();
    for (const rms of [null, "", "n/a", undefined, [], {}]) {
      const res = await ctx.post("/api/telemetry", {
        headers: bearer(TOKEN),
        data: { tag: TAG, readings: [{ at: Date.now(), rms }] },
      });
      expect(res.status(), `rms ${JSON.stringify(rms)} was accepted`).toBe(400);
    }
    await ctx.dispose();
  });

  test("rejects a time it cannot read", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/telemetry", {
      headers: bearer(TOKEN),
      data: { tag: TAG, readings: [{ at: "last tuesday", rms: 4 }] },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test("catches a unit mix-up instead of declaring an emergency", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/telemetry", {
      headers: bearer(TOKEN),
      data: { tag: TAG, readings: [{ at: Date.now(), rms: 3900 }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/µm\/s/);
    await ctx.dispose();
  });

  test("rejects an empty batch and a body that is not a batch", async () => {
    const ctx = await api();
    for (const readings of [[], "nope", null, 42]) {
      const res = await ctx.post("/api/telemetry", {
        headers: bearer(TOKEN),
        data: { tag: TAG, readings },
      });
      expect(res.status(), `${JSON.stringify(readings)} was accepted`).toBe(400);
    }
    await ctx.dispose();
  });

  test("rejects a batch large enough to be a denial of service", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/telemetry", {
      headers: bearer(TOKEN),
      data: { tag: TAG, readings: Array.from({ length: 10_001 }, () => ({ at: Date.now(), rms: 4 })) },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  /* The bridge re-queues a batch whose response it never saw, so a POST that
     landed but whose reply was lost arrives twice. A duplicated hour bends
     the fit towards whatever happened during it. */
  test("stores a replayed batch once and says how many were duplicates", async () => {
    const ctx = await api();
    /* Two days ahead of anything the other tests in this file write. Ingest
       drops whatever is not newer than the last reading on file, so a batch
       that overlaps an earlier test's would be rejected for the right reason
       and fail this one for the wrong one. */
    const base = Date.now() + 2 * 86_400_000;
    const readings = Array.from({ length: 5 }, (_, i) => ({
      at: base + i * 60_000,
      rms: 4.5 + i * 0.02,
    }));

    const first = await (
      await ctx.post("/api/telemetry", { headers: bearer(TOKEN), data: { tag: TAG, readings } })
    ).json();
    expect(first.stored).toBe(5);
    expect(first.duplicates).toBe(0);

    const replay = await (
      await ctx.post("/api/telemetry", { headers: bearer(TOKEN), data: { tag: TAG, readings } })
    ).json();
    expect(replay.stored, "a replay must store nothing").toBe(0);
    expect(replay.duplicates).toBe(5);
    expect(replay.ok, "and must not look like a failure to the bridge").toBe(true);
    await ctx.dispose();
  });

  test("a rejected batch leaves the trend untouched", async () => {
    const ctx = await api();
    const before = await (await ctx.get("/api/state")).json();
    await ctx.post("/api/telemetry", {
      headers: bearer(TOKEN),
      data: { tag: TAG, readings: [{ at: Date.now(), rms: 4 }, { at: Date.now(), rms: null }] },
    });
    const after = await (await ctx.get("/api/state")).json();
    expect(after.series.length, "one bad reading must void the whole batch").toBe(
      before.series.length,
    );
    await ctx.dispose();
  });
});

test.describe("wrong path — the money routes need a session", () => {
  test.skip(!PASSWORD, "set PILOT_PASSWORD to exercise the login");

  test("refuses without one, and names the reason", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/po", { data: { action: "cancel", id: 0 } });
    expect(res.status()).toBe(401);
    expect((await res.json()).login).toBe(true);
    await ctx.dispose();
  });

  test("refuses the demo secret once a real password is configured", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/po", {
      headers: { "x-demo-secret": process.env.DEMO_SECRET ?? "anything" },
      data: { action: "cancel", id: 0 },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("refuses a wrong password without saying which part was wrong", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/login", { data: { password: `${PASSWORD}x` } });
    expect(res.status()).toBe(401);
    expect(await res.text()).not.toContain(PASSWORD);
    await ctx.dispose();
  });

  test("refuses a missing or non-string password rather than throwing", async () => {
    const ctx = await api();
    for (const password of [undefined, "", 42, null, { a: 1 }]) {
      const res = await ctx.post("/api/login", { data: { password } });
      expect([400, 401], `password ${JSON.stringify(password)}`).toContain(res.status());
    }
    await ctx.dispose();
  });

  test("the telemetry token does not open the money routes", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/po", {
      headers: bearer(TOKEN),
      data: { action: "cancel", id: 0 },
    });
    expect(res.status(), "a leaked sensor credential must not be able to spend").toBe(401);
    await ctx.dispose();
  });

  test("the right password opens them, and the cookie is not readable by script", async ({
    page,
  }) => {
    const ctx = await api();
    const login = await ctx.post("/api/login", { data: { password: PASSWORD } });
    expect(login.status()).toBe(200);

    const res = await ctx.post("/api/po", { data: { action: "cancel", id: 999_999 } });
    expect(res.status(), "the session should get past the gate to a real 404").toBe(404);
    await ctx.dispose();

    await page.goto(`${BASE}/dashboard`);
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("foreman_session");
  });

  test("the operator's session does not open telemetry ingest", async () => {
    const ctx = await api();
    await ctx.post("/api/login", { data: { password: PASSWORD } });
    const res = await ctx.post("/api/telemetry", {
      data: { tag: TAG, readings: [{ at: Date.now(), rms: 4 }] },
    });
    expect(res.status(), "the two credentials are separate on purpose").toBe(401);
    await ctx.dispose();
  });
});


test.describe("wrong path — the schedule spends without a human watching", () => {
  test("refuses a scheduled run with no token", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/cron", { data: {} });
    expect([401, 503]).toContain(res.status());
    await ctx.dispose();
  });

  test("refuses a scheduled run with the wrong token", async () => {
    const ctx = await api();
    const res = await ctx.post("/api/cron", { headers: bearer("not-the-cron-token"), data: {} });
    expect([401, 503]).toContain(res.status());
    await ctx.dispose();
  });

  /* Three credentials, three jobs. A leaked one must not become the others. */
  test("neither the operator session nor the ingest token starts a scheduled run", async () => {
    test.skip(!PASSWORD, "needs PILOT_PASSWORD");
    const ctx = await api();
    await ctx.post("/api/login", { data: { password: PASSWORD } });
    expect([401, 503]).toContain((await ctx.post("/api/cron", { data: {} })).status());
    expect([401, 503]).toContain(
      (await ctx.post("/api/cron", { headers: bearer(TOKEN), data: {} })).status(),
    );
    await ctx.dispose();
  });

  test("the cron token does not open the money routes or ingest", async () => {
    test.skip(!CRON, "needs PILOT_CRON_TOKEN");
    const ctx = await api();
    expect((await ctx.post("/api/po", { headers: bearer(CRON), data: { action: "cancel", id: 0 } })).status()).toBe(401);
    expect(
      (await ctx.post("/api/telemetry", {
        headers: bearer(CRON),
        data: { tag: TAG, readings: [{ at: Date.now(), rms: 4 }] },
      })).status(),
    ).toBe(401);
    await ctx.dispose();
  });
});

test.describe("the journal keeps what the panel used to lose", () => {
  test.skip(!PASSWORD, "set PILOT_PASSWORD to reach the journal");

  test("is behind the same gate as the money routes", async () => {
    const ctx = await api();
    const res = await ctx.get("/api/runs");
    expect(res.status(), "the trace names suppliers, prices and stock").toBe(401);
    await ctx.dispose();
  });

  test("returns runs and operator actions once signed in", async () => {
    const ctx = await api();
    await ctx.post("/api/login", { data: { password: PASSWORD } });
    const body = await (await ctx.get("/api/runs?limit=5")).json();

    expect(Array.isArray(body.runs)).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);
    await ctx.dispose();
  });

  /* Every action on chain is the plant key, so the chain cannot say which
     person pressed it. The journal is the only place that can. */
  test("records who attempted an action, including one the contract refused", async () => {
    const ctx = await api();
    await ctx.post("/api/login", { data: { password: PASSWORD } });
    await ctx.post("/api/po", { data: { action: "confirm", id: 0 } });

    const body = await (await ctx.get("/api/runs?limit=50")).json();
    const mine = body.actions.find((a: { poId: number }) => a.poId === 0);
    expect(mine, "the attempt should be on record either way").toBeTruthy();
    expect(mine.operator).toBe("operator");
    await ctx.dispose();
  });

  test("clamps a silly limit rather than reading the whole file", async () => {
    const ctx = await api();
    await ctx.post("/api/login", { data: { password: PASSWORD } });
    for (const limit of ["999999", "-1", "abc", ""]) {
      const res = await ctx.get(`/api/runs?limit=${limit}`);
      expect(res.status(), `limit=${limit}`).toBe(200);
      expect((await res.json()).runs.length).toBeLessThanOrEqual(200);
    }
    await ctx.dispose();
  });
});

test.describe("wrong path — guessing an operator password", () => {
  test.skip(!PASSWORD, "set PILOT_PASSWORD to exercise the lockout");

  /* scrypt makes each guess cost ~100ms, which is most of it. The lockout is
     the rest: an unattended panel on a plant network is not a password oracle
     with a slow clock. */
  test("locks the account after enough wrong guesses, then says when to retry", async () => {
    const ctx = await api();
    let sawLockout = false;

    for (let i = 0; i < 7; i++) {
      const res = await ctx.post("/api/login", {
        data: { operator: "lockme", password: `wrong-${i}` },
      });
      if (res.status() === 429) {
        sawLockout = true;
        expect((await res.json()).error).toMatch(/minutes/);
        break;
      }
      expect(res.status()).toBe(401);
    }

    expect(sawLockout, "seven wrong guesses should have locked it").toBe(true);
    await ctx.dispose();
  });

  test("locking one account does not lock the shift out of the panel", async () => {
    const ctx = await api();
    for (let i = 0; i < 7; i++) {
      await ctx.post("/api/login", { data: { operator: "someone-else", password: `no-${i}` } });
    }
    const res = await ctx.post("/api/login", { data: { password: PASSWORD } });
    expect(res.status(), "the real operator must still be able to sign in").toBe(200);
    await ctx.dispose();
  });

  test("does not reveal whether the operator exists", async () => {
    const ctx = await api();
    const unknown = await ctx.post("/api/login", { data: { operator: "ghost", password: "x".repeat(20) } });
    const known = await ctx.post("/api/login", { data: { operator: "operator", password: "x".repeat(20) } });

    expect(await unknown.text()).toBe(await known.text());
    await ctx.dispose();
  });
});


/**
 * Paying for data, over HTTP 402.
 *
 * Needs a second pilot instance pointed at a metered supplier API, so it is
 * skipped unless PILOT_X402_BASE and PILOT_X402_MERCHANT are both set.
 */
test.describe("x402 — the agent buys the information it reasons with", () => {
  test.skip(!X402 || !MERCHANT, "set PILOT_X402_BASE and PILOT_X402_MERCHANT");

  const x402 = () => playwrightRequest.newContext({ baseURL: X402 });
  const merchantLog = async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: MERCHANT });
    const log = await (await ctx.get("/_log")).json();
    await ctx.dispose();
    return log as { url: string; paid: boolean; decoded?: Record<string, any> }[];
  };

  test("gets quotes out of an endpoint that charges for them", async () => {
    const ctx = await x402();
    const body = await (await ctx.get("/api/state")).json();

    expect(body.quotes.length, "a 402 that was not paid yields no quotes").toBeGreaterThan(0);
    expect(body.quotes[0].priceUsd).toBeGreaterThan(0);
    await ctx.dispose();
  });

  test("pays only after being asked, never pre-emptively", async () => {
    const log = await merchantLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].paid, "the first call must be the unpaid one that gets the challenge").toBe(false);
    expect(log.some((e) => e.paid), "and something must have been paid after it").toBe(true);
  });

  /* The merchant offers the same asset on two chains, and the wrong-chain
     offer is priced at 1 unit against 2500. Taking the cheap one would be the
     obvious optimisation and would send real money to a chain the plant never
     authorised. */
  test("refuses a cheaper offer on a chain it was not authorised for", async () => {
    const log = await merchantLog();
    const paid = log.filter((e) => e.paid && e.decoded);

    expect(paid.length).toBeGreaterThan(0);
    for (const e of paid) {
      expect(e.decoded!.network, "paid on the wrong network").toBe("eip155:84532");
      expect(e.decoded!.payload.authorization.value).toBe("2500");
    }
  });

  test("signs EIP-3009 as the agent, with a bounded window and a random nonce", async () => {
    const log = await merchantLog();
    const paid = log.find((e) => e.paid && e.decoded)!;
    const auth = paid.decoded!.payload.authorization;

    expect(paid.decoded!.scheme).toBe("exact");
    expect(auth.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(Number(auth.validBefore)).toBeGreaterThan(Number(auth.validAfter));
    // EIP-3009 replays anything reused, so this must be random, not a counter.
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("gives every payment its own nonce", async () => {
    const log = await merchantLog();
    const nonces = log
      .filter((e) => e.paid && e.decoded)
      .map((e) => e.decoded!.payload.authorization.nonce);

    expect(new Set(nonces).size, "a reused nonce is a replayable payment").toBe(nonces.length);
  });
});
