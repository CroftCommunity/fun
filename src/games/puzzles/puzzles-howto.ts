//! The puzzles collection's "How to play" guide (pure data — see src/how-to.ts).
//! The collection is a Tier-2 wrap of Simon Tatham's puzzles, so the guide leads
//! with how to pick a puzzle, explains the pathfinder (Net), and states plainly
//! that — unlike the Croft-native games — these keep no verifiable record.

import type { Guide } from "../../how-to.js";

export const PUZZLES_GUIDE: Guide = {
  title: "How to play Puzzles",
  lede: "A collection of Simon Tatham's logic puzzles, wrapped as-is. Pick one from the row at the top of the play area; each is a self-contained brain-teaser. These are wrapped games — fun and ethical to host, but not our verifiable games, so they keep no record you can re-check.",
  entries: [
    {
      testid: "howto-pick",
      title: "Pick a puzzle",
      toc: "Pick a puzzle",
      blocks: [
        {
          kind: "prose",
          text: "The row of buttons at the top of the play area lists the puzzles in the collection. Tap one to load it in place; tap another to switch. You can deep-link a specific puzzle by adding ?p=<id> to the URL (for example ?p=net), so each puzzle still has its own address.",
        },
      ],
    },
    {
      testid: "howto-net",
      title: "Net (the first puzzle)",
      toc: "Net",
      blocks: [
        {
          kind: "prose",
          text: "Net opens the collection. Rotate each grid square so the whole board joins into one connected network — every square lit, no loose ends, no loops.",
        },
        {
          kind: "steps",
          items: [
            "Left-click or tap a square to rotate it anticlockwise; right-click to rotate it clockwise.",
            "Middle-click (or shift-click) to lock a square you are sure about, so you do not nudge it again; repeat to unlock.",
            "Aim to light up every square by connecting it back to the centre — not just the endpoint blobs.",
            "Use the Type menu for bigger boards or a 'wrapping' variant once the basics feel easy.",
          ],
        },
        {
          kind: "note",
          text: "Net keeps its original mouse controls rather than our tap-first model, so all three mouse buttons (or shift to lock) matter — it plays best with a mouse.",
        },
      ],
    },
    {
      testid: "howto-wrapped",
      title: "A wrapped collection — no verifiable record",
      toc: "Wrapped game",
      blocks: [
        {
          kind: "prose",
          text: "These are Simon Tatham's Portable Puzzle Collection, included as-is. They are well made and ethical to host, but they are not Croft-native, so they produce none of the small, replayable records our own games do — there is nothing to re-verify or share as a proven result. The banner on the page says the same thing, so the shelf stays honest about what each game is.",
        },
        {
          kind: "note",
          text: "Simon Tatham's Portable Puzzle Collection, released under the MIT licence. Source: chiark.greenend.org.uk/~sgtatham/puzzles/.",
        },
      ],
    },
  ],
};
