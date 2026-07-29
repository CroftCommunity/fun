//! The game catalog the drawer lists. Solitaire and match-3 are `soon` until
//! their front-end modules land (front-plan Phase 4 / Phase 7); the placeholder
//! is playable now to exercise the chrome.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";

export const REGISTRY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    icon: "🎲",
    status: "playable",
    load: placeholderModule,
  },
  { id: "solitaire", title: "Solitaire", icon: "♠", status: "soon" },
  { id: "match3", title: "Match-3", icon: "🍬", status: "soon" },
];

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
