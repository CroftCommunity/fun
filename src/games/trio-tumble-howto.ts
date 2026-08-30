//! Trio Tumble's "How to play" guide (pure data — see src/how-to.ts). Walks the whole
//! play experience in order: the goal, how to move, matches + cascades, the special
//! candies, combining two specials, the six objectives, help, and the verifiable
//! result. Each section is scannable (short prose + step lists), and the copy is
//! unit-tested, so it stays in sync with the game.

import type { Guide } from "../how-to.js";

export const TRIO_TUMBLE_GUIDE: Guide = {
  title: "How to play Trio Tumble",
  lede: "Swipe a candy toward its neighbour to line up three or more of the same kind. Play through the level campaign, or pick one of six objectives — and earn a result anyone can re-verify, no account, no server.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Trio Tumble gives you a board of coloured, shaped gems and a fixed number of swaps. Line gems up to clear them and drive toward your objective. The classic one is Target score: bank as many points as you can within your swap budget for one, two, or three stars. Five other objectives — clear blockers, clear jelly, drop ingredients, complete an order checklist, and clear obstacles — share the same board and controls; the New board button under the board opens a card where you pick which you play, and the start screen offers the same card.",
        },
        {
          kind: "shot",
          name: "trio-tumble-board",
          alt: "An 8×8 match-3 board of coloured, shaped gems on a green felt table, with a score / swaps-left / stars / targets bar above it.",
          caption: "The board and the bar above it: your score, swaps left, stars earned, and the star targets.",
        },
      ],
    },
    {
      testid: "howto-campaign",
      title: "Levels and progress",
      toc: "Levels",
      blocks: [
        {
          kind: "prose",
          text: "You start in the campaign at Level 1. Each level is a fresh board with its own star targets; reach one star to clear it and unlock the next. The first couple of levels are deliberately gentle — Level 1 even glows an obvious opening swap to get you going — so you can learn the feel before the targets climb. Your best stars per level are remembered, and an in-progress board is saved as you play: come back later and it resumes right where you left off. New board, under the board, opens a card where you jump to Today’s board, a New board, another level, or any of the six objectives.",
        },
      ],
    },
    {
      testid: "howto-moves",
      title: "Making a move: swipe (or tap) to swap",
      toc: "Making moves",
      blocks: [
        {
          kind: "prose",
          text: "You play by swapping two neighbouring candies. Swipe a candy toward the neighbour you want to swap it with — a quick flick up, down, left, or right. Prefer tapping? Tap a candy, then tap a neighbour. Tapping (and the keyboard) is always the accessible floor, so you can play whichever way feels best.",
        },
        {
          kind: "steps",
          items: [
            "Tap or press a candy. Its neighbours that would make a match light up gold.",
            "Swipe toward a neighbour — or tap a lit-up one — to swap the two and score. If nothing lights up around a candy, swapping it there would not line anything up.",
            "A swap that makes no match does not happen and does not cost you a swap — only matching swaps count against your budget.",
          ],
        },
        {
          kind: "shot",
          name: "trio-tumble-select",
          alt: "A selected candy outlined in gold with an adjacent candy ringed in gold as the legal swap that would make a match.",
          caption: "Tap a candy and the swaps that make a match glow gold — tap one, or swipe toward it.",
        },
      ],
    },
    {
      testid: "howto-matches",
      title: "Matches and cascades",
      toc: "Matches",
      blocks: [
        {
          kind: "prose",
          text: "A line of three or more of the same gem — across or down — clears and scores. When gems clear, the gems above fall to fill the gaps and new gems drop in from the top, which can line up fresh matches on their own. Those chain reactions (cascades) keep scoring, so one well-placed swap can clear far more than three gems.",
        },
        {
          kind: "note",
          text: "Every gem has both a colour and a shape (circle, triangle, square, diamond, star, plus), so they stay distinct however you see colour.",
        },
      ],
    },
    {
      testid: "howto-specials",
      title: "Special candies",
      toc: "Special candies",
      blocks: [
        {
          kind: "prose",
          text: "Match more than three, or in a shape, and one gem becomes a special candy — a normal swappable gem carrying a power, shown with a badge. Set it off by matching it, or by swapping it with any neighbour; a special also goes off if another special's blast reaches it, which can chain across the board.",
        },
        {
          kind: "steps",
          items: [
            "Striped — line up four in a row or column. Fired, it clears its whole row or column.",
            "Wrapped — bend a line into an L or T shape. Fired, it bursts the 3×3 block around it, then explodes a second time as gems fall in.",
            "Colour bomb — line up five. Swap it with any gem and every gem of that gem's colour clears at once.",
            "Fish — make a 2×2 block of one colour. Fired, it swims off to eat a target cell, seeking out jelly first.",
          ],
        },
      ],
    },
    {
      testid: "howto-combos",
      title: "Combining two specials",
      toc: "Combos",
      blocks: [
        {
          kind: "prose",
          text: "Swap two special candies with each other and they combine into a single, bigger blast — the most powerful moves in the game, and the key to a three-star run.",
        },
        {
          kind: "steps",
          items: [
            "Striped + striped clears a full row and a full column (a cross).",
            "Striped + wrapped clears a three-wide row and a three-wide column (a thick cross).",
            "Wrapped + wrapped clears a 5×5 block.",
            "Colour bomb + striped or wrapped turns every gem of the partner's colour into that special and sets them all off.",
            "Colour bomb + colour bomb clears the entire board.",
            "A fish combined with another special sends out a small school of fish, each eating a target and carrying that partner's blast.",
          ],
        },
      ],
    },
    {
      testid: "howto-objectives",
      title: "The six objectives",
      toc: "Objectives",
      blocks: [
        {
          kind: "prose",
          text: "The New board card picks what you are playing for. Target score is graded on points and stars; the other five are graded on how few swaps it takes, and you win the moment the objective is met.",
        },
        {
          kind: "steps",
          items: [
            "Target score — bank as many points as you can within your swap budget. Passing each score target earns a star (one, two, or three); reach at least one star to clear the board.",
            "Clear blockers — the board holds locked tiles you cannot swap; a match made next to a blocker chips it away. Clear them all.",
            "Clear jelly — some squares are coated with jelly; a match made on top of a jellied square scrubs it off. Scrub it all.",
            "Ingredients — a few objects drop in at the top; they cannot be swapped, but clearing the gems beneath one drops it, and it is collected when it reaches the bottom row. Bring them all down.",
            "Orders — a checklist of goals to finish: clear a set number of one colour, and make a set number of striped and wrapped candies. The bar above the board tallies each goal and ticks it off when you reach it; finish the whole list to win.",
            "Clear obstacles — a mix of licorice (single-hit) and meringue (a durable tile that needs several hits — it shows how many are left). A match made next to one chips it, like a blocker. Clear every obstacle.",
          ],
        },
        {
          kind: "note",
          text: "The clear objectives use single-layer blockers and jelly and a few ingredients, so one match clears each; meringue takes a few, and Orders asks for goals a strong line can reach in the budget. Every daily board is solver-checked, so it is always solvable.",
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
            "Hint (on by default) highlights a swap you can make; using it marks the run as assisted.",
            "Turn hints off in Settings and the control becomes “I'm done”, which ends the round early and tallies your result.",
          ],
        },
        {
          kind: "note",
          text: "In Target score the star thresholds are tuned per board: each deal's targets scale to what a strong reference player scores on it, so a richer board asks for more. The three targets show in the bar above the board.",
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
          text: "When your swaps run out — or the board clears — you get a result you can prove. The record carries your swaps, so anyone can replay them against the game's rules and re-derive the same outcome (your score and stars, or your swaps-to-clear), with no account and no server.",
        },
        {
          kind: "steps",
          items: [
            "Re-verify replays your record and confirms it checks out.",
            "Share this result makes a link carrying the whole record; opening it re-verifies before showing anything.",
          ],
        },
        {
          kind: "shot",
          name: "trio-tumble-win",
          alt: "The result screen leading with the stars earned and a Verified badge, showing the record: result, score, stars, swaps used, seed, and final hash, with Re-verify / Share / Play again.",
          caption: "The result screen leads with your outcome, the verifiable record, and one-tap re-verify + share.",
        },
      ],
    },
  ],
};
