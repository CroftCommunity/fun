//! Drop 4's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! tap-a-column interaction and the four-in-a-row goal against the engine.

import type { Guide } from "../../how-to.js";

export const DROP4_GUIDE: Guide = {
  title: "How to play Drop 4",
  lede: "Take turns dropping discs into a seven-column board against The Engine, the shelf's computer opponent. Line up four of your discs in a row — across, up, or on a diagonal — before it does. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You and The Engine take turns dropping discs; you go first. A disc falls to the lowest empty slot in the column you pick. The first player to get four of their own discs in a line — horizontally, vertically, or diagonally — wins. If the board fills with no line, it is a draw. The bar above the board shows both players and whose turn it is.",
        },
        {
          kind: "prose",
          text: "You choose which disc you play — ✕ or ○ — and how strong The Engine is (Easy, Medium, Hard, or Expert) on the start screen, or from the New game button under the board. Both choices are remembered for next time, and the level shows beside the game\u2019s name.",
        },
        {
          kind: "shot",
          name: "drop4-board",
          alt: "A Drop 4 game inside the game frame: two seats above the board — ✕ You and ○ The Engine — a seven-column board on a green felt frame with a drop-arrow above each column and red and blue discs stacked in the columns, and New game and Settings buttons under it.",
          caption: "The two seats (The Engine’s pulses while it thinks), and the board with a drop arrow above each column.",
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
            "Tap anywhere in the column you want — the drop arrow (▼) above it lights up to show it is playable.",
            "Your disc falls to the lowest empty slot in that column.",
            "The Engine takes its turn; its move is ringed so you can see where it went, then it is your move again.",
          ],
        },
        {
          kind: "note",
          text: "Only columns with room light up as targets. A full column is not a legal move, so tapping it does nothing — the game's core decides what is legal, not the screen.",
        },
      ],
    },
    {
      testid: "howto-opponent",
      title: "The Engine",
      toc: "The opponent",
      blocks: [
        {
          kind: "prose",
          text: "You play against the shelf's classic engine — the same engine that knows this game exactly. It replies in a moment, takes any win it sees, and blocks yours. On Easy it plays loosely and is very beatable; on Expert it never makes a mistake. Pick a level that suits you and look a move or two ahead.",
        },
      ],
    },
    {
      testid: "howto-tutor",
      title: "The tutor: coaching from the engine",
      toc: "The tutor",
      blocks: [
        {
          kind: "prose",
          text: "A built-in tutor coaches you using the engine's own knowledge, so its facts are never wrong — and it needs no download. Tap \"Explain my options\" for the reasonable moves in the position, each with a one-line idea (wins now, blocks their threat, your strongest line, or stays safe).",
        },
        {
          kind: "prose",
          text: "If a move gives up the game, the tutor says so after The Engine replies — honestly. Near the end, when the outcome is certain, it will tell you a move threw the game; earlier, when it is only reading ahead, it softens to \"looks risky\" rather than overclaiming. The Hint button names a column and why it is good.",
        },
        {
          kind: "shot",
          name: "drop4-tutor",
          alt: "A Drop 4 board mid-game with the tutor panel below it: an \"Explain my options\" button and a list of reasonable columns, each with a short reason such as \"stays safe\" or \"your strongest line\".",
          caption: "The tutor lists the reasonable moves and the idea behind each — engine-grounded, no model download.",
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
          text: "Hints are on by default; a hint names a strong column and why it is strong (see the tutor above). Using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the game whenever you like.",
        },
        {
          kind: "prose",
          text: "When the game ends the winning four is highlighted for a moment, then you get a result you can re-verify. It shows the final board and replays every drop — yours and The Engine's — against the game's core to re-derive the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "drop4-result",
          alt: "A result panel reading “You won — verifiable” with a green Verified check, the final board with the winning four discs ringed in gold, and a record listing the result, moves, seed, and final hash.",
          caption: "The verifiable result: the final board with the winning line, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
