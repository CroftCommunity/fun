//! The game catalog the drawer lists. Solitaire is playable (front-plan Phase 4);
//! match-3 is `soon` until its module lands (front-plan Phase 7); the placeholder
//! is playable to exercise the chrome.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";
import { solitaireModule } from "./games/solitaire.js";
import { match3Module } from "./games/match3.js";
import { bubbleModule } from "./games/bubble/bubble.js";
import { wyrdleModule } from "./games/wyrdle/wyrdle.js";
import { twenty48Module } from "./games/2048/2048.js";
import { alignModule } from "./games/align/align.js";
import { blockdokuModule } from "./games/blockdoku/blockdoku.js";
import { colorSortModule } from "./games/color-sort/color-sort.js";
import { astrayModule } from "./games/astray/astray.js";
import { hexglModule } from "./games/hexgl/hexgl.js";
import { clumsybirdModule } from "./games/clumsybird/clumsybird.js";
import { puzzlesModule } from "./games/puzzles/puzzles.js";

export const REGISTRY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    icon: "🎲",
    status: "playable",
    load: placeholderModule,
  },
  { id: "solitaire", title: "Solitaire", icon: "♠", status: "playable", load: solitaireModule },
  { id: "match3", title: "Match-3", icon: "🍬", status: "playable", load: match3Module },
  { id: "bubble", title: "Bubble", icon: "🫧", status: "playable", load: bubbleModule },
  { id: "wyrdle", title: "Wyrdle", icon: "🐉", status: "playable", load: wyrdleModule },
  { id: "2048", title: "2048", icon: "🔢", status: "playable", load: twenty48Module },
  { id: "align", title: "Align", icon: "🟪", status: "playable", load: alignModule },
  { id: "blockdoku", title: "Blockdoku", icon: "🟦", status: "playable", load: blockdokuModule },
  { id: "color-sort", title: "Color Sort", icon: "🧪", status: "playable", load: colorSortModule },
  {
    id: "astray",
    title: "Astray",
    icon: "🔮",
    status: "playable",
    tier: 2,
    attribution: {
      author: "wwwtyro",
      license: "The Unlicense",
      upstreamUrl: "https://github.com/wwwtyro/Astray",
    },
    load: astrayModule,
  },
  {
    id: "hexgl",
    title: "HexGL",
    icon: "🏎",
    status: "playable",
    tier: 2,
    attribution: {
      author: "Thibaut Despoulain (BKcore)",
      license: "MIT",
      upstreamUrl: "https://github.com/BKcore/HexGL",
    },
    load: hexglModule,
  },
  {
    id: "clumsybird",
    title: "Clumsy Bird",
    icon: "🐤",
    status: "playable",
    tier: 2,
    attribution: {
      author: "ellisonleao",
      license: "GPL-3.0",
      upstreamUrl: "https://github.com/ellisonleao/clumsy-bird",
      basedOn: "Flappy Bird by Dong Nguyen",
    },
    load: clumsybirdModule,
  },
  {
    id: "puzzles",
    title: "Puzzles",
    icon: "🧩",
    status: "playable",
    tier: 2,
    attribution: {
      author: "Simon Tatham",
      license: "MIT",
      upstreamUrl: "https://www.chiark.greenend.org.uk/~sgtatham/puzzles/",
    },
    load: puzzlesModule,
  },
  { id: "cribbage", title: "Cribbage", icon: "🎴", status: "soon" },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
