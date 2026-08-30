//! Mahjong's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! interaction (tap a free tile, tap its match) and the one rule that decides
//! everything (free = nothing on top, one long side open).

import type { Guide } from "../../how-to.js";

export const MAHJONG_GUIDE: Guide = {
  title: "How to play Mahjong",
  lede: "A stack of 144 tiles, dealt so it can always be cleared. Tap a free tile, then its match, to lift the pair off the board. Clear every tile to win. Every deal comes from a seed — today's board is the same for everyone — and a cleared board is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Tiles are stacked in layers. You remove them two at a time: a pair of identical faces (five of dots with five of dots, east wind with east wind). The only exceptions are the bonus tiles — any flower matches any flower, and any season matches any season. Clear the board and the deal is won.",
        },
        {
          kind: "shot",
          name: "mahjong-board",
          alt: "A small mahjong layout: ivory tiles with dots, bamboo and character faces in two layers, some raised and free at the edges, most blocked in the middle.",
          caption: "A Pond, the first layout. Free tiles sit at the ends of rows and on top of the stack; blocked ones are dimmed until something moves.",
        },
      ],
    },
    {
      testid: "howto-free",
      title: "Which tiles are free",
      toc: "Free tiles",
      blocks: [
        {
          kind: "prose",
          text: "A tile is free when nothing lies on top of it — not even half a tile — and at least one of its long sides, left or right, has no tile touching it on the same layer. A tile in the middle of a row is stuck until one of its neighbours goes; a tile under the stack is stuck until the stack above it is gone.",
        },
        {
          kind: "note",
          text: "The engine decides what is free. Tapping a blocked tile shakes it and changes nothing.",
        },
      ],
    },
    {
      testid: "howto-tap",
      title: "Tapping",
      toc: "Tapping",
      blocks: [
        {
          kind: "prose",
          text: "Tap is the only control, and it works the same with a mouse, a finger, or the keyboard (tiles are buttons — Tab to one and press Enter).",
        },
        {
          kind: "steps",
          items: [
            "Tap a free tile. It lifts, and every free tile that matches it glows.",
            "Tap a glowing tile. The pair leaves the board, and the tiles they were holding down or hemming in may become free.",
            "Tap the lifted tile again, or press Escape, to put it back.",
          ],
        },
      ],
    },
    {
      testid: "howto-help",
      title: "Undo, hint and shuffle",
      toc: "Help",
      blocks: [
        {
          kind: "prose",
          text: "Undo takes back the last pair (or the last shuffle). Hint lights up a pair — when the engine has found a full line from here to a clear, the hint says so; when it has not, it says that too, and offers the pair that frees the most tiles. Shuffle re-deals the tiles still on the board over their own places, so the new arrangement can be cleared. All three count as assistance, and a record you share says whether you used any.",
        },
        {
          kind: "note",
          text: "With hints switched off in Settings, the Hint button becomes I'm stuck, which ends the game and reports honestly whether a match was still available.",
        },
      ],
    },
    {
      testid: "howto-modes",
      title: "Levels, the daily, and sharing",
      toc: "Levels & daily",
      blocks: [
        {
          kind: "shot",
          name: "mahjong-home",
          alt: "The Mahjong poster: the splash art, the title, the pitch and a Play button, with the New game card offering Levels or the Daily.",
          caption: "Levels climb through five layouts — Pond, Bridge, Fortress, Steps, Turtle — and keep going. The daily is one Turtle per calendar day, the same for everyone.",
        },
        {
          kind: "prose",
          text: "Every deal is built so that it can be cleared — the engine lays the tiles down in a winning order and then hands you the board. When you clear one, the result screen re-verifies your solve by replaying every move against the engine, and the share link carries that self-checking record.",
        },
      ],
    },
  ],
};
