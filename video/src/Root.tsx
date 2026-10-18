import React from "react";
import { Composition, Still } from "remotion";
import { FILM_FRAMES, Film } from "./Film";
import { Banner, BlogCover, GraphModel, Setup } from "./extras";
import { DEMO_FRAMES, Demo } from "./Demo";

export const Root: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={FILM_FRAMES} fps={30} width={1600} height={900} />
    <Composition id="GraphModel" component={GraphModel} durationInFrames={210} fps={30} width={1600} height={720} />
    <Composition id="Setup" component={Setup} durationInFrames={290} fps={30} width={1600} height={900} />
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={30} width={1920} height={1080} />
    <Still id="Banner" component={Banner} width={1920} height={600} />
    <Still id="BlogCover" component={BlogCover} width={1000} height={420} />
  </>
);
