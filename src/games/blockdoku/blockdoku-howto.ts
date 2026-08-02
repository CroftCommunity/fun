//! Blockdoku's "How to play" guide (pure data — see src/how-to.ts). Leads with
//! the tap-to-select / tap-to-place interaction, then the clearing rule, then
//! difficulty and the verifiable result.

import type { Guide } from "../../how-to.js";

export const BLOCKDOKU_GUIDE: Guide = {
  title: "How to play Blockdoku",
  lede: "Drop pieces onto a 9×9 grid and fill whole rows, columns, or 3×3 boxes to clear them. It never ends in a win — you play for the highest score you can reach before you run out of room. Every finished board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-place",
      title: "Placing a piece: tap, then tap",
      toc: "Placing",
      blocks: [
        {
          kind: "prose",
          text: "You are dealt three pieces at a time. Placing them is the whole game, and it works the same with a mouse, a finger, or the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Tap a piece in the tray to pick it up — the cells where it can legally go light up.",
            "Tap any glowing cell to drop the piece there.",
            "On a keyboard: press 1, 2, or 3 to pick a piece, move the cursor with the arrow keys, and press Enter to drop.",
          ],
        },
        {
          kind: "note",
          text: "Only legal spots glow, and the game decides — tapping anywhere else does nothing. A piece needs empty cells for its whole shape to fit.",
        },
        {
          kind: "shot",
          name: "blockdoku-select",
          alt: "A 9×9 board with a piece selected in the tray and several cells glowing gold to show where it can be dropped.",
          caption: "Tap a piece and the legal drop cells glow — tap one to place it.",
        },
      ],
    },
    {
      testid: "howto-clear",
      title: "Clearing lines and boxes",
      toc: "Clearing",
      blocks: [
        {
          kind: "prose",
          text: "Fill an entire row, an entire column, or an entire 3×3 box and it clears, freeing space again. Clearing more than one region with a single piece is a combo and scores bonus points; keep chaining combos and a streak bonus builds on top. The pieces don't fall or rotate — where you drop a piece is where it stays.",
        },
        {
          kind: "shot",
          name: "blockdoku-board",
          alt: "A 9×9 Blockdoku board with blue blocks placed across it and a tray of three pieces below, a score and streak bar above.",
          caption: "The board, the score / best / streak bar, and the three-piece tray.",
        },
      ],
    },
    {
      testid: "howto-end",
      title: "Difficulty, hints, and the result",
      toc: "Difficulty & result",
      blocks: [
        {
          kind: "prose",
          text: "The game ends when none of your three pieces fits anywhere. Difficulty changes which pieces you're dealt and your score multiplier: easy deals larger, friendlier pieces at 1.5×; normal and expert allow every shape (expert at 0.5× with a move limit); hard restricts to small pieces at 0.8×.",
        },
        {
          kind: "prose",
          text: "Hints are on by default and point at a good move; using one — or an Undo — counts as assistance, noted honestly on your result. Turn hints off and the button becomes \"I'm stuck\", which ends the round and says whether a move was still possible.",
        },
        {
          kind: "prose",
          text: "When the board is done you get a result you can re-verify: it replays every placement against the game's core and re-derives your score, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "blockdoku-result",
          alt: "A result panel with a green Verified check and a record listing the result, score, moves, and final hash.",
          caption: "The verifiable result: re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
