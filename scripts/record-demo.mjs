/**
 * Drives the full demo against a running dev server and records it.
 *
 *   npm run dev            # terminal 1
 *   node scripts/record-demo.mjs
 *
 * Writes docs/demo.webm and the README still, docs/dashboard.png. Pacing is
 * deliberately slow — this is meant to be watched, and to have a voiceover
 * laid over it.
 *
 * STILL_ONLY=1 stops after the routine lane and writes only the still. The
 * hero image goes stale on its own — a UI change dates it while the recording
 * is still accurate — and refreshing it should not cost four minutes of
 * testnet run and another 4 MB video in git history.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = "docs";
const VIEWPORT = { width: 1600, height: 1100 };

const STILL_ONLY = !!process.env.STILL_ONLY;

const beat = (s) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * Clear the board first. The agent correctly refuses to buy a part that is
 * already on order, so recording against a used deployment captures it
 * declining — which is right, and useless as a demo. Cancel anything still in
 * flight, fit anything delivered, and start from nothing.
 */
async function resetBoard() {
  const secret = fs.existsSync(".env")
    ? fs.readFileSync(".env", "utf8").match(/^DEMO_SECRET=(.+)$/m)?.[1]?.trim()
    : undefined;
  const headers = {
    "Content-Type": "application/json",
    ...(secret ? { "x-demo-secret": secret } : {}),
  };

  const { chain } = await (await fetch(`${BASE}/api/state`)).json();
  const open = (chain?.pos ?? []).filter((p) =>
    ["Proposed", "Funded", "Shipped", "Released"].includes(p.status),
  );
  if (!open.length) return;

  say(`clearing ${open.length} order(s) left from a previous run`);
  for (const po of open) {
    const action = po.status === "Released" ? "fit" : "cancel";
    const res = await fetch(`${BASE}/api/po`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, id: po.id }),
    });
    if (!res.ok) console.warn(`    could not ${action} #${po.id}: ${res.status}`);
  }
  await beat(5); // let the reads catch up before the browser opens
}

const say = (msg) => console.log(`  ${msg}`);

await resetBoard();

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  ...(STILL_ONLY ? {} : { recordVideo: { dir: OUT, size: VIEWPORT } }),
  deviceScaleFactor: 1,
});
const page = await context.newPage();

try {
  say("opening the control room");
  await page.goto(BASE, { waitUntil: "networkidle" });
  // The dev-server badge is Next's, not the plant's. It has no business in a
  // recording or in the README hero.
  await page.addStyleTag({ content: "nextjs-portal { display: none }" });
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

  // Shot here, not on a fresh load: the still is the one thing a judge sees
  // before deciding whether to watch anything, and a control room with an
  // empty agent panel argues the opposite of the caption under it.
  say("capturing the README still");
  await page.mouse.wheel(0, -2000);
  await beat(2);
  await page.screenshot({ path: path.join(OUT, "dashboard.png"), fullPage: true });

  if (STILL_ONLY) {
    say("STILL_ONLY — stopping before the human lane");
    await context.close();
    await browser.close();
    process.exit(0);
  }

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

if (!webm) process.exit(0);

const target = path.join(OUT, "demo.webm");
const raw = path.join(OUT, webm.f);
const rawMb = (fs.statSync(raw).size / 1e6).toFixed(1);

/**
 * Compress before committing. Playwright writes a near-lossless VP8 stream —
 * fine to watch, but this file is re-recorded on every contract change, and
 * each copy stays in git history forever. Eight of them had already put 90 MB
 * in .git before anyone looked.
 */
try {
  const tmp = path.join(OUT, "demo.compressed.webm");
  execFileSync(
    "ffmpeg",
    ["-y", "-i", raw, "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-an", tmp],
    { stdio: "ignore" },
  );
  fs.rmSync(target, { force: true });
  fs.renameSync(tmp, target);
  fs.rmSync(raw, { force: true });
  const mb = (fs.statSync(target).size / 1e6).toFixed(1);
  console.log(`\nwrote ${target} (${mb} MB, down from ${rawMb} MB)`);
} catch {
  // No ffmpeg: keep the raw file rather than losing the recording.
  if (webm.f !== "demo.webm") {
    fs.rmSync(target, { force: true });
    fs.renameSync(raw, target);
  }
  console.log(`\nwrote ${target} (${rawMb} MB — install ffmpeg to compress it)`);
}
