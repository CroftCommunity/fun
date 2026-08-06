//! P8 Phase 1 — `GameOracle`, the game-agnostic port the scoring rig drives.
//!
//! The rig (`match-runner` / `scorer` / `tournament`) used to import `Drop4` by
//! type and call `Drop4`-shaped methods, so it could grade exactly one game.
//! Everything it actually needs is the ten members below, all of which Drop 4 and
//! Othello already expose — verified method by method rather than assumed
//! (P8 plan, Phase 0 D1):
//!
//! | called by the rig | Drop 4 | Othello | verdict |
//! |---|---|---|---|
//! | `newGame(seed)`   | ✓ | ✓ | identical |
//! | `board()`         | ✓ | ✓ | identical (the rig reads only `toMove` + `result`) |
//! | `play(code)`      | ✓ | ✓ | **differs** — Othello's adapter routes `play(64)` → `pass()` |
//! | `pass()`          | ✗ | ✓ | **Othello-only** — absorbed into `play`, deliberately not on the port |
//! | `currentHash()`   | ✓ | ✓ | identical |
//! | `legalMoves()`    | ✓ | ✓ | identical (Othello yields `[]` in a forced-pass position) |
//! | `liveMove(level)` | `number \| null` | `number \| "pass" \| null` | **differs twice** — see the level contract below |
//! | `assess(code)`    | ✓ | ✓ superset | identical for the rig's needs |
//! | `tutor()`         | ✓ | ✓ | identical |
//! | `renderText()`    | ✓ | ✓ | identical |
//!
//! `oracleBest`, `oracleMoveValues`, `markAssistance` and `outcome` exist on both
//! wrappers and the rig never calls them, so they stay off the port. Keeping this
//! surface to ten members is what makes each new game's adapter cheap.
//!
//! ## Two contracts every adapter is held to
//!
//! **A move is the game's compact numeric wire code.** Drop 4: a column. Othello:
//! `0..63` to place, `64` to pass. Checkers: a packed `(from, to, variant)`. This
//! is not a simplification for the rig's benefit — it is already true of every
//! shelf game, because it is what lets a `?r=` share be a plain JSON number array.
//! Typing the port over `number` rather than a generic move parameter follows from
//! that, and keeps the type noise out of every signature.
//!
//! **A level is `0..3`, not a string.** The games' own `Level` unions disagree on
//! the top member — Drop 4 `"Easy" | "Medium" | "Hard" | "Perfect"`, Othello
//! `… | "Expert"` — so no shared string union exists to type this with. The port
//! owns the numeric scale; each adapter owns its game's word for it. Code `3`
//! therefore means *that game's strongest level*, which is genuinely perfect play
//! in Drop 4 and merely the deepest search in Othello. Anything reporting on
//! levels should say "top level", not "Perfect".

/** Side to move: 1 = A (opens), 2 = B. */
export type SideCode = 1 | 2;

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";

/** Difficulty as the port speaks it: `0..3`, Easy → the game's top level. */
export type OracleLevel = 0 | 1 | 2 | 3;

/** The only two board facts the rig reads. */
export interface OracleBoard {
  readonly toMove: SideCode;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  readonly result: -1 | 0 | 1 | 2;
}

/**
 * Engine-grounded assessment of one candidate move. `exact` is the honesty gate:
 * the scorer grades a move **iff** `exact` is true, and counts it `skippedEarly`
 * otherwise, so a quality number is never reported from a horizon guess.
 */
export interface OracleAssessment {
  readonly quality: MoveQuality;
  readonly exact: boolean;
  /** One-ply facts; games without the notion carry them as `false`. */
  readonly immediateWin: boolean;
  readonly blocksOpponentWin: boolean;
}

/** One move in a tutor report — a structural superset of `TutorFactMove`. */
export interface OracleTutorMove {
  /** The move's numeric wire code. Named `col` for the Drop-4-era field it feeds. */
  readonly col: number;
  readonly value: number;
  readonly quality: MoveQuality;
  readonly immediateWin: boolean;
  readonly blocksOpponentWin: boolean;
  /**
   * The game's own one-line reason, if it has one worth more than the generic
   * fallback (see `TutorFactMove.idea`). Optional, and supplied by the adapter —
   * it is the one place that knows both the game's facts and the shared shape.
   */
  readonly idea?: string;
}

/** The current position's whole-position tutor report. */
export interface OracleTutorReport {
  readonly moves: readonly OracleTutorMove[];
  readonly bestCol: number | null;
  readonly exact: boolean;
}

/**
 * The port. A game ships a thin adapter in its own directory
 * (`src/games/<game>/<game>-oracle.ts`) so the coupling lives with the game, per
 * the game-isolation rule — the rig itself never names a game.
 */
export interface GameOracle {
  newGame(seed: bigint): void;
  board(): OracleBoard;
  legalMoves(): number[];
  play(code: number): MoveStatus;
  currentHash(): string;
  renderText(): string;
  /** The shipped opponent's move at `level`, or `null` if the match is over. */
  liveMove(level: OracleLevel): number | null;
  /** `null` if there is no game, or `code` is not legal here. */
  assess(code: number): OracleAssessment | null;
  tutor(): OracleTutorReport;
}
