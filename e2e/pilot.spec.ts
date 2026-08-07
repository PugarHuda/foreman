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
const TOKEN = process.env.PILOT_TELEMETRY_TOKEN ?? "";
const PASSWORD = process.env.PILOT_PASSWORD ?? "";
const TAG = process.env.PILOT_TAG ?? "LATHE-01";

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
