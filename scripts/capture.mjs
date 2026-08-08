/**
 * Real footage of the real app, for the pitch video.
 *
 *   npm run build && npm start      # terminal 1
 *   node scripts/capture.mjs
 *
 * Everything the pitch video shows of the product is captured here from the
 * running deployment against Base Sepolia — no mockups, no re-drawn UI. A
 * pitch that illustrates its product with an illustration is telling you the
 * product is not ready to be filmed.
 *
 * Stills rather than clips for most of it: a still holds while a narrator
 * talks over it, and a clip that loops behind speech is a distraction. The one
 * exception is the agent panel, where the point is that it moves.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = "video/public/shots";
const VIEWPORT = { width: 1600, height: 1000 };

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1.5 });
const page = await context.newPage();

const shot = async (name, target) => {
  const file = path.join(OUT, `${name}.png`);
  await (target ?? page).screenshot({ path: file });
  console.log(`  ${name}`);
};

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  // Next's dev badge is the dev server talking, not the plant.
  await page.addStyleTag({ content: "nextjs-portal { display: none }" });
  await page.locator(".machine").first().waitFor();
  await page.waitForTimeout(1500);

  await shot("control-room");
  await shot("machines", page.locator(".machines").first());
  await shot("strip", page.locator(".strip").first());
  await shot("trend", page.locator(".panel").filter({ hasText: "vibration trend" }).first());
  await shot("orders", page.locator(".panel").filter({ hasText: "Purchase orders" }).first());
  await shot("suppliers", page.locator(".panel").filter({ hasText: "Approved suppliers" }).first());

  /* The queue with something genuinely waiting on a person — the single most
     important frame in the pitch, because it is the claim being made. */
  const waiting = page.locator(".panel").filter({ hasText: "Waiting on you" }).first();
  if (await waiting.count()) await shot("waiting", waiting);

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal { display: none }" });
  await page.waitForTimeout(800);
  await shot("landing");

  console.log(`\ncaptured to ${OUT}`);
} finally {
  await context.close();
  await browser.close();
}
