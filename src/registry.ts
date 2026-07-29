//! The game catalog the drawer lists. Solitaire is playable (front-plan Phase 4);
//! match-3 is `soon` until its module lands (front-plan Phase 7); the placeholder
//! is playable to exercise the chrome.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";
import { solitaireModule } from "./games/solitaire.js";

export const REGISTRY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    icon: "🎲",
    status: "playable",
    load: placeholderModule,
  },
  { id: "solitaire", title: "Solitaire", icon: "♠", status: "playable", load: solitaireModule },
  { id: "match3", title: "Match-3", icon: "🍬", status: "soon" },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
