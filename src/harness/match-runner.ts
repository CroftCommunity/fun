//! P6 Phase 1 — the browser match-runner and its `Player` port. This is the
//! imperative half of the hexagonal harness: it drives a real wasm-backed game
//! (the wasm decides legality, win/draw, and the oracle) so it can only
//! run in a page or a wasm-loaded test, never on the pure CI unit path alone.
//!
//! It mirrors the Rust `drop4-harness` shape (`Player` / `run_match` /
//! `MatchRecord`) over the browser substrate, but is **game-agnostic**: it drives
//! a [`GameOracle`], so the same runner grades any shelf game that ships an
//! adapter. No player re-implements rules — `EnginePlayer` delegates to
//! `liveMove`, `GreedyPlayer` reads the wasm's always-exact one-ply facts
//! (`assess`), and `RandomPlayer` picks a seeded-uniform legal move. The
//! recorded `(seed, moves)` replays through a fresh binding to the same terminal
//! hash — a verifiable match regardless of who chose each move.

import type { GameOracle, OracleLevel } from "./game-oracle.js";
import { buildBand, HybridPlayer, type BandMove } from "./hybrid-player.js";

/**
 * A move-chooser over a live [`GameOracle`]. Reads the game state (and, for the
 * engine, the wasm oracle) and returns a legal move code, or `null` at a terminal
 * position.
 * A `Player` MUST NOT mutate the game — the runner owns applying the move.
 */
export interface Player {
  readonly label: string;
  chooseMove(game: GameOracle): Promise<number | null>;
}

/**
 * Why a match stopped early. `"none"` means it reached a terminal result.
 *
 * A single `aborted` boolean was enough while the rig graded one game, whose only
 * abort mode was a bug. It is not enough now: `"nullMove"` is a player declining
 * to move (for Othello, an unhandled forced pass) while `"rejectedMove"` is the
 * core refusing a code (for checkers, a packed code that failed to round-trip).
 * Those are different defects and a boolean cannot tell them apart.
 */
export type AbortReason = "none" | "nullMove" | "rejectedMove";

/** A finished (or aborted) match, verifiable by replaying `(seed, moves)`. */
export interface MatchRecord {
  /** The start seed passed to `newGame`. */
  readonly seed: bigint;
  /** Alternating moves; index 0 is side A's first move. Only applied moves. */
  readonly moves: number[];
  /** Terminal result (-1 ongoing/aborted, 0 draw, 1 A won, 2 B won). */
  readonly result: -1 | 0 | 1 | 2;
  /** The terminal (or final, if aborted) `currentHash`. */
  readonly hash: string;
  /** True if the match ended on an illegal or `null` move, not a terminal result. */
  readonly aborted: boolean;
  /** Which of the two abort paths ended it — `"none"` when it ran to a result. */
  readonly abortReason: AbortReason;
  /** Per-move wall time in ms (engine µs vs LLM ~ms/s — the cost metric). */
  readonly timings: number[];
}

