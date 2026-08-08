import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import timings from "./timings.json";
import type { Scene } from "./script.ts";

/**
 * The pitch video.
 *
 * Every timing comes from `timings.json`, which is measured off the rendered
 * narration rather than guessed — so a caption cannot drift from the voice
 * reading it. Editing a line means re-running scripts/voice.mjs; nothing here
 * needs touching.
 *
 * Product footage is real screenshots of the deployment running against Base
 * Sepolia, captured by scripts/capture.mjs. A pitch that illustrates its
 * product with an illustration is saying the product cannot be filmed.
 */

const C = {
  void: "#0b0e11",
  panel: "#14181d",
  rule: "#262e36",
  ink: "#e6ebf0",
  muted: "#9aa7b3",
  dim: "#7d8893",
  a: "#3fb27f",
  b: "#c2cc4a",
  c: "#e8a33d",
  d: "#e5484d",
};

const DISPLAY = "Archivo, 'Segoe UI', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

type Line = (typeof timings.lines)[number];

/** The severity rail, at the same proportions the panel draws it. */
const Rail: React.FC<{ width: number; needle?: number }> = ({ width, needle }) => (
  <div style={{ position: "relative", width, height: 10, display: "flex", gap: 2 }}>
    {[
      [28, C.a],
      [17, C.b],
      [26, C.c],
      [29, C.d],
    ].map(([span, colour]) => (
      <div key={colour as string} style={{ flex: span as number, background: colour as string }} />
    ))}
    {needle !== undefined && (
      <div
        style={{
          position: "absolute",
          left: `${needle}%`,
          top: -4,
          bottom: -4,
          width: 3,
          background: C.ink,
        }}
      />
    )}
  </div>
);

/**
 * A still, held and drifting a little so a static frame does not read as a stall.
 *
 * `useCurrentFrame()` inside a Sequence is already relative to that sequence.
 * Subtracting the absolute start as well made every scene after the first
 * compute a large negative frame, which extrapolated the fade-in below zero
 * and rendered black — the first scene looked right only because its start is
 * zero, which is exactly how the bug survived a spot check.
 */
const Shot: React.FC<{ src: string; span: number }> = ({ src, span }) => {
  const local = useCurrentFrame();
  const scale = interpolate(local, [0, span], [1.04, 1.11], { extrapolateRight: "clamp" });
  const opacity = interpolate(local, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity, justifyContent: "center", alignItems: "center" }}>
      <Img
        src={staticFile(src)}
        style={{ width: "100%", objectFit: "cover", transform: `scale(${scale})` }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${C.void}cc 0%, ${C.void}22 32%, ${C.void}ee 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 22,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color: C.dim,
    }}
  >
    {children}
  </div>
);

/** Two figures, side by side, which is the whole argument in one frame. */
const Lanes: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 200 } });

  const Card: React.FC<{ amount: string; part: string; verdict: string; note: string; delay: number }> =
    ({ amount, part, verdict, note, delay }) => (
      <div
        style={{
          flex: 1,
          background: C.panel,
          border: `1px solid ${C.rule}`,
          padding: "34px 38px",
          opacity: rise(delay),
          transform: `translateY(${(1 - rise(delay)) * 24}px)`,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontSize: 76, fontWeight: 700, color: C.ink }}>
          {amount}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 24, color: C.muted, marginTop: 6 }}>{part}</div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 30,
            fontWeight: 600,
            color: C.ink,
            marginTop: 26,
          }}
        >
          {verdict}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 21, color: C.dim, marginTop: 8 }}>{note}</div>
      </div>
    );

  return (
    <AbsoluteFill style={{ padding: "150px 90px 300px", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: 26 }}>
        <Card
          amount="$180"
          part="6205-2RS bearing"
          verdict="Executes alone"
          delay={0}
          note="proposed and funded, one transaction"
        />
        <Card
          amount="$4,000"
          part="SPN-880 spindle"
          verdict="Stops for a person"
          delay={10}
          note="proposed only — no money moved"
        />
      </div>
    </AbsoluteFill>
  );
};

