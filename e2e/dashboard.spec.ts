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
    await page.route("**/api/po", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "That order has already moved past this step." }),
      }),
    );
    await page.goto("/");
    // Orders arrive from an async fetch; looking before they land skips the
    // test for the wrong reason.
    await expect(page.locator(".po").first()).toBeVisible({ timeout: 15_000 });

    const button = page.getByRole("button", { name: /Confirm receipt|Approve \$/ }).first();
    await expect(button, "expected an actionable order on chain").toBeVisible({ timeout: 15_000 });

    await button.click();
    await expect(page.locator(".error")).toContainText("already moved past this step");
  });
});
