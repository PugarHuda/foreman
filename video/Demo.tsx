import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import vo from "./demo-vo.json";

/**
 * The demo recording, narrated and annotated.
 *
 * The picture is the untouched Playwright capture of the real app driving real
 * transactions — nothing here re-creates or re-times it. What is added is the
 * voice, the captions, and a frame around whatever is being talked about.
 *
 * Both the timings and the frame positions come from the recording itself:
 * record-demo.mjs writes the second each beat happened at and the on-screen
 * box of the thing it is about, measured at that moment. Measuring afterwards
 * would point at the wrong place, because the page scrolls and the agent panel
 * grows as its log fills.
 */

const C = {
  void: "#0b0e11",
  ink: "#e6ebf0",
};

const MONO = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

/** The capture's own size. The canvas is 16:9; the picture is not. */
const SRC = { w: 1600, h: 1100 };

/**
 * Where a point in the recording lands on the canvas.
 *
 * `objectFit: contain` scales to whichever axis runs out first and centres the
 * rest. Recomputing that here is what lets a box measured in the app's own
 * coordinates land on the right pixels — hard-coding an offset would break the
 * first time the viewport or the canvas changed.
 */
function place(width: number, height: number) {
  const scale = Math.min(width / SRC.w, height / SRC.h);
  return {
    scale,
    left: (width - SRC.w * scale) / 2,
    top: (height - SRC.h * scale) / 2,
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A frame around the thing being described.
 *
 * Drawn in the panel's own accent — the ink grey everything financial uses —
 * rather than a colour, because on this interface colour means machine health
 * and nothing else. A red box would read as an alarm.
 */
const Box: React.FC<{ rect: Rect; span: number }> = ({ rect, span }) => {
  const local = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { scale, left, top } = place(width, height);

  const grow = spring({ frame: local, fps, config: { damping: 200, mass: 0.6 } });
  const fade = interpolate(local, [0, 10, Math.max(11, span - 12), span], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pad = 6;
  const x = left + (rect.x - pad) * scale;
  const y = top + (rect.y - pad) * scale;
  const w = (rect.w + pad * 2) * scale;
  const h = (rect.h + pad * 2) * scale;

  return (
    <AbsoluteFill style={{ opacity: fade, pointerEvents: "none" }}>
      {/* Everything outside the frame dimmed rather than the inside brightened:
          the capture is already the right exposure, and lifting part of it
          would misrepresent what the screen looked like. */}
      <AbsoluteFill
        style={{
          background: "rgba(11,14,17,0.55)",
          clipPath: `polygon(0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px, ${x + w}px ${y}px, ${
            x + w
          }px ${y + h}px, ${x}px ${y + h}px, ${x}px 100%, 100% 100%, 100% 0%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          border: `3px solid ${C.ink}`,
          borderRadius: 3,
          transform: `scale(${0.985 + grow * 0.015})`,
          transformOrigin: "center",
          boxShadow: `0 0 0 1px rgba(11,14,17,0.9), 0 0 30px rgba(230,235,240,0.16)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ text: string; span: number }> = ({ text, span }) => {
  const local = useCurrentFrame();
  const opacity = interpolate(local, [0, 8, Math.max(9, span - 10), span], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 44 }}>
      <div
        style={{
          opacity,
          maxWidth: 1500,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 34,
          lineHeight: 1.42,
          color: C.ink,
          whiteSpace: "pre-line",
          padding: "16px 28px",
          borderRadius: 4,
          background: "rgba(11,14,17,0.92)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: C.void }}>
      {/* Contained rather than cropped: the capture is 1600x1100 and the canvas
          is 16:9, and cutting to fit would take the bottom of the order queue —
          which is the half of the screen the whole argument lives in. Side bars
          are a smaller price than a cropped proof. */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <OffthreadVideo
          src={staticFile("demo-source.mp4")}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          muted
        />
      </AbsoluteFill>

      {vo.lines.map((line) => {
        const from = Math.round(line.start * fps);
        const span = Math.round((line.duration + 0.35) * fps);
        const rect = (line as { rect?: Rect | null }).rect;
        return (
          <Sequence key={line.id} from={from} durationInFrames={span}>
            {rect ? <Box rect={rect} span={span} /> : null}
            <Caption text={line.caption} span={span} />
            <Audio src={staticFile(line.file)} />
          </Sequence>
        );
      })}

      {/* No wordmark overlay. The recording already carries the product's own
          masthead, and a second one sat on top of it and the treasury strip —
          two FOREMANs, neither readable. */}
    </AbsoluteFill>
  );
};
