//! Which game has a "How to play" guide. A new game adds its guide here; the
//! how-to page reads `?game=<id>` and looks it up.

import type { Guide } from "./how-to.js";
import { SOLITAIRE_GUIDE } from "./games/solitaire-howto.js";
import { MATCH3_GUIDE } from "./games/match3-howto.js";
import { BUBBLE_GUIDE } from "./games/bubble/bubble-howto.js";
import { WYRDLE_GUIDE } from "./games/wyrdle/wyrdle-howto.js";
import { TWENTY48_GUIDE } from "./games/2048/2048-howto.js";
import { ASTRAY_GUIDE } from "./games/astray/astray-howto.js";

export const GUIDES: Readonly<Record<string, Guide>> = {
  solitaire: SOLITAIRE_GUIDE,
  match3: MATCH3_GUIDE,
  bubble: BUBBLE_GUIDE,
  wyrdle: WYRDLE_GUIDE,
  "2048": TWENTY48_GUIDE,
  astray: ASTRAY_GUIDE,
};

/** The guide for a game id, or undefined if none is written yet. */
export function findGuide(id: string | null): Guide | undefined {
  return id ? GUIDES[id] : undefined;
}
