import React from "react";
import { Series } from "remotion";
import { Baton, ManifestTitle, Notebook, Problem, Scene, Title, Witness } from "./scenes-intro";
import { End, FFollowed, FImpact, FProof, FRace, FReceipt, FRefused, FTold, FTraced, FWho } from "./scenes-features";
import { Paper, useFonts } from "./theme";

// The product film: what LockIn is, the problem with handoffs, then what
// LockIn Manifest adds on FalkorDB, one feature at a time.

export const SCENES: [React.FC, number][] = [
  [Title, 90],
  [Notebook, 150],
  [Witness, 120],
  [Baton, 150],
  [Problem, 130],
  [ManifestTitle, 100],
  [FReceipt, 190],
  [FFollowed, 190],
  [FImpact, 180],
  [FTold, 170],
  [FRefused, 170],
  [FTraced, 170],
  [FWho, 190],
  [FRace, 170],
  [FProof, 150],
  [End, 110],
];

export const FILM_FRAMES = SCENES.reduce((n, [, d]) => n + d, 0);

export const Film: React.FC = () => {
  useFonts();
  // The page stays under every scene, so a scene fades on paper, never through black.
  return (
    <Paper>
      <Series>
        {SCENES.map(([S, d], i) => (
          <Series.Sequence key={i} durationInFrames={d}>
            <Scene duration={d}>
              <S />
            </Scene>
          </Series.Sequence>
        ))}
      </Series>
    </Paper>
  );
};
