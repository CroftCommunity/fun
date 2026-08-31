//! Which game has a "How to play" guide. A new game adds its guide here; the
//! how-to page reads `?game=<id>` and looks it up.

import type { Guide } from "./how-to.js";
import { SOLITAIRE_GUIDE } from "./games/solitaire-howto.js";
import { TRIO_TUMBLE_GUIDE } from "./games/trio-tumble-howto.js";
import { BUBBLE_GUIDE } from "./games/bubble/bubble-howto.js";
import { WYRDLE_GUIDE } from "./games/wyrdle/wyrdle-howto.js";
import { TWENTY48_GUIDE } from "./games/2048/2048-howto.js";
import { DROP4_GUIDE } from "./games/drop4/drop4-howto.js";
import { OTHELLO_GUIDE } from "./games/othello/othello-howto.js";
import { CHECKERS_GUIDE } from "./games/checkers/checkers-howto.js";
import { DOTS_GUIDE } from "./games/dots/dots-howto.js";
import { FURROW_GUIDE } from "./games/furrow/furrow-howto.js";
import { ALIGN_GUIDE } from "./games/align/align-howto.js";
import { BLOCKDOKU_GUIDE } from "./games/blockdoku/blockdoku-howto.js";
import { LOOSEENDS_GUIDE } from "./games/looseends/looseends-howto.js";
import { MAHJONG_GUIDE } from "./games/mahjong/mahjong-howto.js";
import { COLOR_SORT_GUIDE } from "./games/color-sort/color-sort-howto.js";
import { ORCHARD_DROP_GUIDE } from "./games/orchard-drop/orchard-drop-howto.js";
import { CRIBBAGE_GUIDE } from "./games/cribbage/cribbage-howto.js";
import { CHESS_GUIDE } from "./games/chess/chess-howto.js";

export const GUIDES: Readonly<Record<string, Guide>> = {
  solitaire: SOLITAIRE_GUIDE,
  "trio-tumble": TRIO_TUMBLE_GUIDE,
  bubble: BUBBLE_GUIDE,
  wyrdle: WYRDLE_GUIDE,
  "2048": TWENTY48_GUIDE,
  drop4: DROP4_GUIDE,
  othello: OTHELLO_GUIDE,
  checkers: CHECKERS_GUIDE,
  dots: DOTS_GUIDE,
  furrow: FURROW_GUIDE,
  align: ALIGN_GUIDE,
  blockdoku: BLOCKDOKU_GUIDE,
  looseends: LOOSEENDS_GUIDE,
  mahjong: MAHJONG_GUIDE,
  "color-sort": COLOR_SORT_GUIDE,
  "orchard-drop": ORCHARD_DROP_GUIDE,
  cribbage: CRIBBAGE_GUIDE,
  chess: CHESS_GUIDE,
};

/** The guide for a game id, or undefined if none is written yet. */
export function findGuide(id: string | null): Guide | undefined {
  return id ? GUIDES[id] : undefined;
}
