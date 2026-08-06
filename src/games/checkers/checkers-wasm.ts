//! Typed TS wrapper over the `checkers-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and the
//! AI harness. The wasm holds the match; this wrapper never re-implements rules —
//! legality, mandatory capture, jump chains, crowning, the no-progress draw and
//! the oracle all come from the core + solver. Mirrors `Othello` / `Drop4`.
//!
//! One shape differs on purpose: a checkers move is a **path**, not a
//! destination, so `board().legal` (and `legalMoveDetails()`) carry each move's
//! landings and captures. That is what lets the UI step a player through a
//! multi-jump by *filtering* the core's own chains against the prefix tapped so
//! far, rather than deciding legality itself. `legalMoves()` is the flattened
//! code list the `GameOracle` port speaks.

/** Side to move / piece owner: 1 = A (Black, opens), 2 = B (White). */
export type SideCode = 1 | 2;

/**
 * One legal move with everything needed to animate and step through it.
 *
 * `code` is the packed `(from, to, variant)` wire code `play` takes — the
 * shelf's first move code that does not fit in a `u8`.
 */
export interface LegalMove {
  /** The packed `(from | to << 5 | variant << 10)` code. */
  code: number;
  /** 0-based origin square (square number − 1). */
  from: number;
  /** 0-based final square. */
  to: number;
  /** Each landing in order; the last is `to`. Length 1 for a simple move. */
  path: number[];
  /** The squares of the pieces this move takes, in hop order. */
  captures: number[];
  /** Whether this move crowns the moving man (which ends the move). */
  crowns: boolean;
}

/** The board as the UI / harness sees it. */
export interface BoardView {
  /** Playable dark squares (32); the UI derives the 8×8 grid from the numbering. */
  squares: number;
  /** One byte per dark square: 0 empty, 1 A man, 2 A king, 3 B man, 4 B king. */
  cells: number[];
  /** Side to move. */
  toMove: SideCode;
  /** Every legal move with its full path. Empty when the game is over. */
  legal: LegalMove[];
  /** Plies since the last capture or man advance; the game is drawn at 80. */
  noProgress: number;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  result: -1 | 0 | 1 | 2;
}

/** One legal move and its engine value (higher = better for side to move). */
export interface MoveValue {
  /** The packed move code. (Named `col` for the shared harness field.) */
  col: number;
  value: number;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal move. `exact` says whether this
 * move's value came from a **proven terminal** or from a horizon judgement, so
 * the UI can be honest. `immediateWin`/`blocksOpponentWin` are always false for
 * checkers (carried so this stays a structural superset of the shared harness
 * `TutorFactMove`); `captures` is checkers' one-ply fact.
 */
export interface MoveAssessment {
  col: number;
  value: number;
  bestValue: number;
  regret: number;
  quality: MoveQuality;
  immediateWin: boolean;
  blocksOpponentWin: boolean;
  captures: number;
  exact: boolean;
}

/** The current position's whole-position tutor report. */
export interface TutorReport {
  /** One assessment per legal move; empty if terminal. */
  moves: MoveAssessment[];
  /** The best move code (first, if several tie), or null if nothing to assess. */
  bestCol: number | null;
  /** True only when **every** move in the report is proven. */
  exact: boolean;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty level codes. */
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Expert: 3 };

/** The `live_move` / `oracle_best` "no move" sentinel. Checkers has no pass. */
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
  play(code: number): number;
  live_move(level: number): number;
  oracle_best(level: number): number;
  oracle_move_values_json(): number;
  assess_json(code: number): number;
  coach_json(): number;
  tutor_json(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Checkers binding bound to one match. */
export class Checkers {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/checkers.wasm"): Promise<Checkers> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Checkers(instance.exports as unknown as Exports);
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
  /** Every legal move with its chain detail — the source for the step-through UI. */
  legalMoveDetails(): LegalMove[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as LegalMove[];
  }
  /** The legal move codes only — what the `GameOracle` port speaks. */
  legalMoves(): number[] {
    return this.legalMoveDetails().map((m) => m.code);
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  /** -1 ongoing, 0 draw, 1 A won, 2 B won, -2 no game. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** A human/LLM-readable rendering of the board + whose turn. */
  renderText(): string {
    return JSON.parse(this.read(this.x.render_text())) as string;
  }
  /** Play the move named by the packed `code` for the side to move. */
  play(code: number): MoveStatus {
    return STATUS[this.x.play(code)]!;
  }
  /** The **live** (shipped) opponent's move at `level`, or null if the match is over. */
  liveMove(level: Level): number | null {
    return this.decodeMove(this.x.live_move(LEVEL_CODE[level]));
  }
  /** The analysis oracle's best move, or null if the match is over. */
  oracleBest(level: Level): number | null {
    return this.decodeMove(this.x.oracle_best(LEVEL_CODE[level]));
  }
  /**
   * The core returns the `u32` sentinel `MOVE_OVER`, but a wasm `i32` result
   * reaches JS **signed** — so it arrives as `-1`, and a plain
   * `code === MOVE_OVER` is dead code. The unsigned coercion is what makes the
   * comparison fire. Drop 4 and Othello both shipped this bug before it was
   * fixed; see `tests/wasm-move-sentinels.test.ts`.
   */
  private decodeMove(code: number): number | null {
    return (code >>> 0) === MOVE_OVER ? null : code;
  }
  /** The engine value of every legal move — the source for a difficulty band. */
  oracleMoveValues(): MoveValue[] {
    return JSON.parse(this.read(this.x.oracle_move_values_json())) as MoveValue[];
  }
  /**
   * Engine-grounded assessment of the candidate move `code` at the current
   * position, or `null` if there is no game or `code` is not a legal move.
   */
  assess(code: number): MoveAssessment | null {
    return JSON.parse(this.read(this.x.assess_json(code))) as MoveAssessment | null;
  }
  /**
   * The whole-position report at the **panel** budget — the deep search that
   * buys the proofs behind "that threw the game". Opened deliberately; measured
   * at up to ~700ms, so never call it on a tap. Use {@link coach} there.
   */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /**
   * The same report at the **per-move coach** budget — the cheap one (~46ms
   * worst case), for deciding whether to say anything about the move just
   * played. It hedges more often than {@link tutor}; it is never less honest,
   * because grading a blunder still needs two proofs either way.
   */
  coach(): TutorReport {
    return JSON.parse(this.read(this.x.coach_json())) as TutorReport;
  }
  /** Record that a hint was used this match (assistance). */
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The verifiable `pond-outcome` record envelope for the current match. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