/** The shipped classic opponent at a difficulty [`Level`] (delegates to the wasm). */
export class EnginePlayer implements Player {
  readonly label: string;
  readonly #level: OracleLevel;
  constructor(level: OracleLevel) {
    this.#level = level;
    this.label = `Engine(${level})`;
  }
  chooseMove(game: GameOracle): Promise<number | null> {
    return Promise.resolve(game.liveMove(this.#level));
  }
}

/** A small deterministic PRNG (mulberry32) so a seeded matchup is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniformly-random legal move (seeded). A cheap, deterministic trial baseline. */
export class RandomPlayer implements Player {
  readonly label: string;
  readonly #rand: () => number;
  constructor(seed: number) {
    this.#rand = mulberry32(seed);
    this.label = `Random(${seed})`;
  }
  chooseMove(game: GameOracle): Promise<number | null> {
    const legal = game.legalMoves();
    if (legal.length === 0) return Promise.resolve(null);
    return Promise.resolve(legal[Math.floor(this.#rand() * legal.length)]!);
  }
}

/**
 * One-ply tactical: take an immediate win, else block an immediate threat, else
 * fall back to a tie-break. Uses the wasm's always-exact one-ply facts
 * (`assess`), so it re-implements no rules. Mirrors the Rust `Player::Greedy`.
 *
 * The tie-break is **injected** rather than baked in: it used to be a
 * `CENTRE_OUT = [3, 2, 4, 1, 5, 0, 6]` constant, which is a fact about Drop 4's
 * 7-wide board and has no meaning for a game whose moves are cell indices or
 * packed jump chains. Callers that want it pass it; everyone else gets
 * legal-move order.
 */
export class GreedyPlayer implements Player {
  readonly label = "Greedy";
  readonly #preference: readonly number[];
  /** @param preference Move codes to prefer, best first. Default: legal-move order. */
  constructor(preference: readonly number[] = []) {
    this.#preference = preference;
  }
  chooseMove(game: GameOracle): Promise<number | null> {
    const legal = game.legalMoves();
    if (legal.length === 0) return Promise.resolve(null);
    const facts = legal.map((col) => ({ col, a: game.assess(col) }));
    const win = facts.find((f) => f.a?.immediateWin);
    if (win) return Promise.resolve(win.col);
    const block = facts.find((f) => f.a?.blocksOpponentWin);
    if (block) return Promise.resolve(block.col);
    const preferred = this.#preference.find((c) => legal.includes(c));
    return Promise.resolve(preferred ?? legal[0]!);
  }
}

/** The `{prompt, system}` the hybrid opponent sends the model for one move. */
export interface HybridPromptContext {
  readonly prompt: string;
  readonly system?: string;
}

/** Builds the model prompt from the live game + the class-preserving band. */
export type HybridPromptBuilder = (game: GameOracle, band: readonly BandMove[]) => HybridPromptContext;

/** Default Drop 4 prompt: the board text + the offered (safe) columns. */
const defaultHybridPrompt: HybridPromptBuilder = (game, band) => ({
  system: "You are a Connect-Four opponent. Choose exactly one of the offered columns and reply as JSON {move, reason}.",
  prompt: `Board (bottom row first):\n${game.renderText()}\nOffered columns: ${band
    .map((b) => `${b.col} (${b.idea})`)
    .join(", ")}\nPick one column and say why in one short sentence.`,
});

/**
 * The experimental hybrid opponent as a harness `Player`: it builds the
 * class-preserving band from `game.tutor()`, lets the wrapped {@link HybridPlayer}
 * pick within it (LLM in-band, else engine top-of-band fallback), and returns the
 * column. Reuses the shipped `buildBand`/`HybridPlayer` unchanged — so the harness
 * measures the actual shipped hybrid, and a broken model degrades to the engine,
 * never to a blunder.
 */
export class HybridAiPlayer implements Player {
  readonly label: string;
  readonly #hybrid: HybridPlayer;
  readonly #buildPrompt: HybridPromptBuilder;
  constructor(hybrid: HybridPlayer, opts?: { label?: string; buildPrompt?: HybridPromptBuilder }) {
    this.#hybrid = hybrid;
    this.#buildPrompt = opts?.buildPrompt ?? defaultHybridPrompt;
    this.label = opts?.label ?? "Hybrid";
  }
  async chooseMove(game: GameOracle): Promise<number | null> {
    const report = game.tutor();
    if (report.bestCol === null || report.moves.length === 0) return null;
    const band = buildBand(report.moves);
    if (band.length === 0) return report.bestCol; // safety: the engine's best move
    const { prompt, system } = this.#buildPrompt(game, band);
    const decision = await this.#hybrid.pick(band, { prompt, system });
    return decision.move;
  }
}

/**
 * Play `a` (side A, moves first) against `b` (side B) over `game` to a terminal
 * result. Returns a `MatchRecord`. If a player returns an illegal or `null` move
 * while the game is still live, the match **aborts** (records `aborted: true`)
 * rather than looping forever — the wasm rejects the illegal `play`, so the
 * runner detects the no-op and stops.
 */
export async function runMatch(
  game: GameOracle,
  a: Player,
  b: Player,
  seed: bigint,
): Promise<MatchRecord> {
  game.newGame(seed);
  const moves: number[] = [];
  const timings: number[] = [];
  let abortReason: AbortReason = "none";

  while (game.board().result === -1) {
    const player = game.board().toMove === 1 ? a : b;
    const start = performance.now();
    const col = await player.chooseMove(game);
    const elapsed = performance.now() - start;
    if (col === null) {
      abortReason = "nullMove";
      break;
    }
    if (game.play(col) !== "applied") {
      abortReason = "rejectedMove";
      break;
    }
    moves.push(col);
    timings.push(elapsed);
  }

  return {
    seed,
    moves,
    result: game.board().result,
    hash: game.currentHash(),
    aborted: abortReason !== "none",
    abortReason,
    timings,
  };
}
