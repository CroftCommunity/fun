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
import { drop4Module } from "./games/drop4/drop4.js";
import { othelloModule } from "./games/othello/othello.js";
import { checkersModule } from "./games/checkers/checkers.js";
import { dotsModule } from "./games/dots/dots.js";
import { furrowModule } from "./games/furrow/furrow.js";
import { alignModule } from "./games/align/align.js";
import { blockdokuModule } from "./games/blockdoku/blockdoku.js";
import { looseendsModule } from "./games/looseends/looseends.js";
import { colorSortModule } from "./games/color-sort/color-sort.js";
import { orchardDropModule } from "./games/orchard-drop/orchard-drop.js";

export const REGISTRY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    emoji: "🎲",
    status: "playable",
    load: placeholderModule,
  },
  { id: "solitaire", title: "Solitaire", emoji: "♠", status: "playable", icon: true, load: solitaireModule },
  { id: "match3", title: "Match-3", emoji: "🍬", status: "playable", icon: true, load: match3Module },
  { id: "bubble", title: "Bubble", emoji: "🫧", status: "playable", icon: true, load: bubbleModule },
  { id: "wyrdle", title: "Wyrdle", emoji: "🐉", status: "playable", icon: true, load: wyrdleModule },
  { id: "2048", title: "2048", emoji: "🔢", status: "playable", icon: true, load: twenty48Module },
  { id: "drop4", title: "Drop 4", emoji: "🔴", status: "playable", icon: true, group: "versus", load: drop4Module },
  { id: "othello", title: "Othello", emoji: "⚫", status: "playable", icon: true, group: "versus", load: othelloModule },
  { id: "checkers", title: "Checkers", emoji: "⛃", status: "playable", icon: true, group: "versus", load: checkersModule },
  { id: "dots", title: "Dots and Boxes", emoji: "▦", status: "playable", icon: true, group: "versus", load: dotsModule },
  { id: "furrow", title: "Furrow", emoji: "🌾", status: "playable", icon: true, group: "versus", load: furrowModule },
  { id: "align", title: "Align", emoji: "🟪", status: "playable", icon: true, load: alignModule },
  { id: "blockdoku", title: "Blockdoku", emoji: "🟦", status: "playable", icon: true, load: blockdokuModule },
  { id: "looseends", title: "Loose Ends", emoji: "🎯", status: "playable", icon: true, load: looseendsModule },
  { id: "color-sort", title: "Color Sort", emoji: "🧪", status: "playable", icon: true, load: colorSortModule },
  {
    id: "orchard-drop",
    title: "Orchard Drop",
    emoji: "🍉",
    status: "playable",
    icon: true,
    tier: 2,
    attribution: {
      author: "the Croft shelf, with physics by @liabru's Matter.js",
      license: "AGPL-3.0 (game) · MIT (Matter.js)",
      upstreamUrl: "https://github.com/CroftCommunity/fun",
      basedOn: "Suika Game (Watermelon Game)",
    },
    load: orchardDropModule,
  },
  { id: "cribbage", title: "Cribbage", emoji: "🎴", status: "soon" },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
