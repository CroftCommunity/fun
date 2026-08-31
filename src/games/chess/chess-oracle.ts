//! The chess adapter onto the shared `GameOracle` port — a pure pass-through,
//! like checkers', over the widest move code the rig has graded: a 15-bit
//! `from | to<<6 | promo<<12` (max 20479). Nothing here narrows, and
//! `tests/chess-harness.test.ts` asserts that at the port rather than trusting
//! the chain of types.
//!
//! Chess has no pass, so there is no sentinel to translate; the one piece of
//! work is the projection from `MoveAssessment` (which carries SAN, regret and
//! the one-ply facts the page narrates) down to the port's four fields. The
//! one-ply *idea* — "takes the knight", "gives check", "mate in 2" — is phrased
//! here, and the page imports it from here, so the tutor panel and the rig say
//! the same thing by construction (the plan's "ideaFor set in both").
//!
//! Lives in the game's directory rather than in `src/harness/`, per the
//! game-isolation rule: the rig stays free of any game's names.

import type { GameOracle, OracleLevel } from "../../harness/game-oracle.js";
import type { Chess, Level, MoveAssessment } from "./chess-wasm.js";

/** The magnitude a proven mate scores above — `chess_solver::MATE`. */
const MATE = 1_000_000;

/** Piece names by kind code (`1..6`), the core's numbering. */
export const KIND_NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"] as const;

/**
 * Port level → chess's word for it. Code 3 is *this game's* strongest play,
 * `"Expert"` — the deepest budgeted search, not perfect play. Chess is not
 * solved from the opening, and the tutor's `exact` says so per move.
 */
const LEVELS: Record<OracleLevel, Level> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Expert",
};

/**
 * A short, engine-grounded idea for why a move is reasonable (tutor copy).
 * `depth` is the report's reached depth: a proven mate's value is
 * `MATE + remaining depth`, so the plies to mate are `depth - (value - MATE)`.
 * "Mate in N" is said **only** when the fact is exact.
 */
export const ideaFor = (m: MoveAssessment, depth: number): string => {
  if (m.immediateWin) return "mate in 1";
  if (m.exact && m.value > MATE / 2) {
    const plies = depth - (m.value - MATE);
    const n = Math.ceil(plies / 2);
    return n >= 1 ? `mate in ${n}` : "forces mate";
  }
  if (m.captures > 0) return `takes the ${KIND_NAMES[m.captures] ?? "piece"}`;
  if (m.promotes > 0) return "promotes";
  if (m.castles) return "castles";
  if (m.givesCheck) return "gives check";
  return m.quality === "optimal" ? "your strongest line" : "stays safe";
};

/** Wrap a loaded `Chess` binding as a `GameOracle`. */
export function chessOracle(game: Chess): GameOracle {
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
          idea: ideaFor(m, t.depth),
        })),
        bestCol: t.bestCol,
        exact: t.exact,
      };
    },
  };
}
