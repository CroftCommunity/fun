//! Wyrdle's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! objective and the tap-or-type interaction, and explains the two shares.

import type { Guide } from "../../how-to.js";

export const WYRDLE_GUIDE: Guide = {
  title: "How to play Wyrdle",
  lede: "Guess the hidden five-letter word in six tries. Each guess is scored letter by letter: green means right letter, right spot; gold means right letter, wrong spot; grey means the letter isn't in the word. Every finished puzzle is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Find the hidden five-letter word. You get six guesses; each one has to be a real word. Today's word is the same for everyone and rolls over at midnight UTC, so you can compare with friends.",
        },
        {
          kind: "shot",
          name: "wyrdle-board",
          alt: "A six-row grid of letter tiles with one guessed row scored green, gold, and grey, above an on-screen keyboard whose keys have taken on the same colours.",
          caption: "The grid, a scored guess, and the keyboard — keys colour to show what you've learned about each letter.",
        },
      ],
    },
    {
      testid: "howto-marks",
      title: "Reading the tiles",
      toc: "Reading tiles",
      blocks: [
        {
          kind: "prose",
          text: "After each guess every letter gets a mark. Green: the letter is in the word and in that exact spot. Gold: the letter is in the word but somewhere else. Grey: the letter isn't in the word at all. A repeated letter is only marked as many times as it actually appears in the answer.",
        },
        {
          kind: "note",
          text: "Each tile states its result for a screen reader, and the marks differ in brightness as well as colour, so the board reads the same however you see colour.",
        },
      ],
    },
    {
      testid: "howto-typing",
      title: "Making a guess: tap or type",
      toc: "Making a guess",
      blocks: [
        {
          kind: "prose",
          text: "Enter a guess with the on-screen keyboard or by typing on a physical one — both work the same way.",
        },
        {
          kind: "note",
          text: "Every guess must be a real five-letter word. Random letters (like “DKDKD”) are rejected: the row shakes, a “Not in word list” message shows, and no guess is used up — so you can’t spend a row on letters that aren’t a word.",
        },
        {
          kind: "steps",
          items: [
            "Tap or type five letters to fill a row.",
            "Press Enter to submit. If it isn't a real word the row shakes and nothing is used up — fix it and try again.",
            "Backspace deletes the last letter. The keyboard keys colour in as you learn which letters are in the word.",
          ],
        },
      ],
    },
    {
      testid: "howto-hints",
      title: "Hints, settings, and the verifiable result",
      toc: "Hints & result",
      blocks: [
        {
          kind: "prose",
          text: "Hints are on by default; a hint reveals one correct letter and counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the round.",
        },
        {
          kind: "prose",
          text: "When you solve it (or run out of guesses) you get a result you can re-verify: it replays every guess against the game's core and re-derives the outcome, so nothing is taken on trust. Copy the emoji grid to brag without spoiling the word, or share the verifiable link — which replays and checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "wyrdle-win",
          alt: "A result panel headed \"Solved\" with a green Verified check, an emoji grid of green/gold/grey squares, and a record listing the result, guesses used, seed, and final hash.",
          caption: "The verifiable result: solved, re-checked by replay, with the spoiler-free emoji grid and a self-verifying share link.",
        },
      ],
    },
  ],
};
