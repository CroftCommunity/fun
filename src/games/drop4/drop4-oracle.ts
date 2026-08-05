//! The Drop 4 adapter onto the shared `GameOracle` port.
//!
//! Near-identity — Drop 4 is the game the rig grew up around — with one real
//! translation: the port's numeric `0..3` level maps to Drop 4's own `Level`
//! union, whose top member is `"Perfect"`. (Othello's is `"Expert"`, which is why
//! the port cannot type levels as a shared string union; see `game-oracle.ts`.)
//!
//! This lives in the game's directory rather than in `src/harness/` so the
//! coupling belongs to the game, per the game-isolation rule — the rig stays free
//! of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import type { Drop4, Level } from "./drop4-wasm.js";

/** Port level → Drop 4's word for it. Code 3 is *this game's* strongest play. */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Perfect",
};

/** Wrap a loaded `Drop4` binding as a `GameOracle`. */
export function drop4Oracle(game: Drop4): GameOracle {
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
        })),
        bestCol: t.bestCol,
        exact: t.exact,
      };
    },
  };
}
