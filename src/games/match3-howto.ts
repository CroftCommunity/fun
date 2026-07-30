//! Match-3's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! objective and the tap-to-swap interaction.

import type { Guide } from "../how-to.js";

export const MATCH3_GUIDE: Guide = {
  title: "How to play match-3",
  lede: "Swap adjacent gems to line up three or more of the same kind. You have a fixed number of swaps to score as high as you can — hit the targets to earn stars. Every result is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Score as many points as you can within your swap budget. Passing each score target earns a star — one, two, or three. Reach at least one star to clear the board.",
        },
        {
          kind: "shot",
          name: "match3-board",
          alt: "An 8×8 match-3 board of coloured, shaped gems on a green felt table, with a score / swaps-left / stars / targets bar above it.",
          caption: "The board and the bar above it: your score, swaps left, stars earned, and the star targets.",
        },
      ],
    },
    {
      testid: "howto-board",
      title: "Gems",
      toc: "Gems",
      blocks: [
        {
          kind: "prose",
          text: "Each gem has both a colour and a shape (circle, triangle, square, diamond, star, plus), so they stay distinct however you see colour. A line of three or more of the same gem — across or down — clears and scores. When gems clear, those above fall to fill the gap and new gems drop in, which can set off chain reactions for extra points.",
        },
      ],
    },
    {
      testid: "howto-swaps",
      title: "Making moves: tap two gems to swap",
      toc: "Making moves",
      blocks: [
        {
          kind: "prose",
          text: "You swap two neighbouring gems. As with the other games, you tap — you don't drag.",
        },
        {
          kind: "steps",
          items: [
            "Tap a gem. Its neighbours that would make a match light up.",
            "Tap a lit-up neighbour to swap them and score. If nothing lights up next to a gem, swapping it there wouldn't line anything up.",
            "A swap that makes no match doesn't happen and doesn't cost you a swap — only matching swaps count against your budget.",
          ],
        },
        {
          kind: "shot",
          name: "match3-select",
          alt: "A selected gem outlined in gold with an adjacent gem ringed in gold as the legal swap that would make a match.",
          caption: "Tap a gem and the swaps that make a match glow gold. Tap one to make it.",
        },
      ],
    },
    {
      testid: "howto-help",
      title: "Hints, settings, and daily boards",
      toc: "Help & boards",
      blocks: [
        {
          kind: "steps",
          items: [
            "Today's board is the same for everyone that day; New board deals a fresh random one.",
            "Hint (on by default) highlights a swap you can make; using it counts as assistance.",
            "Turn hints off in Settings and the control becomes “I'm done”, which ends the round early and tallies your score.",
          ],
        },
        {
          kind: "note",
          text: "Score targets are the same for every board for now, so a board can be luckier than another. That's a known trade-off — see the plan — and will be tuned.",
        },
      ],
    },
    {
      testid: "howto-verify",
      title: "Scoring, verifying, and sharing",
      toc: "Verify & share",
      blocks: [
        {
          kind: "prose",
          text: "When your swaps run out, your score is graded into stars and you get a result you can prove. The record carries your swaps, so anyone can replay them against the game's rules and re-derive the same score and stars — no account, no server.",
        },
        {
          kind: "steps",
          items: [
            "Re-verify replays your record and confirms the score matches.",
            "Share this result makes a link carrying the whole record; opening it re-verifies before showing anything.",
          ],
        },
        {
          kind: "shot",
          name: "match3-win",
          alt: "The result screen leading with the stars earned and a Verified badge, showing the record: result, score, stars, swaps used, seed, and final hash, with Re-verify / Share / Play again.",
          caption: "The result screen leads with your stars, the verifiable record, and one-tap re-verify + share.",
        },
      ],
    },
  ],
};
