//! The Furrow adapter onto the shared `GameOracle` port.
//!
//! Like dots', every member is a pass-through or a projection: a move is an
//! absolute pit index, which is already the wire code a `?r=` share carries, so
//! nothing needs encoding. Othello's adapter had to translate a pass sentinel and
//! invent a wire code for it; checkers' had to carry a packed
//! `(from, to, variant)` without narrowing it.
//!
//! What this game brings that the port has never seen is not in the move type
//! either. Three things could have reached the rig and do not:
//!
//! - **A move need not pass the turn.** Dots proved the runner reads `toMove`
//!   from the live board every iteration rather than from move parity. This is
//!   the first game to *inherit* that rather than establish it.
//! - **One move rewrites many cells.** The rig only ever sends a move code and
//!   re-reads the board, so a sow is no different to it than a single-cell move.
//! - **A terminal rule rewrites the score.** The sweep changes the stores after
//!   the last move, and the rig reads `result` rather than counting, so it never
//!   sees the difference.
//!
//! That is a property of the port's design, checked in
//! `tests/furrow-harness.test.ts` rather than assumed.
//!
//! Lives in the game's directory rather than in `src/harness/`, per the
//! game-isolation rule: the rig stays free of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import type { Furrow, Level } from "./furrow-wasm.js";

/**
 * Port level → this game's word for it. Unlike dots — where code 3 really is
 * perfect play, because 3×3 is solved outright — code 3 here is **Expert**: the
 * deepest search, not a proof. Phase 0 could not solve the opening at 100M nodes.
 */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Expert",
};

/** Wrap a loaded `Furrow` binding as a `GameOracle`. */
export function furrowOracle(game: Furrow): GameOracle {
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
          // This game's own reason, computed in Rust ("lands in your store — you
          // go again", "captures 5", "safe, but feeds them 3 seeds"). As with
          // dots, the engine already says it, so repeating it in TypeScript would
          // be a second place for it to drift.
          idea: m.idea,
        })),
        bestCol: t.bestCol,
        exact: t.exact,
      };
    },
  };
}
