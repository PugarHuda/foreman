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
import { DEMO_LINES } from "../video/demo-script.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const VOICE = arg("voice", "am_adam");
const SPEED = Number(arg("speed", "0.95"));

/**
 * Two tracks: the pitch, whose lines run back to back, and the demo, whose
 * lines are pinned to beats the recording timed itself. They share the
 * renderer and the cache; only the timing model differs.
 */
const TRACK = arg("track", "pitch");
const DEMO = TRACK === "demo";
const OUT = DEMO ? "video/public/vo-demo" : "video/public/vo";
const TIMINGS = DEMO ? "video/demo-vo.json" : "video/timings.json";
const SOURCE = DEMO ? DEMO_LINES.map((l, i) => ({ ...l, id: String(i + 1).padStart(2, "0") })) : LINES;

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

const previous = fs.existsSync(TIMINGS)
  ? JSON.parse(fs.readFileSync(TIMINGS, "utf8"))
  : { lines: [] };
const cached = new Map(previous.lines.map((l) => [l.id, l]));

const out = [];
let at = 0;

for (const line of SOURCE) {
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

  out.push({
    ...line,
    hash,
    file: `${DEMO ? "vo-demo" : "vo"}/${line.id}.wav`,
    start: at,
    duration,
    gap,
  });
  at += duration + gap;
}

if (DEMO) {
  /* Pin each line to the second its beat happened at. The recording measured
     those; stacking durations would put the narration wherever the previous
     line happened to end, which is not where the picture is. */
  const timeline = JSON.parse(fs.readFileSync("video/demo-timeline.json", "utf8"));
  const beatAt = new Map(timeline.beats.map((b) => [b.label, b.at]));

  for (const line of out) {
    const at = beatAt.get(line.beat);
    if (at === undefined) {
      throw new Error(
        `no beat "${line.beat}" in the recording's timeline — re-record, or fix the label`,
      );
    }
    line.beatAt = at;
  }
  out.sort((a, b) => a.beatAt - b.beatAt);

  /**
   * Never before its beat, never over the line before it.
   *
   * Pinning every line hard to its beat made five of them talk over each
   * other, because the recording's pacing was set for watching, not for
   * narrating. Cramming the script to fit 2-second gaps would have meant
   * writing to a stopwatch instead of to the picture.
   *
   * A narrator finishing a sentence while the picture moves on is normal and
   * reads fine; two voices at once does not. So each line starts at its beat
   * or when the previous one finishes, whichever is later — the order and the
   * meaning hold, and only the tightest sections run slightly behind.
   */
  let cursor = 0;
  for (const line of out) {
    line.start = Math.max(line.beatAt, cursor);
    cursor = line.start + line.duration + 0.35;
    const behind = line.start - line.beatAt;
    if (behind > 0.5) {
      console.log(`  ~ "${line.beat}" starts ${behind.toFixed(1)}s after its beat`);
    }
  }

  const overrun = cursor - timeline.duration;
  if (overrun > 0) {
    console.warn(
      `\n  ! the narration runs ${overrun.toFixed(1)}s past the end of the recording — shorten a line`,
    );
  }
}

const timings = {
  voice: VOICE,
  speed: SPEED,
  total: DEMO
    ? JSON.parse(fs.readFileSync("video/demo-timeline.json", "utf8")).duration
    : at,
  lines: out,
};
fs.writeFileSync(TIMINGS, `${JSON.stringify(timings, null, 2)}\n`);

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
  DEMO ? "docs/demo.srt" : "docs/pitch.srt",
  out
    .map(
      (l, i) =>
        `${i + 1}\n${stampSrt(l.start)} --> ${stampSrt(l.start + l.duration)}\n${l.caption}\n`,
    )
    .join("\n"),
);

console.log(`\n${out.length} lines, voice ${VOICE}`);
console.log(`wrote ${TIMINGS} and docs/${DEMO ? "demo" : "pitch"}.srt`);
