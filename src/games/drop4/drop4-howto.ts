//! Drop 4's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! tap-a-column interaction and the four-in-a-row goal against the engine.

import type { Guide } from "../../how-to.js";

export const DROP4_GUIDE: Guide = {
  title: "How to play Drop 4",
  lede: "Take turns dropping discs into a seven-column board against the computer. Line up four of your discs in a row — across, up, or on a diagonal — before it does. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You are ✕ and you go first; the computer is ○. On your turn you drop one disc into a column and it falls to the lowest empty slot. The first player to get four of their own discs in a line — horizontally, vertically, or diagonally — wins. If the board fills with no line, it is a draw.",
        },
        {
          kind: "shot",
          name: "drop4-board",
          alt: "A seven-column Drop 4 board on a green felt frame, with a row of drop buttons above the grid and a few red and blue discs stacked in the columns.",
          caption: "The board, the drop buttons above each column, and the discs stacked from the bottom.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a column",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "Dropping a disc is a single tap — the same with a mouse, a finger, or the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Tap the drop button (▾) above the column you want.",
            "Your disc falls to the lowest empty slot in that column.",
            "The computer takes its turn, then it is your move again.",
          ],
        },
        {
          kind: "note",
          text: "Only columns with room glow as targets. A full column is not a legal move, so tapping it does nothing — the game's core decides what is legal, not the screen.",
        },
      ],
    },
    {
      testid: "howto-opponent",
      title: "The computer opponent",
      toc: "The opponent",
      blocks: [
        {
          kind: "prose",
          text: "You play against the shelf's classic engine — the same engine that knows this game exactly. It replies in a moment, takes any win it sees, and blocks yours. It plays a solid game, so look a move or two ahead.",
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
          text: "Hints are on by default and point out a strong column to drop into; using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the game whenever you like.",
        },
        {
          kind: "prose",
          text: "When the game ends you get a result you can re-verify: it replays every drop — yours and the engine's — against the game's core and re-derives the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "drop4-result",
          alt: "A result panel with a green Verified check and a record listing the result, moves, seed, and final hash.",
          caption: "The verifiable result: re-checked by replay, with the record and a self-verifying share link.",
        },
      ],
    },
  ],
};
