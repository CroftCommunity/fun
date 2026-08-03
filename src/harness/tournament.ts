//! P6 Phase 3 — the tournament and its aggregate `Report`. Runs N games of
//! `a` vs `b`, **alternating who opens** each game so first-move advantage
//! doesn't skew the numbers, and grades the player-under-test (`a`) whichever
//! side it took that game. Aggregates into a `Report` mirroring the Rust
//! `drop4-harness::Report`.
//!
//! This is the top of the pure/imperative split: it composes `runMatch`
//! (imperative, drives the wasm) with `gradeSide` + `sumScorecards` (pure), over
//! fresh `Drop4` instances from a `gameFactory` (a fresh binding to play, a fresh
//! one to grade — the verifier must replay from `initial`).

import type { Drop4, SideCode } from "../games/drop4/drop4-wasm.js";
import { runMatch, type MatchRecord, type Player } from "./match-runner.js";
import { blunderRate, gradeSide, sumScorecards, type Scorecard } from "./scorer.js";

/** Options for a tournament run. */
export interface TournamentOptions {
  /** Number of games to play. */
  readonly games: number;
  /** Base seed; game `i` uses `baseSeed + i`. */
  readonly baseSeed: bigint;
  /**
   * Optional per-game progress hook, called after each game completes with its
   * index, the played record, and player `a`'s scorecard for that game. Used by
   * the standalone trial driver for its staged diagnostic (a long WebGPU run
   * needs legible progress); CI leaves it unset.
   */
  readonly onGame?: (index: number, record: MatchRecord, card: Scorecard) => void;
}

/** A tournament report: the matchup and the player-under-test's aggregate card. */
export interface Report {
  /** Human-readable matchup label (`a` vs `b`). */
  readonly matchup: string;
  /** Player `a`'s aggregate scorecard across all games (both sides it played). */
  readonly card: Scorecard;
}

/**
 * Play `games` matches of `a` vs `b`, alternating the opening side each game, and
 * aggregate `a`'s scorecard. `gameFactory` returns a fresh `Drop4` per call (one
 * to play the match, one to grade it). Deterministic for deterministic players.
 */
export async function runTournament(
  gameFactory: () => Promise<Drop4>,
  a: Player,
  b: Player,
  opts: TournamentOptions,
): Promise<Report> {
  const cards: Scorecard[] = [];
  for (let i = 0; i < opts.games; i++) {
    const aOpens = i % 2 === 0;
    const playerA = aOpens ? a : b;
    const playerB = aOpens ? b : a;
    const seed = opts.baseSeed + BigInt(i);

    const game = await gameFactory();
    const record = await runMatch(game, playerA, playerB, seed);

    const verifier = await gameFactory();
    const aSide: SideCode = aOpens ? 1 : 2; // the side `a` played this game
    const card = gradeSide(record, verifier, aSide);
    cards.push(card);
    opts.onGame?.(i, record, card);
  }
  return { matchup: `${a.label} vs ${b.label}`, card: sumScorecards(cards) };
}

/**
 * A one-block textual rendering of a report. The graded-move denominator
 * (`scoredMoves`) and the honestly-skipped count are surfaced **adjacent to** the
 * blunder count, so a "0 blunders" headline can never be read without knowing how
 * many moves were actually graded — the exact-only gate can grade zero moves in a
 * short game.
 */
export function renderReport(r: Report): string {
  const c = r.card;
  const winRate = c.games === 0 ? 0 : (100 * c.wins) / c.games;
  const msPerScored = c.scoredMoves === 0 ? 0 : c.moveMsTotal / c.scoredMoves;
  return [
    r.matchup,
    `  games ${c.games} | W-D-L ${c.wins}-${c.draws}-${c.losses} (win rate ${winRate.toFixed(0)}%)`,
    `  graded moves ${c.scoredMoves} (skipped ${c.skippedEarly} early) | optimal ${c.optimal} · preserving ${c.preserving} · blunders ${c.blunders} (blunder rate ${(100 * blunderRate(c)).toFixed(1)}%)`,
    `  cost ${c.moveMsTotal.toFixed(0)}ms total (${msPerScored.toFixed(1)}ms/graded move)`,
  ].join("\n");
}
