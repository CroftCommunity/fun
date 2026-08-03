//! Typed TS wrapper over the `drop4-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and the
//! AI harness. The wasm holds the match; this wrapper never re-implements rules
//! (legality, win/draw, and the oracle all come from the core + solver).

/** Side to move / disc owner: 1 = A (X, opens), 2 = B (O). */
export type SideCode = 1 | 2;

/** The board as the UI / harness sees it. */
export interface BoardView {
  width: number;
  height: number;
  /** Row-major rows, row 0 = bottom. 0 empty, 1 = A/X, 2 = B/O. */
  cells: number[][];
  /** Side to move. */
  toMove: SideCode;
  /** Columns that can still be played. */
  legal: number[];
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  result: -1 | 0 | 1 | 2;
}

/** One legal move and its exact oracle value (higher = better for side to move). */
export interface MoveValue {
  col: number;
  value: number;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal move — the ground truth the tutor
 * surfaces. `exact` says whether the facts are provably right (endgame) or
 * horizon-approximate (early), so the UI can be honest.
 */
export interface MoveAssessment {
  col: number;
  /** Value (side-to-move perspective; higher is better), exact or capped. */
  value: number;
  /** The best value available in the position. */
  bestValue: number;
  /** How far below the best value (0 = optimal). */
  regret: number;
  quality: MoveQuality;
  /** Completes a four-in-a-row now (always an exact one-ply fact). */
  immediateWin: boolean;
  /** Blocks an immediate opponent win (always an exact one-ply fact). */
  blocksOpponentWin: boolean;
  /** True when the facts are provably exact; false when horizon-approximate. */
  exact: boolean;
}

/** The current position's whole-position tutor report. */
export interface TutorReport {
  /** One assessment per legal move; empty if the position is terminal. */
  moves: MoveAssessment[];
  /** The best column (first, if several tie), or null if terminal. */
  bestCol: number | null;
  /** True when the facts are provably exact; false when horizon-approximate. */
  exact: boolean;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty level codes. */
export type Level = "Easy" | "Medium" | "Hard" | "Perfect";
const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Perfect: 3 };

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  result_code(): number;
  render_text(): number;
  play(col: number): number;
  live_move(level: number): number;
  oracle_best(level: number): number;
  oracle_move_values_json(): number;
  assess_json(col: number): number;
  tutor_json(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Drop 4 binding bound to one match. */
export class Drop4 {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/drop4.wasm"): Promise<Drop4> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Drop4(instance.exports as unknown as Exports);
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
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** A human/LLM-readable rendering of the board + whose turn. */
  renderText(): string {
    return JSON.parse(this.read(this.x.render_text())) as string;
  }
  /** Drop a disc in `col` for the side to move. */
  play(col: number): MoveStatus {
    return STATUS[this.x.play(col)]!;
  }
  /**
   * The **live** (shipped) opponent's move at `level`, or null if the match is
   * over. A depth-capped heuristic engine — fast from any position (unlike
   * {@link oracleBest}, which is exact but slow from the opening).
   */
  liveMove(level: Level): number | null {
    const col = this.x.live_move(LEVEL_CODE[level]);
    return col === 0xffff_ffff ? null : col;
  }
  /** The exact oracle's move at `level`, or null if the match is over. */
  oracleBest(level: Level): number | null {
    const col = this.x.oracle_best(LEVEL_CODE[level]);
    return col === 0xffff_ffff ? null : col;
  }
  /** The exact value of every legal move — the source for a difficulty band. */
  oracleMoveValues(): MoveValue[] {
    return JSON.parse(this.read(this.x.oracle_move_values_json())) as MoveValue[];
  }
  /**
   * Engine-grounded assessment of the candidate move `col` at the **current**
   * position (before it is played) — quality, regret, immediate-win /
   * blocks-threat, and whether the facts are exact. `null` if there is no game
   * or `col` is not a legal move.
   */
  assess(col: number): MoveAssessment | null {
    return JSON.parse(this.read(this.x.assess_json(col))) as MoveAssessment | null;
  }
  /**
   * The current position's whole-position tutor report: every legal move's
   * assessment, the best column, and whether the facts are exact.
   */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /** Record that a hint was used this match (assistance). */
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /**
   * The verifiable `pond-outcome` record envelope for the current match. When
   * `declareAssistance` is true the self-declared assistance flag is carried;
   * otherwise the declaration is opted out (`null`).
   */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
