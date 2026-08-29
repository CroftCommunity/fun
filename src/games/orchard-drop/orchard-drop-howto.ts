//! Orchard Drop's "How to play" guide (pure data — see `src/how-to.ts`).
//!
//! Rewritten for the Tier-1 rebuild. The old guide's third section said the game
//! kept **no verifiable record**; that was true of the wrap and is false now, so
//! it is replaced rather than softened. The closing note keeps the Suika-lineage
//! credit, which lost its registry home when the entry stopped being Tier-2 —
//! `Tier1GameEntry` has no `attribution` field, so this is where the homage is
//! acknowledged.

import type { Guide } from "../../how-to.js";

export const ORCHARD_DROP_GUIDE: Guide = {
  title: "How to play Orchard Drop",
  lede: "Drop fruit into the crate; two of the same fruit merge into the next one up an eleven-step ladder, all the way to the watermelon. Every run is replayable: the record you finish with can be re-checked, by you or by anyone you send it to.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Fruit falls into a wooden crate and settles. When two identical fruits touch, they merge into the next fruit up the ladder — cherry, strawberry, grape, dekopon, persimmon, apple, pear, peach, pineapple, melon, and finally the watermelon. Bigger fruit only ever appears by merging, so the crate fills as you chase the next tier. Merge two watermelons and they pop for a bonus.",
        },
        {
          kind: "shot",
          name: "orchard-crate",
          alt: "A wooden crate holding a pile of cheerful cartoon fruit — cherries, strawberries, grapes and apples — with a dashed red danger line near the top and the next fruit shown in the header.",
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
          text: "You aim across the top of the crate and release to drop the held fruit. The next fruit is always shown, so you can plan the merge before it arrives.",
        },
        {
          kind: "steps",
          items: [
            "Touch or mouse: drag left and right to aim, then let go to drop.",
            "Keyboard: the left and right arrows move the drop point; Space drops.",
            "There is a short cooldown between drops, so line up the merge before you release.",
            "Aiming past the edge is fine — the drop lands at the edge rather than being refused.",
          ],
        },
        {
          kind: "note",
          text: "The run ends when a settled fruit rests above the dashed danger line — a fruit merely falling past it is fine. A fruit made by a merge counts straight away, with no grace period, so a merge high in the crate is a risk as well as a reward.",
        },
      ],
    },
    {
      testid: "howto-daily",
      title: "Daily and free play",
      toc: "Daily",
      blocks: [
        {
          kind: "prose",
          text: "The daily crate is the same for everyone on a given day, so a score is worth comparing. Free play deals a fresh crate whenever you want one. Which fruit arrives next comes from the seed, so the same seed always deals the same run — that is what makes a record checkable.",
        },
      ],
    },
    {
      testid: "howto-verify",
      title: "A verifiable run",
      toc: "Verifiable",
      blocks: [
        {
          kind: "prose",
          text: "Orchard Drop keeps a small record of your run: the seed it was dealt from and the drops you made. Anyone can replay that record and re-derive the result — the score is not taken on trust, it is worked out again from the moves. The end screen offers a one-tap re-verify, and a share link that carries the whole record.",
        },
        {
          kind: "note",
          text: "Opening a shared link re-checks it before showing anything. A record that has been edited will not verify, and the page says so rather than displaying a result it cannot stand behind.",
        },
      ],
    },
    {
      testid: "howto-credit",
      title: "Where it comes from",
      toc: "Credit",
      blocks: [
        {
          kind: "prose",
          text: "Orchard Drop is an original game for the shelf, a homage to the Suika Game (Watermelon Game) and the drop-and-merge fruit genre it started. No Suika code or art is used.",
        },
        {
          kind: "note",
          text: "It began here as a wrapped game running a third-party physics engine, which meant it could be fun but not checkable. It now runs on our own fixed-point physics, which produces the same result on every machine — that is what a replayable record needs, and it is why the game was rebuilt rather than left as it was. The game runs fully offline once loaded and makes no network requests.",
        },
      ],
    },
  ],
};
