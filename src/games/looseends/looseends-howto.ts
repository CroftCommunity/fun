//! Loose Ends' "How to play" guide (pure data — see src/how-to.ts). Leads with
//! the interaction (tap a free arrow) and the one rule that decides everything
//! (its exit ray must be clear).

import type { Guide } from "../../how-to.js";

export const LOOSEENDS_GUIDE: Guide = {
  title: "How to play Loose Ends",
  lede: "The board is a tangle of arrows. Tap one to slip it off the board — but only if the lane in front of its head is clear. Untangle every arrow to win. Boards come from a seed, so today's daily and any level are the same for everyone, and a solved board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Every arrow is a little snake with a head. An arrow is free when the straight line from its head to the edge of the board has no other arrow in the way. Tap a free arrow and it slides forward along its own path and off the board. Clear them all and the level is solved.",
        },
        {
          kind: "shot",
          name: "looseends-board",
          alt: "A grid of pale interlocking arrows on a deep slate board, some pointing at the edges and some blocked by their neighbours.",
          caption: "The board. Arrows whose lane to the edge is clear can leave; the rest are stuck until you clear a path.",
        },
      ],
    },
    {
      testid: "howto-tap",
      title: "Tapping arrows",
      toc: "Tapping",
      blocks: [
        {
          kind: "prose",
          text: "Tap is the only control, and it works the same with a mouse or a finger.",
        },
        {
          kind: "steps",
          items: [
            "Tap an arrow whose head points at open space all the way to the edge — it slides off.",
            "Tap a blocked arrow and it flashes red and shakes; nothing moves and you lose a droplet.",
            "Releasing one arrow frees the lane behind it, so the order you tap in is the whole puzzle.",
          ],
        },
        {
          kind: "note",
          text: "The engine decides what's free — a blocked tap can never move an arrow, it only costs you a droplet.",
        },
      ],
    },
    {
      testid: "howto-droplets",
      title: "Droplets and hints",
      toc: "Droplets & hints",
      blocks: [
        {
          kind: "prose",
          text: "You start each board with three droplets. Every blocked tap spends one; run out and the board fails, but you can retry it fresh — same board, droplets reset. Stuck? The bulb hints one arrow that's safe to tap right now. Hints are unlimited, but a flawless solve (three stars) uses no hints and makes no mistakes.",
        },
      ],
    },
    {
      testid: "howto-zoom",
      title: "Big boards: zoom and pan",
      toc: "Zoom & pan",
      blocks: [
        {
          kind: "prose",
          text: "Later levels get large. Pinch or use the mouse wheel to zoom, and drag to pan around. A drag never counts as a tap, so you can move around the board freely and only release an arrow when you mean to.",
        },
      ],
    },
    {
      testid: "howto-campaign-daily",
      title: "Campaign, daily, and sharing",
      toc: "Campaign & daily",
      blocks: [
        {
          kind: "shot",
          name: "looseends-home",
          alt: "The Loose Ends poster: the splash art, the title, the pitch and a Play button, with the New game card offering the next level, the level grid or the daily puzzle.",
          caption: "Play jumps to your first unsolved level; the daily calendar has one board per day, and your streak grows as you keep solving.",
        },
        {
          kind: "prose",
          text: "The campaign is 100 levels that ramp from Easy to Expert; solved levels keep their best star rating and stay replayable. The daily puzzle is one board per calendar day — the same for everyone — and solving each day builds a streak. When you finish a board, the win screen re-verifies your solve by replaying every release against the engine, and the share link carries that self-checking record.",
        },
      ],
    },
  ],
};
