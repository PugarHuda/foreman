import { test, expect } from "@playwright/test";

test.describe("happy path — the control room reads correctly", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the plant's financial position", async ({ page }) => {
    for (const label of [
      "Plant treasury",
      "In escrow",
      "Agent budget left",
      "Signs alone up to",
      "Downtime bought back",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Money, not a placeholder dash.
    await expect(page.locator(".strip .value").first()).toHaveText(/^\$[\d,]+$/);
  });

  test("shows every machine with a severity reading", async ({ page }) => {
    const cards = page.locator(".machine");
    await expect(cards).toHaveCount(3);

    for (const tag of ["CNC-07", "PRESS-02", "CONV-11"]) {
      await expect(page.getByText(tag, { exact: true })).toBeVisible();
    }
    // Every card reads out an RMS value.
    await expect(page.locator(".machine .rms").first()).toHaveText(/^\d+\.\d{2}$/);
  });

  test("projects a failure for the degrading machine and none for the healthy ones", async ({
    page,
  }) => {
    await expect(page.locator(".machine").first()).toContainText("zone D in");
    await expect(page.locator(".machine").nth(1)).toContainText("trend flat");
    await expect(page.locator(".machine").nth(2)).toContainText("trend flat");
  });

  test("draws the trend with the projection to the Zone D crossing", async ({ page }) => {
    const svg = page.locator("svg[role=img]");
    await expect(svg).toBeVisible();
    await expect(svg).toContainText(/zone D · \d+/);
    await expect(svg).toContainText(/now \d+\.\d+ mm\/s/);
    // Four ISO severity bands behind the line.
    await expect(svg.locator("rect")).toHaveCount(4);
  });

  test("selecting another machine redraws the trend", async ({ page }) => {
    await expect(page.locator(".panel", { hasText: "vibration trend" })).toContainText("CNC-07");

    await page.locator(".machine", { hasText: "PRESS-02" }).click();
    await expect(page.locator(".panel", { hasText: "vibration trend" })).toContainText("PRESS-02");
  });

  test("moving the run hour forward shortens the remaining life", async ({ page }) => {
    const card = page.locator(".machine").first();
    const readAt = async () => {
      const text = (await card.textContent()) ?? "";
      return Number(text.match(/zone D in\s+([\d.]+)\s*h/)?.[1] ?? NaN);
    };

    const before = await readAt();
    expect(before).toBeGreaterThan(0);

    await page.locator('input[type="range"]').fill("332");
    await expect
      .poll(readAt, { message: "RUL should fall as the run hour advances" })
      .toBeLessThan(before);
  });

  test("keeps the page usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".wordmark")).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows, "the page must not scroll sideways on a phone").toBe(false);

    // The chart must fill its box rather than sit in a band of dead space.
    const svg = page.locator("svg[role=img]");
    const box = (await svg.boundingBox())!;
    const ratio = box.width / box.height;
    expect(ratio, "chart should keep its aspect ratio, not letterbox").toBeCloseTo(820 / 240, 0);
  });
});

test.describe("reachable without a mouse", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".machine").first()).toBeVisible();
  });

  test("a machine can be selected from the keyboard", async ({ page }) => {
    const press = page.locator(".machine", { hasText: "PRESS-02" });
    await press.focus();
    await expect(press).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(press).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".panel", { hasText: "vibration trend" })).toContainText("PRESS-02");
  });

  test("focus is visible, not just present", async ({ page }) => {
    const button = page.getByRole("button", { name: "Run agent" });
    await button.focus();

    const outline = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    expect(outline.style).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
  });

  test("the run hour responds to arrow keys", async ({ page }) => {
    const slider = page.locator('input[type="range"]');
    await slider.focus();
    const before = Number(await slider.inputValue());

    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(before);
  });

  test("the trend chart describes itself to a screen reader", async ({ page }) => {
    const label = await page.locator("svg[role=img]").getAttribute("aria-label");
    expect(label).toMatch(/millimetres per second/);
    expect(label).toMatch(/Zone D projected in/);
  });

  test("every control has an accessible name", async ({ page }) => {
    // `||` not `??`: textContent is "" for an input, and "" is not nullish,
    // so `??` never falls through to the wrapping label.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href], input")]
        .filter(
          (el) =>
            !(
              el.getAttribute("aria-label") ||
              el.textContent?.trim() ||
              el.closest("label")?.textContent?.trim()
            ),
        )
        .map((el) => `${el.tagName}.${el.className}`),
    );
    expect(unnamed, `controls with no accessible name: ${unnamed.join(", ")}`).toEqual([]);
  });
});

