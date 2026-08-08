import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import vo from "./demo-vo.json";

/**
 * The demo recording, narrated.
 *
 * The picture is the untouched Playwright capture of the real app driving real
 * transactions — nothing here re-creates or re-times it. All this adds is the
 * voice and the captions.
 *
 * Every start time comes from demo-vo.json, which pins each line to the second
 * its beat actually happened at during that recording. Re-record and the
 * narration follows; it never needs re-timing by hand.
 */

const C = {
  void: "#0b0e11",
  ink: "#e6ebf0",
};

const MONO = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

const Caption: React.FC<{ text: string; span: number }> = ({ text, span }) => {
  const local = useCurrentFrame();
  const opacity = interpolate(local, [0, 8, Math.max(9, span - 10), span], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 48 }}>
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
          background: "rgba(11,14,17,0.88)",
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
        return (
          <Sequence key={line.id} from={from} durationInFrames={span}>
            <Caption text={line.caption} span={span} />
            <Audio src={staticFile(line.file)} />
          </Sequence>
        );
      })}

      {/* No wordmark overlay. The recording already carries the product's own
          masthead, and a second one sat on top of it and the treasury strip —
          two FOREMANs, neither readable. The captions carry the message; the
          picture carries the branding. */}
    </AbsoluteFill>
  );
};
