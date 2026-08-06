/**
 * Drives the full demo against a running dev server and records it.
 *
 *   npm run dev            # terminal 1
 *   node scripts/record-demo.mjs
 *
 * Writes docs/demo.webm. Pacing is deliberately slow — this is meant to be
 * watched, and to have a voiceover laid over it.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = "docs";
const VIEWPORT = { width: 1600, height: 1100 };

const beat = (s) => new Promise((r) => setTimeout(r, s * 1000));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: OUT, size: VIEWPORT },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const say = (msg) => console.log(`  ${msg}`);

try {
  say("opening the control room");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator(".machine").first().waitFor();
  await beat(4); // let the treasury strip and machine cards land

  say("CNC-07 is the one degrading");
  await page.locator(".machine", { hasText: "CNC-07" }).hover();
  await beat(3);

  say("the trend and its projection to Zone D");
  await page.locator("svg[role=img]").scrollIntoViewIfNeeded();
  await beat(4);

  say("who the plant will pay, and nobody else");
  await page.locator(".panel", { hasText: "Approved suppliers" }).scrollIntoViewIfNeeded();
  await beat(4);

  say("running the agent on the routine lane");
  await page.mouse.wheel(0, -600);
  await beat(1);
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByText("funded autonomously").first().waitFor({ timeout: 180_000 });
  await beat(5); // the reasoning trace is the point — leave it up

  say("advancing the run hour into Zone C");
  await page.locator('input[type="range"]').fill("320");
  await beat(4);

  say("now the bearing will not save it — the agent escalates");
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByText("queued for human approval").first().waitFor({ timeout: 180_000 });
  await beat(5);

  say("it stops, because $4,000 is over the ceiling");
  const approve = page.getByRole("button", { name: /^Approve \$/ }).first();
  await approve.scrollIntoViewIfNeeded();
  await beat(3);

  say("a human approves");
  await approve.click();
  await page.getByText("Nothing waiting on you.").waitFor({ timeout: 120_000 });
  await beat(4);

  say("settling the bearing order");
  await page.locator(".panel", { hasText: "Purchase orders" }).scrollIntoViewIfNeeded();
  await beat(2);
  const ship = page.getByRole("button", { name: "Supplier ships" }).first();
  await ship.click();
  await beat(6);
  const confirm = page.getByRole("button", { name: "Confirm receipt & pay" }).first();
  await confirm.click();
  await beat(6);

  say("issuing the part to the machine");
  const fit = page.getByRole("button", { name: "Fit to machine" }).first();
  await fit.waitFor({ timeout: 60_000 });
  await fit.scrollIntoViewIfNeeded();
  await beat(3);
  await fit.click();
  await beat(6); // it leaves the store, which is what lets the next run order

  say("final position");
  await page.mouse.wheel(0, -2000);
  await beat(6);
} finally {
  await context.close(); // flushes the video
  await browser.close();
}

const webm = fs
  .readdirSync(OUT)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0];

if (webm) {
  const target = path.join(OUT, "demo.webm");
  if (webm.f !== "demo.webm") {
    fs.rmSync(target, { force: true });
    fs.renameSync(path.join(OUT, webm.f), target);
  }
  const mb = (fs.statSync(target).size / 1e6).toFixed(1);
  console.log(`\nwrote ${target} (${mb} MB)`);
}
