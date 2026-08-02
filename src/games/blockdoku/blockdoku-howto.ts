//! Blockdoku's "How to play" guide (pure data — see src/how-to.ts). Leads with
//! the drag-to-place interaction (tap-to-place and keyboard are the fallback),
//! then the clearing rule, then difficulty and the verifiable result.

import type { Guide } from "../../how-to.js";

export const BLOCKDOKU_GUIDE: Guide = {
  title: "How to play Blockdoku",
  lede: "Drop pieces onto a 9×9 grid and fill whole rows, columns, or 3×3 boxes to clear them. It never ends in a win — you play for the highest score you can reach before you run out of room. Every finished board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-place",
      title: "Placing a piece: drag it onto the board",
      toc: "Placing",
      blocks: [
        {
          kind: "prose",
          text: "You are dealt three pieces at a time, and placing them is the whole game. Drag with a finger or mouse, or drive it entirely from the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Press a piece in the tray and drag it onto the board — it lifts up and follows your finger.",
            "A preview shows where it will land: it lights up where the whole shape fits and turns red where it doesn't. Release over a lit spot to drop it.",
            "Prefer tapping? Tap a piece to pick it up, then tap the board where its top-left should go.",
            "On a keyboard: press 1, 2, or 3 to pick a piece, nudge the preview with the arrow keys, and press Enter to drop.",
          ],
        },
        {
          kind: "note",
          text: "The game decides legality — a piece only ever lands where the whole shape fits on empty cells, and an off-target drop simply doesn't place.",
        },
        {
          kind: "shot",
          name: "blockdoku-select",
          alt: "A 9×9 board with visible 3×3 boxes, a piece held from the tray, and a highlighted preview showing where it will drop.",
          caption: "Drag a piece over the board — a preview lights up where it fits.",
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
