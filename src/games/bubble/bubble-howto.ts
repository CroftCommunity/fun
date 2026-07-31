//! The bubble shooter's "How to play" guide (pure data — see src/how-to.ts).
//! Leads with the objective and the tap-to-aim interaction.

import type { Guide } from "../../how-to.js";

export const BUBBLE_GUIDE: Guide = {
  title: "How to play the bubble shooter",
  lede: "Clear every bubble off the board before your shots run out. The launcher loads a colour; tap where you want it to land. Three or more of the same colour touching pop, and anything left hanging drops. Every cleared board is a record anyone can re-verify.",
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
          alt: "A staggered honeycomb of coloured, shaped bubbles on a green felt table, with a launcher showing the next colour and a score / shots-left bar.",
          caption: "The board, the launcher with your next colour, and the bar: your score and shots left.",
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
          text: "Each bubble has both a colour and a shape (circle, triangle, square, diamond, star, plus), so they stay distinct however you see colour. The launcher only ever loads a colour that is still on the board, so every shot can do something.",
        },
      ],
    },
    {
      testid: "howto-aim",
      title: "Making a shot: tap where it lands",
      toc: "Making a shot",
      blocks: [
        {
          kind: "prose",
          text: "You aim by tapping — you don't drag or hold. The empty cells you can reach light up; tap one to drop the launcher's bubble there.",
        },
        {
          kind: "steps",
          items: [
            "Look at the launcher for the colour you're about to shoot.",
            "The reachable landing cells glow. Tap the one where you want the bubble.",
            "Only glowing cells take a shot — if a cell isn't lit, the bubble can't reach it.",
          ],
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
          text: "When your shot makes a group of three or more of the same colour touching, the whole group pops. Better still: any bubbles left hanging with nothing connecting them to the top of the board drop away too — so popping the right group can clear a whole cluster at once. Both popped and dropped bubbles score, and drops are worth double.",
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
          text: "Hints are on by default and point at a legal place to aim; using one counts as assistance, which is noted honestly on your result. Turn hints off and the button becomes \"I'm done\", which ends the round and tells you whether a shot was still available.",
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
