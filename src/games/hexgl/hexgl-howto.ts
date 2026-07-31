//! HexGL's "How to play" guide (pure data — see src/how-to.ts). A Tier-2 wrap:
//! leads with the interaction model and states plainly it keeps no verifiable
//! record. HexGL is a larger bundle, so the guide also discloses that up front.

import type { Guide } from "../../how-to.js";

export const HEXGL_GUIDE: Guide = {
  title: "How to play HexGL",
  lede: "Pilot a hovering ship around a futuristic track at high speed. HexGL is a wrapped game we include as-is — it is not one of our verifiable games, so it keeps no record you can re-check. It is also a larger download (~17 MB) that then runs offline.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Race your ship around the track for three laps, as fast as you can. Steer through the corners, hold your speed, and use the air brakes to take tight turns without slamming the walls. Pick a quality level and controls from the start menu.",
        },
        {
          kind: "shot",
          name: "hexgl-race",
          alt: "A blue-and-orange hovering ship racing down a dark futuristic track under a bright sky, with a lap counter and speed gauge overlaid.",
          caption: "The race: your ship on the track, with the lap counter and speed gauge.",
        },
      ],
    },
    {
      testid: "howto-controls",
      title: "Controls",
      toc: "Controls",
      blocks: [
        {
          kind: "prose",
          text: "HexGL is played with a keyboard by default (it also supports touch, a gamepad, and orientation steering on capable devices).",
        },
        {
          kind: "steps",
          items: [
            "Arrow keys (or W/A/S/D) steer and accelerate.",
            "A and D (or the shoulder buttons on a gamepad) are the left/right air brakes — hold one to carve a tight turn.",
            "Choose Keyboard, Touch, Gamepad, or Orientation from the start menu's controls option.",
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
          text: "HexGL is not a Croft-native game. We include it as-is because it is a beautiful, ethical-to-host WebGL game, but it does not produce the small, replayable record our own games do — there is nothing to re-verify or share as a proven result. The banner on the game page says the same, so the shelf stays honest.",
        },
        {
          kind: "note",
          text: "HexGL by Thibaut Despoulain (BKcore), under the MIT License. Source: github.com/BKcore/HexGL.",
        },
      ],
    },
  ],
};
