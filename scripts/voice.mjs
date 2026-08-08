/**
 * Render the narration, and measure it.
 *
 *   node --env-file=.env scripts/voice.mjs [--voice am_adam]
 *
 * One WAV per line, plus video/timings.json carrying each line's real
 * duration. The durations are measured from the rendered audio rather than
 * estimated from word count, because a caption that is a beat off for a whole
 * video is worse than no caption — and estimating, then recording to fit, is
 * how that happens.
 *
 * Lines are cached by the hash of their text and voice, so re-running after
 * editing one line re-renders one line.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { LINES } from "../video/script.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const VOICE = arg("voice", "am_adam");
const SPEED = Number(arg("speed", "0.95"));
const OUT = "video/public/vo";

const key = process.env.VENICE_API_KEY;
if (!key) throw new Error("VENICE_API_KEY missing — run with --env-file=.env");

fs.mkdirSync(OUT, { recursive: true });

/** ffprobe rather than parsing the WAV header: it is already a dependency of
    the render, and it is right about formats this does not think about. */
const durationOf = (file) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      file,
    ]).toString().trim(),
  );

const stamp = (line) =>
  createHash("sha256").update(`${VOICE}:${SPEED}:${line.say}`).digest("hex").slice(0, 12);

const previous = fs.existsSync("video/timings.json")
  ? JSON.parse(fs.readFileSync("video/timings.json", "utf8"))
  : { lines: [] };
const cached = new Map(previous.lines.map((l) => [l.id, l]));

const out = [];
let at = 0;

for (const line of LINES) {
  const file = path.join(OUT, `${line.id}.wav`);
  const hash = stamp(line);
  const hit = cached.get(line.id);

  if (!(hit?.hash === hash && fs.existsSync(file))) {
    const res = await fetch("https://api.venice.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-kokoro",
        input: line.say,
        voice: VOICE,
        response_format: "wav",
        speed: SPEED,
      }),
    });
    if (!res.ok) throw new Error(`${line.id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`  ${line.id} rendered`);
  } else {
    console.log(`  ${line.id} cached`);
  }

  /* A beat after each line. Narration with no gaps reads as a machine reading
     a list; the pause is where a listener catches up with the picture. */
  const duration = durationOf(file);
  const gap = line.scene === "close" ? 1.6 : 0.45;

  out.push({ ...line, hash, file: `vo/${line.id}.wav`, start: at, duration, gap });
  at += duration + gap;
}

const timings = { voice: VOICE, speed: SPEED, total: at, lines: out };
fs.writeFileSync("video/timings.json", `${JSON.stringify(timings, null, 2)}\n`);

/**
 * The same timings as SubRip, for anywhere the burned-in captions are not
 * enough — YouTube, a platform that wants a track it can translate, or a
 * viewer who turns them off. Written from the measured durations, so the file
 * and the picture cannot disagree.
 */
const stampSrt = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
};

fs.writeFileSync(
  "docs/pitch.srt",
  out
    .map(
      (l, i) =>
        `${i + 1}\n${stampSrt(l.start)} --> ${stampSrt(l.start + l.duration)}\n${l.caption}\n`,
    )
    .join("\n"),
);

console.log(`\n${out.length} lines, ${at.toFixed(1)}s total, voice ${VOICE}`);
console.log("wrote video/timings.json and docs/pitch.srt");
