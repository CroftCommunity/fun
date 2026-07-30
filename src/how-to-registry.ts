//! Which game has a "How to play" guide. A new game adds its guide here; the
//! how-to page reads `?game=<id>` and looks it up.

import type { Guide } from "./how-to.js";
import { SOLITAIRE_GUIDE } from "./games/solitaire-howto.js";
import { MATCH3_GUIDE } from "./games/match3-howto.js";
import { BUBBLE_GUIDE } from "./games/bubble/bubble-howto.js";

export const GUIDES: Readonly<Record<string, Guide>> = {
  solitaire: SOLITAIRE_GUIDE,
  match3: MATCH3_GUIDE,
  bubble: BUBBLE_GUIDE,
};

/** The guide for a game id, or undefined if none is written yet. */
export function findGuide(id: string | null): Guide | undefined {
  return id ? GUIDES[id] : undefined;
}
