//! Typed TS wrapper over the `twenty48-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules (slide/merge, legality,
//! and spawns all come from the core).

/** A slide direction. */
export type Direction = "Up" | "Down" | "Left" | "Right";

const DIR_CODE: Record<Direction, number> = { Up: 0, Down: 1, Left: 2, Right: 3 };
const DIR_NAME: Direction[] = ["Up", "Down", "Left", "Right"];

/** The board as the UI sees it. */
export interface BoardView {
  width: number;
  height: number;
  /** Row-major rows of tile exponents: `0` = empty, else the tile value is `2^v`. */
  cells: number[][];
  score: number;
  maxTile: number;
  won: boolean;
  stuck: boolean;
  gameOver: boolean;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  daily_seed(day_index: number): number;
  board_json(): number;
  current_hash(): number;
  is_won(): number;
  is_stuck(): number;
  hint(): number;
  move_(dir: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** A loaded 2048 binding bound to one game. */
export class Twenty48 {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/2048.wasm"): Promise<Twenty48> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Twenty48(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** The daily seed for `dayIndex` — a seed from the baked pack. */
  dailySeed(dayIndex: number): number {
    return this.x.daily_seed(dayIndex);
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  isStuck(): boolean {
    return this.x.is_stuck() === 1;
  }
  /** A hint direction, or null if the game is over. Using it counts as assistance. */
  hint(): Direction | null {
    const code = this.x.hint();
    return code <= 3 ? DIR_NAME[code]! : null;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  /** Slide in a direction. An illegal (no-change) or over-game move is a no-op. */
  move(dir: Direction): MoveStatus {
    return STATUS[this.x.move_(DIR_CODE[dir])]!;
  }
}
