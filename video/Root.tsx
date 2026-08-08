import React from "react";
import { Composition } from "remotion";
import { Pitch } from "./Pitch.tsx";
import timings from "./timings.json";

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
  </>
);
