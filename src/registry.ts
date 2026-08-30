//! The game catalog the drawer lists. Every entry with a `load` is playable;
//! `soon` entries have no module yet. The placeholder is playable to exercise
//! the chrome.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";
import { solitaireModule, solitaireSetup } from "./games/solitaire.js";
import { trioTumbleModule } from "./games/trio-tumble.js";
import { bubbleModule } from "./games/bubble/bubble.js";
import { wyrdleModule } from "./games/wyrdle/wyrdle.js";
import { twenty48Module } from "./games/2048/2048.js";
import { drop4Module } from "./games/drop4/drop4.js";
import { othelloModule, othelloSetup } from "./games/othello/othello.js";
import { checkersModule } from "./games/checkers/checkers.js";
import { dotsModule } from "./games/dots/dots.js";
import { furrowModule } from "./games/furrow/furrow.js";
import { alignModule } from "./games/align/align.js";
import { blockdokuModule } from "./games/blockdoku/blockdoku.js";
import { looseendsModule } from "./games/looseends/looseends.js";
import { colorSortModule } from "./games/color-sort/color-sort.js";
import { orchardDropModule } from "./games/orchard-drop/orchard-drop.js";
import { cribbageModule } from "./games/cribbage/cribbage.js";

export const REGISTRY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    emoji: "🎲",
    status: "playable",
    icon: true,
    pitch: "Nothing to play; everything to prove.",
    load: placeholderModule,
  },
  {
    id: "solitaire",
    title: "Solitaire",
    emoji: "♠",
    status: "playable",
    icon: true,
    pitch: "Klondike, draw one. Today’s deal is winnable, and everyone gets the same one.",
    setup: solitaireSetup,
    load: solitaireModule,
  },
  { id: "trio-tumble", title: "Trio Tumble", subtitle: "Jewel Drop", emoji: "💎", status: "playable", icon: true, load: trioTumbleModule },
  { id: "bubble", title: "Bubble", emoji: "🫧", status: "playable", icon: true, load: bubbleModule },
  { id: "wyrdle", title: "Wyrdle", emoji: "🐉", status: "playable", icon: true, load: wyrdleModule },
  { id: "2048", title: "2048", emoji: "🔢", status: "playable", icon: true, load: twenty48Module },
  { id: "drop4", title: "Drop 4", emoji: "🔴", status: "playable", icon: true, group: "versus", load: drop4Module },
  {
    id: "othello",
    title: "Othello",
    emoji: "⚫",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Flank a line of discs to flip it. Most discs when neither side can move wins.",
    setup: othelloSetup,
    load: othelloModule,
  },
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
    // Tier-1 as of the rebuild: a deterministic fixed-point core, a verifiable
    // record, a re-checkable `?r=` share. No `tier` key — Tier-1 is the default
    // — and no `attribution`, which `Tier1GameEntry` does not have a field for.
    // The Suika-lineage credit lives in the how-to guide instead.
    load: orchardDropModule,
  },
  { id: "cribbage", title: "Cribbage", emoji: "🎴", status: "playable", icon: true, group: "versus", load: cribbageModule },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
