//! The Othello adapter onto the shared `GameOracle` port.
//!
//! Othello is the port's real test: it is the first game whose wrapper does not
//! already fit. Two things need normalizing, and both are about the **pass**,
//! which Drop 4 has no concept of.
//!
//! 1. **`liveMove` returns the string `"pass"`.** The port returns a numeric move
//!    code or `null`, and `null` means *the match is over*. Mapping `"pass"` to
//!    `null` is the obvious shortcut and it is wrong: `match-runner` treats a
//!    `null` from a live position as an **abort**, so a passing match would
//!    silently record `aborted: true`, grade nothing, and still produce a
//!    well-formed Report. It maps to {@link PASS_CODE} instead.
//! 2. **Passing is a separate method.** `play(idx)` places; `pass()` passes. The
//!    port has one `play`, so `play(PASS_CODE)` routes to `pass()`.
//!
//! Neither is an invention for the harness's benefit — `othello-outcome.ts`
//! already encodes a pass as `64` on the wire so that a `?r=` share replays
//! passes, and its `verifyRecord` already routes `code === PASS_CODE` to
//! `pass()`. This adapter reuses that constant and that convention, so the code a
//! move has in a share is the code the harness grades.
//!
//! Lives in the game's directory rather than in `src/harness/`, per the
//! game-isolation rule: the rig stays free of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import { PASS_CODE } from "./othello-outcome.js";
import type { Level, Othello } from "./othello-wasm.js";

/**
 * Port level → Othello's word for it. Code 3 is *this game's* strongest play,
 * which is `"Expert"` — a deep search, not the perfect play Drop 4's `"Perfect"`
 * denotes. The port's scale deliberately does not claim they are equivalent.
 */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Expert",
};

/** Wrap a loaded `Othello` binding as a `GameOracle`. */
export function othelloOracle(game: Othello): GameOracle {
  return {
    newGame: (seed) => game.newGame(seed),
    board: () => {
      const b = game.board();
      return { toMove: b.toMove, result: b.result };
    },
    // Placements only. A forced-pass position yields `[]`, which is correct: there
    // is no placement. The pass itself is reached via `liveMove`/`play`.
    legalMoves: () => game.legalMoves(),
    play: (code) => (code === PASS_CODE ? game.pass() : game.play(code)),
    currentHash: () => game.currentHash(),
    renderText: () => game.renderText(),
    liveMove: (level) => {
      const move = game.liveMove(LEVELS[level]);
      if (move === "pass") return PASS_CODE;
      return move;
    },
    assess: (code) => {
      // A pass is not a candidate placement — it is the only legal continuation
      // when it happens, so there is nothing to grade and no quality to report.
      if (code === PASS_CODE) return null;
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
          // Othello's one-ply fact, carried so the harness's hybrid narrates it
          // too. The shared `ideaFor` knows only the two Drop-4 booleans, and
          // this adapter is the one place that knows both this game's facts and
          // the shared shape.
          idea: m.takesCorner ? "takes a corner" : undefined,
        })),
        bestCol: t.bestCol,
        exact: t.exact,
      };
    },
  };
}
