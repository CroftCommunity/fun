//! The checkers adapter onto the shared `GameOracle` port.
//!
//! Othello's adapter had work to do: a pass is a string sentinel from `liveMove`,
//! a separate `pass()` method, and a wire code (`64`) that had to exist for the
//! port. Checkers' adapter has **none** of that — there is no pass in draughts (a
//! side with no legal move has lost, which the core reports as a result), so every
//! member here is a pass-through or a two-field projection.
//!
//! That is the interesting part, not a shortcut. Checkers is the first game whose
//! move is a **path** rather than a destination, and it needed *less* adaptation
//! than the game before it. What the port asks of a game — "your move is a compact
//! numeric wire code" — is satisfied by a packed `(from, to, variant)` exactly as
//! it is by a column, and nothing else about the move space reaches the rig.
//!
//! The one thing to be careful about is width: these codes exceed a `u8`, so any
//! layer that narrowed one would turn a legal move into a rejected `play` and
//! abort the match. Nothing here narrows, and `tests/checkers-harness.test.ts`
//! asserts that at the port rather than trusting the chain of types.
//!
//! Lives in the game's directory rather than in `src/harness/`, per the
//! game-isolation rule: the rig stays free of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import type { Checkers, Level } from "./checkers-wasm.js";

/**
 * Port level → checkers' word for it. Code 3 is *this game's* strongest play,
 * which is `"Expert"` — the deepest search, not the perfect play Drop 4's
 * `"Perfect"` denotes. Checkers is not solved from the opening.
 */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Expert",
};

/** Wrap a loaded `Checkers` binding as a `GameOracle`. */
export function checkersOracle(game: Checkers): GameOracle {
  return {
    newGame: (seed) => game.newGame(seed),
    board: () => {
      const b = game.board();
      return { toMove: b.toMove, result: b.result };
    },
    // The packed move codes only — the chain detail the UI needs to step a player
    // through a jump is not something the rig has any use for.
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
