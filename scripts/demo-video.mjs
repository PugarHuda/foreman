/**
 * Render the narrated demo.
 *
 *   npm run video:demo
 *
 * Remotion resolves staticFile() against video/public, and the recording lives
 * in public/ because that is where the site serves it from. Copying it across
 * at render time keeps one canonical copy in git rather than two — the working
 * copy is gitignored.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

/* The raw capture is the source of truth and the only copy in git. Playwright
   writes VP9, which Safari will not play and Remotion decodes slowly, so it is
   transcoded to a working file here rather than kept as a second committed
   video that exists only to be narrated over. */
const SOURCE = "docs/demo.webm";
const WORKING = "video/public/demo-source.mp4";

if (!fs.existsSync(SOURCE)) {
  throw new Error(`${SOURCE} is missing — run scripts/record-demo.mjs first`);
}
if (!fs.existsSync("video/demo-vo.json")) {
  throw new Error("video/demo-vo.json is missing — run: npm run voice -- --track demo");
}

fs.copyFileSync(SOURCE, WORKING);
execFileSync(
  "npx",
  ["remotion", "render", "video/index.ts", "Demo", "public/demo.mp4", "--crf", "28"],
  { stdio: "inherit", shell: true },
);
fs.rmSync(WORKING, { force: true });

const mb = (fs.statSync("public/demo.mp4").size / 1e6).toFixed(1);
console.log(`\nwrote public/demo.mp4 (${mb} MB) — narrated, annotated, and the one the site links`);
