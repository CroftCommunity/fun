//! Astray's "How to play" guide (pure data — see src/how-to.ts). Astray is a
//! Tier-2 wrapped game, so the guide leads with the interaction model and states
//! plainly that — unlike the Croft-native games — it keeps no verifiable record.

import type { Guide } from "../../how-to.js";

export const ASTRAY_GUIDE: Guide = {
  title: "How to play Astray",
  lede: "Roll a ball through a 3D maze to find the exit. Astray is a wrapped game we include as-is — it is fun, but it is not one of our verifiable games, so it keeps no record you can re-check.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You control a ball inside a maze rendered in 3D. Steer it through the corridors to reach the exit; each level generates a fresh maze. The camera follows the ball as it rolls.",
        },
        {
          kind: "shot",
          name: "astray-maze",
          alt: "A golden ball resting in a corridor of a dark 3D maze with red brick walls and a concrete floor, lit from above.",
          caption: "The maze, rendered in 3D — roll the ball toward the exit.",
        },
      ],
    },
    {
      testid: "howto-controls",
      title: "Controls: the arrow keys",
      toc: "Controls",
      blocks: [
        {
          kind: "prose",
          text: "Astray is played with a physical keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Use the arrow keys to roll the ball (left, right, forward, back).",
            "Hold the 'I' key at any time to see the in-game instructions.",
          ],
        },
        {
          kind: "note",
          text: "Because Astray uses keyboard steering rather than our tap-first model, it plays best on a device with a keyboard.",
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
          text: "Astray is not a Croft-native game. We include it as-is because it is well made and ethical to host, but it does not produce the small, replayable record our own games do — there is nothing to re-verify or share as a proven result. The banner on the game page says the same thing, so the shelf stays honest about what each game is.",
        },
        {
          kind: "note",
          text: "Astray by wwwtyro, released into the public domain (The Unlicense). Source: github.com/wwwtyro/Astray.",
        },
      ],
    },
  ],
};
