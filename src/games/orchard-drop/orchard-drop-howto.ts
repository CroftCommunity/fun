//! Orchard Drop's "How to play" guide (pure data — see src/how-to.ts). Orchard
//! Drop is a Tier-2 wrapped game, so the guide leads with what it is and how you
//! play it, and states plainly that — unlike the Croft-native games — it keeps
//! no verifiable record. The closing note credits the Matter.js physics engine
//! and the Suika lineage.

import type { Guide } from "../../how-to.js";

export const ORCHARD_DROP_GUIDE: Guide = {
  title: "How to play Orchard Drop",
  lede: "Drop fruit into the crate; two of the same fruit merge into the next one up an eleven-step ladder, all the way to the watermelon. Orchard Drop is a wrapped game we include as-is — it is fun, but it is not one of our verifiable games, so it keeps no record you can re-check.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Fruit falls into a wooden crate under real physics. When two identical fruits touch, they merge into the next fruit up the ladder — cherry, strawberry, grape, dekopon, persimmon, apple, pear, peach, pineapple, melon, and finally the watermelon. Bigger fruit only ever appears by merging, so the crate fills as you chase the next tier. Merge two watermelons and they pop for a bonus.",
        },
        {
          kind: "shot",
          name: "orchard-crate",
          alt: "A cream wooden crate holding a pile of cheerful cartoon fruit — cherries, strawberries, grapes and apples — with a dashed red danger line near the top and the next fruit shown in the header.",
          caption: "Drop and stack fruit in the crate; keep the pile below the dashed danger line.",
        },
      ],
    },
    {
      testid: "howto-controls",
      title: "Controls: aim and drop",
      toc: "Controls",
      blocks: [
        {
          kind: "prose",
          text: "You aim across the top of the crate and release to drop the held fruit. The next fruit is always shown so you can plan the merge.",
        },
        {
          kind: "steps",
          items: [
            "Touch or mouse: drag left and right to aim, then let go to drop.",
            "Keyboard: the left and right arrows move the drop point; Space drops.",
            "There is a short cooldown between drops, so line up the merge before you release.",
          ],
        },
        {
          kind: "note",
          text: "The run ends when a settled fruit rests above the dashed danger line — a fruit merely falling past it is fine. Beat your best score; the header keeps the best for the current session.",
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
          text: "Orchard Drop is not one of our Croft-native games. It plays out under a physics engine rather than a deterministic core, so it does not produce the small, replayable record our own games do — there is nothing to re-verify or share as a proven result. The banner on the game page says the same thing, so the shelf stays honest about what each game is.",
        },
        {
          kind: "note",
          text: "Orchard Drop is an original game for the shelf, a homage to the Suika Game (Watermelon Game). Physics by Matter.js, MIT © @liabru (matter-js). The game runs fully offline once loaded and makes no network requests.",
        },
      ],
    },
  ],
};
