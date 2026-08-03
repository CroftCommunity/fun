//! P6 Phase 1 — the browser match-runner and its `Player` port. This is the
//! imperative half of the hexagonal harness: it drives a real `drop4-wasm`
//! instance (the wasm decides legality, win/draw, and the oracle) so it can only
//! run in a page or a wasm-loaded test, never on the pure CI unit path alone.
//!
//! It mirrors the Rust `drop4-harness` shape (`Player` / `run_match` /
//! `MatchRecord`) over the browser substrate: the shipped `Drop4` wasm and the
//! shipped TS players. No player re-implements rules — `EnginePlayer` delegates
//! to `Drop4.liveMove`, `GreedyPlayer` reads the wasm's always-exact one-ply
//! facts (`assess`), and `RandomPlayer` picks a seeded-uniform legal move. The
//! recorded `(seed, moves)` replays through a fresh binding to the same terminal
//! hash — a verifiable match regardless of who chose each move.

import type { Drop4, Level } from "../games/drop4/drop4-wasm.js";
import { buildBand, HybridPlayer, type BandMove } from "./hybrid-player.js";

/**
 * A move-chooser over a live `Drop4`. Reads the game state (and, for the engine,
 * the wasm oracle) and returns a legal column, or `null` at a terminal position.
 * A `Player` MUST NOT mutate the game — the runner owns applying the move.
 */
export interface Player {
  readonly label: string;
  chooseMove(game: Drop4): Promise<number | null>;
}

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
  /** Per-move wall time in ms (engine µs vs LLM ~ms/s — the cost metric). */
  readonly timings: number[];
}

/** The shipped classic opponent at a difficulty [`Level`] (delegates to the wasm). */
export class EnginePlayer implements Player {
  readonly label: string;
  readonly #level: Level;
  constructor(level: Level) {
    this.#level = level;
    this.label = `Engine(${level})`;
  }
  chooseMove(game: Drop4): Promise<number | null> {
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
  chooseMove(game: Drop4): Promise<number | null> {
    const legal = game.legalMoves();
    if (legal.length === 0) return Promise.resolve(null);
    return Promise.resolve(legal[Math.floor(this.#rand() * legal.length)]!);
  }
}

/** Column preference for the one-ply greedy tie-break (centre-out), per the Rust rig. */
const CENTRE_OUT = [3, 2, 4, 1, 5, 0, 6];

/**
 * One-ply tactical: take an immediate win, else block an immediate threat, else
 * prefer the centre. Uses the wasm's always-exact one-ply facts (`assess`), so it
 * re-implements no rules. Mirrors the Rust `Player::Greedy` baseline.
 */
export class GreedyPlayer implements Player {
  readonly label = "Greedy";
  chooseMove(game: Drop4): Promise<number | null> {
    const legal = game.legalMoves();
    if (legal.length === 0) return Promise.resolve(null);
    const facts = legal.map((col) => ({ col, a: game.assess(col) }));
    const win = facts.find((f) => f.a?.immediateWin);
    if (win) return Promise.resolve(win.col);
    const block = facts.find((f) => f.a?.blocksOpponentWin);
    if (block) return Promise.resolve(block.col);
    const centre = CENTRE_OUT.find((c) => legal.includes(c));
    return Promise.resolve(centre ?? legal[0]!);
  }
}

/** The `{prompt, system}` the hybrid opponent sends the model for one move. */
export interface HybridPromptContext {
  readonly prompt: string;
  readonly system?: string;
}

/** Builds the model prompt from the live game + the class-preserving band. */
export type HybridPromptBuilder = (game: Drop4, band: readonly BandMove[]) => HybridPromptContext;

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
  async chooseMove(game: Drop4): Promise<number | null> {
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
export async function runMatch(game: Drop4, a: Player, b: Player, seed: bigint): Promise<MatchRecord> {
  game.newGame(seed);
  const moves: number[] = [];
  const timings: number[] = [];
  let aborted = false;

  while (game.board().result === -1) {
    const player = game.board().toMove === 1 ? a : b;
    const start = performance.now();
    const col = await player.chooseMove(game);
    const elapsed = performance.now() - start;
    if (col === null) {
      aborted = true;
      break;
    }
    if (game.play(col) !== "applied") {
      aborted = true;
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
    aborted,
    timings,
  };
}
