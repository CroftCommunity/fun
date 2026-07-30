//! The game catalog the drawer lists. Solitaire is playable (front-plan Phase 4);
//! match-3 is `soon` until its module lands (front-plan Phase 7); the placeholder
//! is playable to exercise the chrome.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";
import { solitaireModule } from "./games/solitaire.js";
import { match3Module } from "./games/match3.js";
import { bubbleModule } from "./games/bubble/bubble.js";

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
  { id: "cribbage", title: "Cribbage", icon: "🎴", status: "soon" },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