test.describe("wrong path — a broken backend says so", () => {
  test("a malformed state response is reported, not swallowed", async ({ page }) => {
    await page.route("**/api/state**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html>gateway error</html>" }),
    );
    await page.goto("/");

    // The failure mode to avoid is a dashboard of zeros that looks like a
    // working plant with no money.
    await expect(page.locator(".error")).toBeVisible({ timeout: 15_000 });
  });

  test("a failing state endpoint is reported", async ({ page }) => {
    await page.route("**/api/state**", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"upstream"}' }),
    );
    await page.goto("/");
    await expect(page.locator(".error")).toBeVisible({ timeout: 15_000 });
  });

  test("an unreadable chain shows dashes, never a confident zero", async ({ page }) => {
    // The API is fine; the RPC behind it is rate limiting. This is what the
    // panel actually did in front of a user — five tiles of $0.
    await page.route("**/api/state**", async (route) => {
      const body = await (await route.fetch()).json();
      body.chain = null;
      body.chainError = "RPC Request failed.\nDetails: over rate limit";
      body.avoidedUsd = 0;
      await route.fulfill({ json: body });
    });
    await page.goto("/");

    const values = page.locator(".strip .value");
    await expect(values.first()).toBeVisible();
    const shown = await values.allTextContents();

    expect(shown.every((v) => v.trim() === "—"), `tiles showed: ${shown.join(", ")}`).toBe(true);
    await expect(page.locator(".error")).toContainText("rate limiting");
  });

  test("real figures still render when the chain is readable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".strip .value").first()).toHaveText(/^\$[\d,]+$/, {
      timeout: 15_000,
    });
  });

  test("a connection that drops mid-request gives the control back", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".machine").first()).toBeVisible();

    // Not a hang — an outright failed connection, which is the same code path
    // as the abort without waiting out a 150s timeout in a test.
    await page.route("**/api/agent", (route) => route.abort("connectionfailed"));

    await page.getByRole("button", { name: "Run agent" }).click();
    await expect(page.locator(".error")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Run agent" }),
      "the operator must be able to try again without reloading",
    ).toBeEnabled();
  });

  test("an agent failure surfaces the reason", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".machine").first()).toBeVisible();

    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Venice 401: invalid api key" }),
      }),
    );
    await page.getByRole("button", { name: "Run agent" }).click();

    await expect(page.locator(".error")).toContainText("invalid api key");
    await expect(page.getByRole("button", { name: "Run agent" })).toBeEnabled();
  });

  test("a second agent run while one is in flight is explained", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".machine").first()).toBeVisible();

    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "The agent is already assessing this line." }),
      }),
    );
    await page.getByRole("button", { name: "Run agent" }).click();
    await expect(page.locator(".error")).toContainText("already assessing");
  });

  test("a render crash shows a recovery screen, not a blank page", async ({ page }) => {
    // Passes the shape check, then breaks in render: a machine with no
    // reading at all. This is what a mismatched deploy looks like.
    await page.route("**/api/state**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          machines: [{ id: 7, tag: "CNC-07" }],
          series: [],
          quotes: [],
          avoidedUsd: 0,
          explorer: "",
          chain: null,
          chainError: null,
        }),
      }),
    );
    await page.goto("/");

    await expect(page.getByText(/Something went wrong rendering the line/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("wrong path — bad input is refused, not crashed on", () => {
  test("a nonsense machine id falls back instead of 500ing", async ({ request }) => {
    const res = await request.get("/api/state?hours=300&machine=999");
    expect(res.status()).toBe(200);
    expect((await res.json()).machineId).toBe(7);
  });

  test("a non-numeric run hour falls back to the default", async ({ request }) => {
    const res = await request.get("/api/state?hours=abc&machine=7");
    expect(res.status()).toBe(200);
    expect((await res.json()).hours).toBe(300);
  });

  test("an out-of-range run hour is clamped", async ({ request }) => {
    expect((await (await request.get("/api/state?hours=99999")).json()).hours).toBe(400);
    expect((await (await request.get("/api/state?hours=-5")).json()).hours).toBe(1);
  });

  test("an unknown order action is rejected with the valid ones named", async ({ request }) => {
    const res = await request.post("/api/po", { data: { action: "drain", id: 0 } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("approve, ship, confirm, cancel");
  });

  test("an order that does not exist is a 404", async ({ request }) => {
    const res = await request.post("/api/po", { data: { action: "approve", id: 999999 } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/No order/);
  });

  test("a malformed order id is a 400", async ({ request }) => {
    // null, "" and [] all coerce to 0 — a missing id must never quietly
    // become an action on order #0.
    for (const id of [-1, 1.5, "abc", null, "", [], {}, true]) {
      const res = await request.post("/api/po", { data: { action: "approve", id } });
      expect(res.status(), `id ${JSON.stringify(id)}`).toBe(400);
    }
  });

  test("acting on an order past that step is refused in plain language", async ({ request }) => {
    // Public RPC reads occasionally come back empty; retry rather than skip,
    // because a test that quietly skips still reports green.
    let settled: { id: number } | undefined;
    for (let i = 0; i < 5 && !settled; i++) {
      const state = await (await request.get("/api/state")).json();
      settled = state.chain?.pos?.find(
        (p: { status: string }) => p.status === "Released" || p.status === "Cancelled",
      );
      if (!settled) await new Promise((r) => setTimeout(r, 1500));
    }
    expect(settled, "expected a settled order on chain to act against").toBeTruthy();

    const res = await request.post("/api/po", { data: { action: "approve", id: settled!.id } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("That order has already moved past this step.");
  });

  test("the dashboard surfaces a refused action instead of failing silently", async ({ page }) => {
    // Both endpoints are stubbed: this is about how the panel reacts to a
    // refusal, and it should not depend on what happens to be on chain.
    await page.route("**/api/state**", async (route) => {
      const real = await route.fetch();
      const body = await real.json();
      body.chain = {
        foreman: "0x0000000000000000000000000000000000000001",
        agent: "0x0000000000000000000000000000000000000002",
        availableUsd: 50000,
        escrowedUsd: 180,
        monthlyCapUsd: 2000,
        autoApproveMaxUsd: 500,
        remainingBudgetUsd: 1820,
        pos: [
          {
            id: 0,
            supplier: "0x0000000000000000000000000000000000000003",
            since: 0,
            status: "Funded",
            agentFunded: true,
            machineId: 7,
            amountUsd: 180,
            partNo: "6205-2RS",
            waybill: null,
          },
        ],
      };
      body.chainError = null;
      await route.fulfill({ json: body });
    });

    await page.route("**/api/po", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "That order has already moved past this step." }),
      }),
    );

    await page.goto("/");
    const button = page.getByRole("button", { name: "Confirm receipt & pay" }).first();
    await expect(button).toBeVisible({ timeout: 15_000 });

    await button.click();
    await expect(page.locator(".error")).toContainText("already moved past this step");
    await expect(button, "the control must come back, not stay stuck").toBeEnabled();
  });
});
