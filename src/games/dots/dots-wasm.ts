//! Typed TS wrapper over the `dots-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and (from
//! Phase 10) the AI harness. The wasm holds the match; this wrapper never
//! re-implements rules — legality, capture, the extra turn, the score and the
//! result all come from the core. Mirrors `Othello` / `Checkers`.
//!
//! One convention differs from those two: `current_hash` and `render_text` are
//! written to the buffer as **raw UTF-8**, not JSON, so they are read as-is
//! rather than parsed. That is the binding's shape (`crates/dots-wasm/src/lib.rs`),
//! and the wrapper matches the binding rather than the other games' habit.

import type { Verifier } from "./dots-outcome.js";

/** Side to move / owner code: 1 = A (opens), 2 = B. */
export type SideCode = 1 | 2;

/** The board as the UI sees it. */
export interface BoardView {
  /** Boxes down. */
  rows: number;
  /** Boxes across. */
  cols: number;
  /** Total edges. */
  edges: number;
  /** Per-edge drawn flag, indexed by edge number. */
  drawn: boolean[];
  /** Per-edge owner: 0 undrawn, 1 drawn by A, 2 drawn by B. */
  edgeOwner: number[];
  /** Box owners, box-major: 0 unclaimed, 1 A, 2 B. */
  owners: number[];
  /** Boxes claimed by A. */
  boxesA: number;
  /** Boxes claimed by B. */
  boxesB: number;
  /** Side to move. */
  toMove: SideCode;
  /** The edges that can still be drawn. */
  legal: number[];
  /** The edge drawn by the most recent move, or null at the start. */
  lastEdge: number | null;
  /** Whether the most recent move closed a box and so kept the turn. */
  keptTurn: boolean;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  result: -1 | 0 | 1 | 2;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal edge. `exact` says whether the facts
 * are the exact solver's (a proven class) or the depth-capped search's, so the
 * UI can be honest about what it knows. `blocksOpponentWin` is always false —
 * a box is claimed by whoever closes it and cannot be defended.
 */
export interface MoveAssessment {
  /** The edge number. Named `col` to match the shared harness fact shape. */
  col: number;
  value: number;
  bestValue: number;
  regret: number;
  quality: MoveQuality;
  immediateWin: boolean;
  blocksOpponentWin: boolean;
  /** This game's own one-line reason ("closes a box, and you move again"). */
  idea: string;
}

/** The current position's whole-position report. */
export interface TutorReport {
  /** One assessment per legal edge; empty at a terminal position. */
  moves: MoveAssessment[];
  /** The best edge (first, if several tie), or null if nothing to assess. */
  bestCol: number | null;
  /** True when the facts are provably exact; false when depth-capped. */
  exact: boolean;
}

/** A single candidate edge's verdict, as the coach reads it. */
export interface EdgeVerdict {
  quality: MoveQuality;
  exact: boolean;
  immediateWin: boolean;
  blocksOpponentWin: boolean;
  /** The coach's sentence, already bound to `exact` in Rust. */
  line: string;
  idea: string;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty. Unlike Othello and checkers, 3x3 dots **is** solved,
 *  so the top level is honestly named Perfect. */
export type Level = "Easy" | "Medium" | "Hard" | "Perfect";
const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Perfect: 3 };

/** The `live_move` "no move" sentinel (`u32::MAX`). */
const MOVE_OVER = 0xffff_ffff;

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  result_code(): number;
  render_text(): number;
  play(edge: number): number;
  live_move(level: number): number;
  assess_json(edge: number): number;
  coach_json(): number;
  tutor_json(): number;
  closes_count(edge: number): number;
  level_sloppiness(level: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Dots and Boxes binding bound to one match. */
export class Dots implements Verifier {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/dots.wasm"): Promise<Dots> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Dots(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  legalMoves(): number[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as number[];
  }
  /** The canonical state hash — raw UTF-8, not JSON (see the module note). */
  currentHash(): string {
    return this.read(this.x.current_hash());
  }
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** The board as a language-model player reads it — raw UTF-8, not JSON. */
  renderText(): string {
    return this.read(this.x.render_text());
  }
  /** Draw `edge` for the side to move. */
  play(edge: number): MoveStatus {
    return STATUS[this.x.play(edge)]!;
  }
  /**
   * The shipped opponent's edge at `level`, or `null` when the match is over.
   *
   * The sentinel arrives from wasm as a **signed** `i32` (`-1`), so it is
   * coerced back to unsigned before the comparison — without that the null
   * branch is dead and a terminal position surfaces as the number `-1`.
   */
  liveMove(level: Level): number | null {
    const code = this.x.live_move(LEVEL_CODE[level]);
    return (code >>> 0) === MOVE_OVER ? null : code;
  }
  /** Assess one candidate edge before it is played, or null if it is not legal. */
  assess(edge: number): EdgeVerdict | null {
    return JSON.parse(this.read(this.x.assess_json(edge))) as EdgeVerdict | null;
  }
  /** The cheap per-tap report (shallow). */
  coach(): TutorReport {
    return JSON.parse(this.read(this.x.coach_json())) as TutorReport;
  }
  /** The deliberately-opened panel's report (deeper). */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /** How many boxes drawing `edge` would close right now (0, 1 or 2). */
  closesCount(edge: number): number {
    return this.x.closes_count(edge);
  }
  /** The level's sloppiness percentage — the engine's own number, not a restated one. */
  levelSloppiness(level: Level): number {
    return this.x.level_sloppiness(LEVEL_CODE[level]);
  }
  /** Record that assistance (a hint or an undo) was used this match. */
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The verifiable `pond-outcome` record envelope for the current match. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
