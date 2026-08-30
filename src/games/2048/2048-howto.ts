//! 2048's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! slide interaction and the merge rule.

import type { Guide } from "../../how-to.js";

export const TWENTY48_GUIDE: Guide = {
  title: "How to play 2048",
  lede: "Slide the tiles to combine them. When two tiles with the same number touch, they merge into their sum. Get a tile to 2048 to win. Every finished board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Make a 2048 tile. Every slide pushes all the tiles as far as they go and drops one new tile onto the board; the game ends when the board is full with no move left. Today's board is the same for everyone and rolls over at midnight UTC.",
        },
        {
          kind: "shot",
          name: "2048-board",
          alt: "A 4x4 grid of numbered tiles in warm colours on a green felt board, with the score and best tile on the frame's meters above and an arrow pad below.",
          caption: "The board, the score and best tile on the meters, and the arrow pad you slide with.",
        },
      ],
    },
    {
      testid: "howto-slide",
      title: "Sliding: pad, swipe, or keys",
      toc: "Sliding",
      blocks: [
        {
          kind: "prose",
          text: "You can slide three ways, whichever suits you — they do exactly the same thing.",
        },
        {
          kind: "steps",
          items: [
            "Tap an arrow on the on-screen pad (↑ ↓ ← →).",
            "Or swipe across the board in the direction you want.",
            "Or use the arrow keys (or W A S D) on a physical keyboard.",
          ],
        },
        {
          kind: "note",
          text: "A slide that wouldn't move or merge anything does nothing — the game only counts a move that actually changes the board.",
        },
      ],
    },
    {
      testid: "howto-merge",
      title: "Merging tiles",
      toc: "Merging",
      blocks: [
        {
          kind: "prose",
          text: "When two tiles with the same number slide into each other they merge into one tile worth their sum: two 2s become a 4, two 4s become an 8, and so on up to 2048. A freshly-merged tile won't merge again on the same slide. Every merge adds its new value to your score, and each tile shows its number, so the board reads clearly however you see colour.",
        },
      ],
    },
    {
      testid: "howto-result",
      title: "Hints, settings, and the verifiable result",
      toc: "Hints & result",
      blocks: [
        {
          kind: "prose",
          text: "Hints are on by default and suggest a direction to try; using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the round whenever you like.",
        },
        {
          kind: "prose",
          text: "When you make 2048 (or the board fills up, or you're done) you get a result you can re-verify: it replays every slide against the game's core and re-derives your score, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "2048-result",
          alt: "A result panel with a green Verified check and a record listing the result, score, best tile, moves, seed, and final hash.",
          caption: "The verifiable result: re-checked by replay, with the record and a self-verifying share link.",
        },
      ],
    },
  ],
};
