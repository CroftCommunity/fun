//! Color Sort's "How to play" guide (pure data — see src/how-to.ts). Leads with
//! the interaction model: you TAP a tube to pick it up, then TAP another to pour.

import type { Guide } from "../../how-to.js";

export const COLOR_SORT_GUIDE: Guide = {
  title: "How to play Color Sort",
  lede: "Pour the colours until every tube holds just one. You play by tapping — tap a tube to pick it up, then tap another to pour, and watch it pour. Water, balls, or nuts on a bolt: same puzzle, your choice of look. Endless levels from the first tap; the daily puzzle opens after five solves. Every solve is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Every colour starts jumbled across the tubes. Rearrange them by pouring until each tube is either empty or filled with a single colour. Two spare empty tubes give you room to work. You start in Endless — level 1 is four colours in six tubes, and a colour joins as you climb. Every deal is checked solvable before you see it.",
        },
        {
          kind: "shot",
          name: "color-sort-board",
          alt: "A row of tubes filled with stacked colour segments in different orders, plus two empty tubes, on a green felt board.",
          caption: "The board — full tubes of jumbled colours plus two empty tubes to work with.",
        },
      ],
    },
    {
      testid: "howto-pour",
      title: "Pouring: tap, don’t drag",
      toc: "Pouring",
      blocks: [
        {
          kind: "prose",
          text: "You do not drag. You tap a source tube, then tap where to pour — the same with a mouse, a touchscreen, or the keyboard (the tubes are buttons; number keys 1–9 pick a tube too).",
        },
        {
          kind: "steps",
          items: [
            "Tap a tube to pick it up. The tubes you can legally pour it into light up.",
            "Tap a highlighted tube to pour. Tap the same tube again to put it back down.",
            "You can only pour onto an empty tube or onto a matching colour, and only as much as fits — the whole run of the top colour moves at once, up to the space available.",
            "Tapping an illegal tube just shakes it; the board never changes on an illegal tap.",
            "The pour plays out: the tube lifts, tilts over its target and streams; balls hop across; nuts unscrew and screw down. You can tap the next pour before it has finished.",
          ],
        },
        {
          kind: "shot",
          name: "color-sort-select",
          alt: "One tube raised and outlined as the selected source, with two other tubes ringed to show where it can legally pour.",
          caption: "Tap a tube and its legal destinations glow. Tap one to pour there.",
        },
        {
          kind: "note",
          text: "A tube that is already full of one colour is capped and locked — it’s done, so you can’t pick it up or pour onto it.",
        },
      ],
    },
    {
      testid: "howto-skins",
      title: "Skins and colourblind icons",
      toc: "Skins & icons",
      blocks: [
        {
          kind: "prose",
          text: "The same puzzle renders three ways — water tubes, balls, or nuts on threaded bolts. Switch any time in Settings; it’s instant and never changes the puzzle. Fruit icons put a distinct shape on each colour so the board reads without relying on hue; they’re off by default for water and on for balls and bolts, and your choice sticks. Pour speed — Slow, Normal, Fast or Off — is in Settings too; Off keeps what moved and where and drops the motion, and it is what a reduced-motion preference picks until you choose otherwise.",
        },
      ],
    },
    {
      testid: "howto-help",
      title: "Undo, hints, restart, and Strict mode",
      toc: "Help & modes",
      blocks: [
        {
          kind: "steps",
          items: [
            "Undo steps back one pour — unlimited, and free (this game never rations it).",
            "Restart re-deals the same puzzle so you can try a cleaner line.",
            "Hint (on by default) solves from where you are and points at a good next pour; it only says you’re stuck when there’s genuinely no solving move left.",
            "Strict mode (opt-in) turns undo off for a bit of commitment tension — restart only. Turn hints off and the control becomes “I’m stuck”, which ends the run and reports honestly whether a move was still available.",
          ],
        },
        {
          kind: "note",
          text: "Using undo or a hint counts as assistance — it’s recorded, so a clean solve stays meaningful. You can turn “Declare assistance used” off in Settings, but then the result simply doesn’t claim to be clean.",
        },
      ],
    },
    {
      testid: "howto-verify",
      title: "Daily, endless, and the verifiable result",
      toc: "Verify & share",
      blocks: [
        {
          kind: "prose",
          text: "Endless keeps going, adding a colour as you climb. Daily is one fixed-size puzzle a day, the same for everyone, with a par to beat — it unlocks after five solves of any kind, so the first thing you meet is never a par-32 board. When you solve a puzzle you get a result you can prove: it replays every pour against the game’s core and re-derives the outcome, so nothing is taken on trust. Your solves, streak and best level are kept in this browser; sign in with your atmo provider (the ◎ in the header) and they are tied to you — nothing is sent anywhere until you say so.",
        },
        {
          kind: "steps",
          items: [
            "Re-verify replays your record right there and checks it matches.",
            "Share this result makes a link carrying the whole record; opening it re-verifies before it shows anything, so a shared claim is checked, not trusted.",
          ],
        },
        {
          kind: "shot",
          name: "color-sort-win",
          alt: "A result panel leading with a verifiable solve, a Verified badge, and the record of moves, par, seed, and final hash.",
          caption: "The verifiable result: re-checked by replaying every pour, with a self-verifying share link.",
        },
      ],
    },
  ],
};
