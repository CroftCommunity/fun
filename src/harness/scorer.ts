//! P6 Phase 2 — the pure scorer. The measurement vocabulary mirrors the Rust
//! `drop4-harness` (`Scorecard` / `blunder_rate` / `score_side`) so the browser
//! rig's numbers are comparable to the Rust rig's.
//!
//! The honesty gate: a move is graded **iff the wasm says its assessment is
//! `exact`** — i.e. the position is in the tractable endgame (≤ TRACTABLE_EMPTIES
//! = 16, a strict superset of the Rust rig's ≤12; both provably exact). Every
//! other move is counted `skippedEarly`, never silently blended into the quality
//! numbers. `foldVerdict` is a pure fold; `gradeSide` replays a `MatchRecord`
//! through a fresh oracle and folds its verdict at each of a side's
//! moves.

import type { GameOracle, MoveQuality, SideCode } from "./game-oracle.js";
import type { MatchRecord } from "./match-runner.js";

/** A player's aggregate result over a set of games (mirrors the Rust `Scorecard`). */
export interface Scorecard {
  /** Games played. */
  games: number;
  /** Games this side won / drew / lost. */
  wins: number;
  draws: number;
  losses: number;
  /** Moves graded by the oracle (positions the wasm reported `exact`). */
  scoredMoves: number;
  /** Graded moves that were optimal. */
  optimal: number;
  /** Graded moves that preserved the result class but weren't optimal. */
  preserving: number;
  /** Graded moves that dropped the result class. */
  blunders: number;
  /** Moves skipped because the position was too early to solve exactly. */
  skippedEarly: number;
  /** Total wall time (ms) spent choosing this side's moves — the cost metric. */
  moveMsTotal: number;
}

/** A zeroed scorecard. */
export function emptyScorecard(): Scorecard {
  return {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    scoredMoves: 0,
    optimal: 0,
    preserving: 0,
    blunders: 0,
    skippedEarly: 0,
    moveMsTotal: 0,
  };
}

/** The blunder rate over graded moves (0.0 if none were graded). */
export function blunderRate(c: Scorecard): number {
  return c.scoredMoves === 0 ? 0 : c.blunders / c.scoredMoves;
}

/** One oracle verdict for a move: its quality and whether it is provably exact. */
export interface MoveVerdict {
  readonly quality: MoveQuality;
  readonly exact: boolean;
}

/**
 * Fold one move's verdict into a scorecard, returning a **new** card (pure). A
 * non-exact verdict is counted `skippedEarly` and never graded — the honesty
 * gate. An exact verdict routes to its quality bucket and increments
 * `scoredMoves`.
 */
export function foldVerdict(c: Scorecard, v: MoveVerdict): Scorecard {
  if (!v.exact) return { ...c, skippedEarly: c.skippedEarly + 1 };
  const scored = { ...c, scoredMoves: c.scoredMoves + 1 };
  if (v.quality === "optimal") return { ...scored, optimal: scored.optimal + 1 };
  if (v.quality === "resultPreserving") return { ...scored, preserving: scored.preserving + 1 };
  return { ...scored, blunders: scored.blunders + 1 };
}

/** Fold a single record's win/draw/loss into `card` from `side`'s perspective. */
function foldResult(card: Scorecard, result: MatchRecord["result"], side: SideCode): Scorecard {
  if (result === 0) return { ...card, draws: card.draws + 1 };
  const won = (result === 1 && side === 1) || (result === 2 && side === 2);
  return won ? { ...card, wins: card.wins + 1 } : { ...card, losses: card.losses + 1 };
}

/**
 * Grade every move `side` made in `record`, replaying `(seed, moves)` through the
 * fresh `verifier` binding and folding the wasm oracle's verdict at each of
 * `side`'s pre-move positions. Returns a one-game `Scorecard` (`games: 1`).
 * Aborted records (no terminal result) contribute no win/draw/loss.
 */
export function gradeSide(record: MatchRecord, verifier: GameOracle, side: SideCode): Scorecard {
  let card: Scorecard = { ...emptyScorecard(), games: 1 };
  if (!record.aborted && record.result !== -1) {
    card = foldResult(card, record.result, side);
  }
  verifier.newGame(record.seed);
  record.moves.forEach((col, i) => {
    const board = verifier.board();
    if (board.result === -1 && board.toMove === side) {
      const a = verifier.assess(col);
      if (a) {
        card = foldVerdict(card, { quality: a.quality, exact: a.exact });
        card = { ...card, moveMsTotal: card.moveMsTotal + (record.timings[i] ?? 0) };
      }
    }
    verifier.play(col);
  });
  return card;
}

/** Sum a set of one-game scorecards into an aggregate (used by the tournament). */
export function sumScorecards(cards: readonly Scorecard[]): Scorecard {
  return cards.reduce<Scorecard>(
    (acc, c) => ({
      games: acc.games + c.games,
      wins: acc.wins + c.wins,
      draws: acc.draws + c.draws,
      losses: acc.losses + c.losses,
      scoredMoves: acc.scoredMoves + c.scoredMoves,
      optimal: acc.optimal + c.optimal,
      preserving: acc.preserving + c.preserving,
      blunders: acc.blunders + c.blunders,
      skippedEarly: acc.skippedEarly + c.skippedEarly,
      moveMsTotal: acc.moveMsTotal + c.moveMsTotal,
    }),
    emptyScorecard(),
  );
}
