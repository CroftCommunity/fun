//! Typed TS wrapper over the `furrow-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and (from
//! Phase 10) the AI harness. The wasm holds the match; this wrapper never
//! re-implements rules — legality, the sow, the capture, the extra turn, the
//! sweep, the score and the result all come from the core. Mirrors `Dots` /
//! `Othello` / `Checkers`.
//!
//! Two conventions worth knowing:
//!
//! - `current_hash` and `render_text` are written to the buffer as **raw UTF-8**,
//!   not JSON, so they are read as-is rather than parsed. That is the binding's
//!   shape (`crates/furrow-wasm/src/lib.rs`), and the wrapper matches the binding
//!   rather than the other games' habit.
//! - **`sowPath` is the animation's only source of truth.** One move drops seeds
//!   into as many as thirteen cells and skips exactly one of the fourteen; the UI
//!   must never count those cells itself, because a second implementation of the
//!   skip rule is a second place for it to be wrong.

import type { Verifier } from "./furrow-outcome.js";

/** Side to move code: 1 = A (opens), 2 = B. */
export type SideCode = 1 | 2;

/** The board as the UI sees it. */
export interface BoardView {
  /** Pits per side. */
  pits: number;
  /** Seeds a pit starts with. */
  seeds: number;
  /** All fourteen cell counts, in cell order, stores at their own indices. */
  cells: number[];
  /** Side A's store index. */
  aStore: number;
  /** Side B's store index. */
  bStore: number;
  /** Seeds banked by A. */
  storeA: number;
  /** Seeds banked by B. */
  storeB: number;
  /** Seeds still outside both stores — how much game is left. */
  inPlay: number;
  /** Side to move. */
  toMove: SideCode;
  /** The pits that can still be sown. */
  legal: number[];
  /** The pit sown by the most recent move, or null at the start. */
  lastPit: number | null;
  /** Whether the most recent move landed in the mover's store and kept the turn. */
  keptTurn: boolean;
  /** Whether the most recent move ended the game and triggered the sweep. */
  sweptAtEnd: boolean;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  result: -1 | 0 | 1 | 2;
}

/**
 * What sowing a pit would do, cell by cell — the core's own preview.
 *
 * `path` is the cells a seed lands in, **in order**, with the opponent's store
 * already absent because the rule skips it. Animate this; never derive it.
 */
export interface SowPath {
  path: number[];
  /** The last seed lands in the mover's own store, so the turn is kept. */
  keepsTurn: boolean;
  /** Seeds this move banks, counting a capture and the sweep. */
  banks: number;
  /** The pit a capture empties, or null when the move captures nothing. */
  capturesFrom: number | null;
  /** Whether the move ends the game. */
  endsGame: boolean;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal pit. `exact` says whether the facts
 * are the exact solver's (a proven class) or the depth-capped search's, so the
 * UI can be honest about what it knows — and here that matters for about 70% of
 * a game. `blocksOpponentWin` is always false: mancala has no single move that
 * wins on the spot, so there is none to block.
 */
export interface MoveAssessment {
  /** The pit number. Named `col` to match the shared harness fact shape. */
  col: number;
  value: number;
  bestValue: number;
  regret: number;
  quality: MoveQuality;
  immediateWin: boolean;
  blocksOpponentWin: boolean;
  /** This game's own one-line reason ("lands in your store — you go again"). */
  idea: string;
}

/** The current position's whole-position report. */
export interface TutorReport {
  /** One assessment per legal pit; empty at a terminal position. */
  moves: MoveAssessment[];
  /** The best pit (first, if several tie), or null if nothing to assess. */
  bestCol: number | null;
  /** True when the facts are provably exact; false when depth-capped. */
  exact: boolean;
}

/** A single candidate pit's verdict, as the coach reads it. */
export interface PitVerdict {
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
const STATUS: Record<number, MoveStatus> = {
  0: "applied",
  1: "illegal",
  2: "over",
};

/**
 * Opponent difficulty. The top level is **Expert, not Perfect**: Phase 0 could
 * not solve the opening at 100M nodes, and about 70% of a game sits above the
 * exact threshold, so the engine searches rather than solves for most of it.
 */
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
const LEVEL_CODE: Record<Level, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
  Expert: 3,
};

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
  play(pit: number): number;
  live_move(level: number): number;
  sow_path_json(pit: number): number;
  assess_json(pit: number): number;
  coach_json(): number;
  tutor_json(): number;
  level_sloppiness(level: number): number;
  is_solved_from_here(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Furrow binding bound to one match. */
export class Furrow implements Verifier {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/furrow.wasm"): Promise<Furrow> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Furrow(instance.exports as unknown as Exports);
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
  /** Sow `pit` for the side to move. */
  play(pit: number): MoveStatus {
    return STATUS[this.x.play(pit)]!;
  }
  /**
   * The shipped opponent's pit at `level`, or `null` when the match is over.
   *
   * The sentinel arrives from wasm as a **signed** `i32` (`-1`), so it is
   * coerced back to unsigned before the comparison — without that the null
   * branch is dead and a terminal position surfaces as the number `-1`.
   */
  liveMove(level: Level): number | null {
    const code = this.x.live_move(LEVEL_CODE[level]);
    return code >>> 0 === MOVE_OVER ? null : code;
  }
  /**
   * The core's own preview of sowing `pit`, or `null` if it is not legal here.
   * **The animation's only source of truth** — see the module note.
   */
  sowPath(pit: number): SowPath | null {
    return JSON.parse(this.read(this.x.sow_path_json(pit))) as SowPath | null;
  }
  /** Assess one candidate pit before it is sown, or null if it is not legal. */
  assess(pit: number): PitVerdict | null {
    return JSON.parse(this.read(this.x.assess_json(pit))) as PitVerdict | null;
  }
  /** The cheap per-tap report (shallow). */
  coach(): TutorReport {
    return JSON.parse(this.read(this.x.coach_json())) as TutorReport;
  }
  /** The deliberately-opened panel's report (deeper). */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /** The level's sloppiness percentage — the engine's own number, not a restated one. */
  levelSloppiness(level: Level): number {
    return this.x.level_sloppiness(LEVEL_CODE[level]);
  }
  /**
   * Whether the engine can currently **prove** its verdicts, i.e. the position
   * is inside the exact threshold. Reading it never runs a search, so the UI can
   * say "from here the engine is solving, not guessing" without paying for a
   * report it did not want.
   */
  isSolvedFromHere(): boolean {
    return this.x.is_solved_from_here() === 1;
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
