//! Othello's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! place-and-flip interaction, forced passes, and the disc-count goal against the
//! engine.

import type { Guide } from "../../how-to.js";

export const OTHELLO_GUIDE: Guide = {
  title: "How to play Othello",
  lede: "Take turns placing discs on an 8×8 board against The Engine, the shelf's computer opponent. Every disc you place must flank a line of the opponent's discs and flip them to your colour. When neither side can move, the most discs wins. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You and The Engine take turns placing discs. Black goes first. A move is only legal if it traps a straight line of the opponent's discs — horizontally, vertically, or diagonally — between the disc you place and another of your discs; every trapped disc flips to your colour. When neither side has a legal move, the game ends and whoever has the most discs wins. The bar above the board shows both players' disc counts and whose turn it is.",
        },
        {
          kind: "prose",
          text: 'You can choose which disc you play — ● Black (which opens) or ○ White — with the "You play" picker, and set how strong The Engine is with the Difficulty picker (Easy, Medium, Hard, or Expert). Both choices are remembered for next time.',
        },
        {
          kind: "shot",
          name: "othello-board",
          alt: "An Othello game: a turn bar showing both players' disc counts, a difficulty picker and disc chooser, and an 8×8 green board with black and white discs in the centre and a few gold dots marking the legal moves.",
          caption: "The turn bar, the difficulty and disc pickers, and the board with gold dots marking your legal moves.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a highlighted square",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "Placing a disc is a single tap — the same with a mouse, a finger, or the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Legal squares show a small gold dot — tap one to place your disc there.",
            "Every opponent disc the move traps flips to your colour.",
            "The Engine takes its turn; its move is ringed so you can see where it went, then it is your move again.",
          ],
        },
        {
          kind: "note",
          text: "Only squares that flip at least one disc are legal, so most empty squares are not playable — the game's core decides what is legal, not the screen. If you have no legal move you must pass, and the board says so and passes for you; the same happens for The Engine.",
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
          text: "You play against the shelf's engine. Othello is not a solved game from the opening, so the engine is a strong heuristic player — it values corners, mobility, and stable edges — with an exact solve once the board is nearly full. On Easy it plays loosely and is very beatable; on Expert it plays a tough, corner-hungry game. Take corners when you can and avoid the squares next to them.",
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
          text: 'A built-in tutor (Settings → Show tutor) coaches you using the engine\'s own read of the position, so its facts are never wrong — and it needs no download. Tap "Explain my options" for the reasonable moves, each with a one-line idea (takes a corner, your strongest line, or stays safe).',
        },
        {
          kind: "prose",
          text: 'The tutor is honest about certainty. Near the end, when the outcome can be computed exactly, it will tell you a move threw the game; earlier, when it is only reading ahead with a heuristic, it softens to "looks risky" rather than overclaiming — because Othello genuinely cannot be solved from the opening.',
        },
        {
          kind: "shot",
          name: "othello-tutor",
          alt: 'An Othello board mid-game with the tutor panel below it: an "Explain my options" button and a list of reasonable squares, each with a short reason such as "takes a corner" or "stays safe".',
          caption: "The tutor lists the reasonable moves and the idea behind each — engine-grounded, no model download.",
        },
      ],
    },
    {
      testid: "howto-result",
      title: "The experimental opponent, and the verifiable result",
      toc: "AI & result",
      blocks: [
        {
          kind: "prose",
          text: 'On a device with WebGPU, Settings offers an "Experimental: local AI opponent" — a small model that runs entirely in your browser (a one-time download). It picks only from the engine\'s safe moves and adds a little banter, so it plays legally and never throws the game; the strength is still the engine\'s.',
        },
        {
          kind: "prose",
          text: "When the game ends you get a result you can re-verify. It shows the final board and replays every move — yours and The Engine's, passes included — against the game's core to re-derive the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "othello-result",
          alt: "A result panel reading “You won 34–30 — verifiable” with a green Verified check, the final 8×8 board, and a record listing the result, moves, seed, and final hash.",
          caption: "The verifiable result: the final board, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
