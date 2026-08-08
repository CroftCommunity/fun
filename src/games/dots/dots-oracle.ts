//! The Dots and Boxes adapter onto the shared `GameOracle` port.
//!
//! The thinnest adapter on the shelf, and that is the finding rather than a
//! shortcut. Othello's had to translate a pass sentinel and invent a wire code
//! for it; checkers' had to carry a packed `(from, to, variant)` without
//! narrowing it. Here a move is an edge index `0..23` — already the wire code a
//! `?r=` share carries — so every member is a pass-through or a projection.
//!
//! What this game brings that the port has never seen is not in the move type at
//! all: **a move need not pass the turn**, and **the value is a box margin**. The
//! rig reads `toMove` from the live board on every iteration and grades on
//! `quality` rather than on a value, so neither reaches it. That is a property of
//! the port's design, checked here rather than assumed
//! (`tests/dots-harness.test.ts`).
//!
//! Lives in the game's directory rather than in `src/harness/`, per the
//! game-isolation rule: the rig stays free of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import type { Dots, Level } from "./dots-wasm.js";

/**
 * Port level → this game's word for it. Unlike Othello and checkers, code 3 here
 * really is **perfect play**: 3x3 is small enough to solve outright, so the top
 * level is not merely the deepest search.
 */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Perfect",
};

/** Wrap a loaded `Dots` binding as a `GameOracle`. */
export function dotsOracle(game: Dots): GameOracle {
  return {
    newGame: (seed) => game.newGame(seed),
    board: () => {
      const b = game.board();
      return { toMove: b.toMove, result: b.result };
    },
    legalMoves: () => game.legalMoves(),
    play: (code) => game.play(code),
    currentHash: () => game.currentHash(),
    renderText: () => game.renderText(),
    liveMove: (level) => game.liveMove(LEVELS[level]),
    assess: (code) => {
      const a = game.assess(code);
      return a === null
        ? null
        : {
            quality: a.quality,
            exact: a.exact,
            immediateWin: a.immediateWin,
            blocksOpponentWin: a.blocksOpponentWin,
          };
    },
    tutor: () => {
      const t = game.tutor();
      return {
        moves: t.moves.map((m) => ({
          col: m.col,
          value: m.value,
          quality: m.quality,
          immediateWin: m.immediateWin,
          blocksOpponentWin: m.blocksOpponentWin,
          // This game's own reason, computed in Rust ("closes a box, and you move
          // again", "hands over one box", "safe: leaves no box on three sides").
          // Every other game phrases its idea in the adapter; here the engine
          // already says it, so repeating it in TypeScript would be a second
          // place for it to drift.
          idea: m.idea,
        })),
        bestCol: t.bestCol,
        exact: t.exact,
      };
    },
  };
}