const Trust: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = [
    "Invent a payee",
    "Re-buy what is already coming",
    "Overspend the monthly cap",
    "Release escrow on a bare click",
  ];

  return (
    <AbsoluteFill style={{ padding: "170px 110px 300px", justifyContent: "center" }}>
      <Eyebrow>What the contract refuses</Eyebrow>
      <div style={{ marginTop: 34 }}>
        {rows.map((r, i) => {
          const s = spring({ frame: frame - i * 8, fps, config: { damping: 200 } });
          return (
            <div
              key={r}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "20px 0",
                borderTop: `1px solid ${C.rule}`,
                opacity: s,
                transform: `translateX(${(1 - s) * -18}px)`,
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 28, color: C.d }}>×</span>
              <span style={{ fontFamily: DISPLAY, fontSize: 40, fontWeight: 600, color: C.ink }}>
                {r}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const ColdOpen: React.FC = () => {
  const local = useCurrentFrame();
  /* The needle walks toward the stop line while the line is read. The figure
     itself holds at what the app actually projects: an animated countdown
     looked dramatic and disagreed with the narration reading "58 hours" over
     the top of it. */
  const needle = interpolate(local, [0, 130], [42, 62], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: "0 110px 260px", justifyContent: "center" }}>
      <Eyebrow>CNC-07 · Mazak VCN-530 · ISO 10816-3 Class II</Eyebrow>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 150,
          fontWeight: 700,
          color: C.ink,
          marginTop: 18,
          letterSpacing: "-0.02em",
        }}
      >
        58.4 h
      </div>
      <div style={{ fontFamily: MONO, fontSize: 26, color: C.muted, marginBottom: 30 }}>
        until the machine must be stopped
      </div>
      <Rail width={1700} needle={needle} />
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ text: string; span: number }> = ({ text, span }) => {
  const local = useCurrentFrame();
  const opacity = interpolate(local, [0, 8, Math.max(9, span - 8), span], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 96 }}>
      <div
        style={{
          opacity,
          maxWidth: 1500,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 40,
          lineHeight: 1.45,
          color: C.ink,
          whiteSpace: "pre-line",
          textShadow: `0 2px 24px ${C.void}, 0 0 3px ${C.void}`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const SCENE_SHOT: Partial<Record<Scene, string>> = {
  problem: "shots/strip.png",
  cost: "shots/trend.png",
  loop: "shots/machines.png",
  product: "shots/control-room.png",
  live: "shots/landing.png",
  close: "shots/control-room.png",
};

const Body: React.FC<{ line: Line; span: number }> = ({ line, span }) => {
  const scene = line.scene as Scene;
  if (scene === "cold-open") return <ColdOpen />;
  if (scene === "lanes") return <Lanes />;
  if (scene === "trust") return <Trust />;

  const src = SCENE_SHOT[scene];
  return src ? <Shot src={src} span={span} /> : null;
};

export const Pitch: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: C.void }}>
      {timings.lines.map((line) => {
        const from = Math.round(line.start * fps);
        const span = Math.round((line.duration + line.gap) * fps);
        return (
          <Sequence key={line.id} from={from} durationInFrames={span}>
            <Body line={line} span={span} />
            <Caption text={line.caption} span={span} />
            <Audio src={staticFile(line.file)} />
          </Sequence>
        );
      })}

      {/* Held throughout: the wordmark and the one claim that has to survive
          somebody watching with the sound off. */}
      <AbsoluteFill style={{ padding: "56px 70px", pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: C.ink,
          }}
        >
          FOREMAN
        </div>
        <div style={{ fontFamily: MONO, fontSize: 20, color: C.dim, marginTop: 6 }}>
          live on Base Sepolia · verified
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
