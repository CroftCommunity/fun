//! The bubble shooter's "How to play" guide (pure data — see src/how-to.ts).
//! Leads with the objective and the aim-and-shoot interaction.

import type { Guide } from "../../how-to.js";

export const BUBBLE_GUIDE: Guide = {
  title: "How to play the bubble shooter",
  lede: "Clear every bubble off the board before your shots run out. The launcher at the bottom holds a colour to fire and shows the next one on deck; aim an angle and fire — the bubble flies up, bounces off the walls, and sticks where it first touches. Three or more of the same colour touching pop, and anything left hanging falls away. Every cleared board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Empty the board. You have a fixed number of shots; clear every bubble before they run out and you win. Today's board is always one that can be cleared, so it is always fair.",
        },
        {
          kind: "shot",
          name: "bubble-board",
          alt: "A staggered honeycomb of coloured, shaped bubbles on a green felt table, with a launcher at the bottom holding the loaded colour and a smaller on-deck colour beside it, a dotted aim line and a landing ring showing where the shot will stick, and a score / shots-left bar.",
          caption: "The board, the launcher showing the loaded colour and the next one on deck, the dotted aim guide showing where the shot will land, and the bar: your score and shots left.",
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
          text: "Each bubble has both a colour and a shape (circle, triangle, square, diamond, star, plus), so they stay distinct however you see colour. The launcher shows two colours — the one loaded now and the next one on deck — so you can plan two shots ahead. The on-deck colour is picked a shot early, so now and then it lands with nothing to match yet; plan around it.",
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
            "Aim: move the pointer over the board (or drag on a touchscreen), use the ←/→ keys, or drag the Aim slider.",
            "Read the dotted guide — it shows the flight path, including wall bounces, and rings the cell the bubble will stick to.",
            "Fire: click/tap the board, press the Fire button, or press Space. The bubble flies to exactly where the guide showed.",
          ],
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
          text: "When your shot makes a group of three or more of the same colour touching, the whole group pops in a burst. Better still: any bubbles left hanging with nothing connecting them to the top of the board come loose and fall away — so popping the right group can clear a whole cluster at once. Both popped and dropped bubbles score, and drops are worth double.",
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
          text: "Hints are on by default and set your aim to a strong shot (the one that pops the most right now); using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the round and reports the result honestly.",
        },
        {
          kind: "prose",
          text: "When the board clears (or your shots run out) you get a result you can re-verify: it replays every shot against the game's core and re-derives the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "bubble-win",
          alt: "A result panel headed \"Board cleared\" with a green Verified check and a record listing the score, shots used, seed, and final hash.",
          caption: "The verifiable result: cleared, re-checked by replay, with the record and a self-verifying share link.",
        },
      ],
    },
  ],
};
