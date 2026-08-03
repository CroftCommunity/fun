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
  oracle_best(level: number): number;
  oracle_move_values_json(): number;
  outcome_json(): number;
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
  /** The opponent's move at `level`, or null if the match is over. */
  oracleBest(level: Level): number | null {
    const col = this.x.oracle_best(LEVEL_CODE[level]);
    return col === 0xffff_ffff ? null : col;
  }
  /** The exact value of every legal move — the source for a difficulty band. */
  oracleMoveValues(): MoveValue[] {
    return JSON.parse(this.read(this.x.oracle_move_values_json())) as MoveValue[];
  }
  /** The verifiable `pond-outcome` record envelope for the current match. */
  outcome(): unknown {
    return JSON.parse(this.read(this.x.outcome_json()));
  }
}
