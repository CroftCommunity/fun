//! The bubble shooter's "How to play" guide (pure data — see src/how-to.ts).
//! Leads with the levels game: climb the levels by scoring before the descending
//! stack reaches the bottom.

import type { Guide } from "../../how-to.js";

export const BUBBLE_GUIDE: Guide = {
  title: "How to play the bubble shooter",
  lede: "Climb the levels. The launcher at the bottom holds a colour to fire and shows the next one on deck; aim an angle and fire — the bubble flies up, bounces off the walls, and sticks where it first touches. Three or more of the same colour touching pop, and anything left hanging falls away and scores double. Earn each level's points target to move up — but every few shots a new row is pushed in at the top, marching the stack toward the bottom line. Reach as high a level as you can before it crosses. Every result is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Score points and climb. Each level needs a target number of points; reach it and you advance to a harder level — more colours, a higher target, and new rows arriving faster. You lose when the stack of bubbles is pushed down far enough to cross the line at the bottom, so keep it short. There is no finish line: the aim is to reach the highest level you can.",
        },
        {
          kind: "shot",
          name: "bubble-board",
          alt: "A staggered honeycomb of coloured, shaped bubbles on a green felt table, with a launcher at the bottom holding the loaded colour and a smaller on-deck colour beside it, a dotted aim line and landing ring, the frame's meters above showing the level, the score and the clock slot, and a HUD beside the board with a progress bar toward the next level and how many shots until the stack drops.",
          caption: "The board and launcher, the dotted aim guide, the level and score on the frame's meters, and the HUD: progress to the next level and shots until the next row drops in.",
        },
      ],
    },
    {
      testid: "howto-bubbles",
      title: "Bubbles",
      toc: "Bubbles",
      blocks: [
        {
          kind: "prose",
          text: "Each bubble has both a colour and a shape (circle, triangle, square, diamond, star, plus), so they stay distinct however you see colour. The launcher shows two colours — the one loaded now and the next one on deck — so you can plan two shots ahead. Higher levels add more colours, so matches get harder to line up.",
        },
      ],
    },
    {
      testid: "howto-aim",
      title: "Making a shot: aim and fire",
      toc: "Making a shot",
      blocks: [
        {
          kind: "prose",
          text: "Point the launcher at the angle you want, then fire. The bubble flies up, bounces off the side walls, and sticks the instant it touches the ceiling or another bubble. A dotted guide previews the path and marks where the shot will land, so you can line up a bounce before you commit.",
        },
        {
          kind: "steps",
          items: [
            "Aim: drag the Aim slider under the board (its live readout shows the angle), move the pointer over the board, or use the ←/→ keys.",
            "Read the dotted guide — it shows the flight path, including wall bounces, and rings the cell the bubble will stick to.",
            "Fire: press the full-width Fire button right below the slider, tap the board, or press Space. The bubble flies to exactly where the guide showed.",
          ],
        },
        {
          kind: "prose",
          text: "Aiming feel depends on your device, so \"⚙ Aim & controls\" under the slider lets you tune it — each setting has a live demo. Turn on Fire on release to shoot by just letting go of the slider (no button); set a Snap step so the aim clicks to steady angles; lower the Swipe gain for finer control; and, with fire-on-release on, a Release settle delay guards against accidental shots. All off/neutral by default.",
        },
        {
          kind: "prose",
          text: "Want a tougher shot? Turn off \"Show aim guide\" in Settings and the dotted preview disappears — you aim by eye. It's purely a display choice; the shot still lands wherever the angle sends it.",
        },
      ],
    },
    {
      testid: "howto-pop",
      title: "Popping and dropping",
      toc: "Popping",
      blocks: [
        {
          kind: "prose",
          text: "When your shot makes a group of three or more of the same colour touching, the whole group pops in a burst. Better still: any bubbles left hanging with nothing connecting them to the top of the board come loose and fall away — so popping the right group can clear a whole cluster at once. Popped bubbles score, but a big drop scores far more (the more you cut loose in one shot, the bigger the reward) — so the way to hit a level's target fast is to set up large drops, not just pop trios.",
        },
      ],
    },
    {
      testid: "howto-levels",
      title: "Levels, the descending stack, and the timer",
      toc: "Levels & pressure",
      blocks: [
        {
          kind: "prose",
          text: "Every few shots a fresh row of bubbles is pushed in at the top and the whole stack slides down one row — the classic bubble-shooter pressure. As you climb, rows arrive more often and the point target rises, so each level is tighter than the last. The HUD's \"stack drops in\" counter tells you how many shots until the next row; clear space before it lands.",
        },
        {
          kind: "prose",
          text: "Prefer racing a clock? Turn on \"Show level timer\" in Settings and the clock meter counts down each level. It's a practice aid only — it is never part of your verified result and running it down never ends the run; only the stack crossing the bottom line does.",
        },
        {
          kind: "prose",
          text: "Want the original instead? Pick Classic on the New game card for the clear-the-board game: empty a fixed daily board within a shot budget, with its own verifiable result.",
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
          text: "Hints are on by default and set your aim to a strong shot (the one that removes the most bubbles right now); using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the run and reports the result honestly.",
        },
        {
          kind: "prose",
          text: "When the stack finally crosses the line you get a result you can re-verify: the level you reached and your score, replayed shot-by-shot against the game's core so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "bubble-win",
          alt: "A result panel headed \"Reached level N\" with a star grade, a green Verified check, and a record listing the score, shots fired, seed, and final hash.",
          caption: "The verifiable result: the level you reached and your score, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
