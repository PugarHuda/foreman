import React from "react";
import { Composition } from "remotion";
import { Pitch } from "./Pitch.tsx";
import { Demo } from "./Demo.tsx";
import timings from "./timings.json";
import demoTimeline from "./demo-timeline.json";

/**
 * The composition's length is the narration's length, rounded up to a whole
 * second of tail. Hard-coding a duration and then fitting the voice to it is
 * how a pitch video ends mid-sentence.
 */
const FPS = 30;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Pitch"
      component={Pitch}
      durationInFrames={Math.ceil((timings.total + 0.8) * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    {/* The recording's own length, so the narrated copy ends where the capture
        does rather than on a frozen last frame or a truncated one. */}
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={Math.ceil(demoTimeline.duration * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
