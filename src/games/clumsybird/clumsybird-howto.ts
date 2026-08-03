//! Clumsy Bird's "How to play" guide (pure data — see src/how-to.ts). A Tier-2
//! wrap: leads with the one-button interaction, credits the Flappy Bird lineage,
//! and states plainly it keeps no verifiable record.

import type { Guide } from "../../how-to.js";

export const CLUMSYBIRD_GUIDE: Guide = {
  title: "How to play Clumsy Bird",
  lede: "Keep a little bird in the air by flapping through gaps in the pipes. Clumsy Bird is a wrapped game we include as-is — a homage to Flappy Bird — and it is not one of our verifiable games, so it keeps no record you can re-check.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Fly as far as you can. Each tap gives the bird a little lift; between taps it falls. Steer through the gaps in the oncoming pipes without hitting one or touching the ground. You score a point for every pipe you clear.",
        },
        {
          kind: "shot",
          name: "clumsybird-title",
          alt: "A pixel-art title screen reading 'Clumsy Bird' over a blue sky with a green city skyline and a grassy pipe.",
          caption: "The title screen — tap, click, or press space or the up arrow to start.",
        },
      ],
    },
    {
      testid: "howto-controls",
      title: "Controls: one button",
      toc: "Controls",
      blocks: [
        {
          kind: "prose",
          text: "Clumsy Bird is a one-button game — the same action does everything.",
        },
        {
          kind: "steps",
          items: [
            "Tap the screen, click the mouse, or press the space bar or up arrow to flap.",
            "Do it again to start a run, and keep tapping to stay airborne.",
            "Press 'm' to mute or unmute the sound.",
          ],
        },
      ],
    },
    {
      testid: "howto-wrapped",
      title: "A wrapped game — no verifiable record",
      toc: "Wrapped game",
      blocks: [
        {
          kind: "prose",
          text: "Clumsy Bird is not a Croft-native game. We include it as-is because it is a fun, ethical-to-host open-source game, but it does not produce the small, replayable record our own games do — there is nothing to re-verify or share as a proven result. The banner on the game page says the same, so the shelf stays honest.",
        },
        {
          kind: "note",
          text: "Clumsy Bird by ellisonleao, under the GPL-3.0 licence — a homage to Flappy Bird by Dong Nguyen. Source: github.com/ellisonleao/clumsy-bird.",
        },
      ],
    },
  ],
};
