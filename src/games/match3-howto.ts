//! Match-3's "How to play" guide (pure data — see src/how-to.ts). Walks the whole
//! play experience in order: the goal, how to move, matches + cascades, the special
//! candies, combining two specials, the four objectives, help, and the verifiable
//! result. Each section is scannable (short prose + step lists), and the copy is
//! unit-tested, so it stays in sync with the game.

import type { Guide } from "../how-to.js";

export const MATCH3_GUIDE: Guide = {
  title: "How to play match-3",
  lede: "Swap two neighbouring gems to line up three or more of the same kind. Play toward one of four objectives, and earn a result anyone can re-verify — no account, no server.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Match-3 gives you a board of coloured, shaped gems and a fixed number of swaps. Line gems up to clear them and drive toward your objective. The classic one is Target score: bank as many points as you can within your swap budget for one, two, or three stars. Three other objectives — clear blockers, clear jelly, and drop ingredients — share the same board and controls; the buttons above the board pick which you play.",
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
      testid: "howto-moves",
      title: "Making a move: tap two gems to swap",
      toc: "Making moves",
      blocks: [
        {
          kind: "prose",
          text: "You play by swapping two neighbouring gems. As with every game on the shelf you tap — you don't need to drag (dragging also works on a desktop, but tapping is the accessible floor).",
        },
        {
          kind: "steps",
          items: [
            "Tap a gem. Its neighbours that would make a match light up gold.",
            "Tap a lit-up neighbour to swap the two and score. If nothing lights up around a gem, swapping it there would not line anything up.",
            "A swap that makes no match does not happen and does not cost you a swap — only matching swaps count against your budget.",
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
      title: "The four objectives",
      toc: "Objectives",
      blocks: [
        {
          kind: "prose",
          text: "The buttons above the board pick what you are playing for. Target score is graded on points and stars; the other three are clear objectives, graded on how few swaps it takes, and you win the moment the board is clear.",
        },
        {
          kind: "steps",
          items: [
            "Target score — bank as many points as you can within your swap budget. Passing each score target earns a star (one, two, or three); reach at least one star to clear the board.",
            "Clear blockers — the board holds locked tiles you cannot swap; a match made next to a blocker chips it away. Clear them all.",
            "Clear jelly — some squares are coated with jelly; a match made on top of a jellied square scrubs it off. Scrub it all.",
            "Ingredients — a few objects drop in at the top; they cannot be swapped, but clearing the gems beneath one drops it, and it is collected when it reaches the bottom row. Bring them all down.",
          ],
        },
        {
          kind: "note",
          text: "The clear objectives use single-layer blockers and jelly and a few ingredients, so one match clears each, and the daily board is always solvable.",
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
          name: "match3-win",
          alt: "The result screen leading with the stars earned and a Verified badge, showing the record: result, score, stars, swaps used, seed, and final hash, with Re-verify / Share / Play again.",
          caption: "The result screen leads with your outcome, the verifiable record, and one-tap re-verify + share.",
        },
      ],
    },
  ],
};
