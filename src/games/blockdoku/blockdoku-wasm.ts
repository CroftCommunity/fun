//! Typed TS wrapper over the `blockdoku-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules (placement legality,
//! clearing, scoring, and the deal all come from the core).
//!
//! Seeds crossing the boundary are **config-packed** (mirroring
//! `blockdoku_core::config`): the deal options ride in the high bits so a single
//! `u64` — carried by the outcome record and the `?r=` share — reproduces any
//! configuration. The base seed is the low 36 bits, keeping the packed value
//! within `Number.MAX_SAFE_INTEGER`.

/** A difficulty preset. */
export type Difficulty = "easy" | "normal" | "hard" | "expert";

/** Per-game deal configuration (mirrors the core's `DealOptions`). */
export interface DealConfig {
  difficulty: Difficulty;
  enableMagic: boolean;
  magicFrequency: number;
  enableWild: boolean;
  wildFrequency: number;
  guaranteePlaceable: boolean;
}

/** The default v1 configuration: normal, no wild/magic, placeability guaranteed. */
export const DEFAULT_CONFIG: DealConfig = {
  difficulty: "normal",
  enableMagic: false,
  magicFrequency: 0,
  enableWild: false,
  wildFrequency: 0,
  guaranteePlaceable: true,
};

const DIFF_CODE: Record<Difficulty, bigint> = { easy: 0n, normal: 1n, hard: 2n, expert: 3n };

/** Pack `(baseSeed, config)` into a transport seed — mirrors `config::pack_seed`. */
export function packSeed(baseSeed: bigint, c: DealConfig): bigint {
  const base = baseSeed & ((1n << 36n) - 1n);
  return (
    base |
    (DIFF_CODE[c.difficulty] << 36n) |
    (BigInt(Math.min(15, Math.max(0, c.magicFrequency))) << 38n) |
    (BigInt(c.enableMagic ? 1 : 0) << 42n) |
    (BigInt(Math.min(15, Math.max(0, c.wildFrequency))) << 43n) |
    (BigInt(c.enableWild ? 1 : 0) << 47n) |
    (BigInt(c.guaranteePlaceable ? 1 : 0) << 48n)
  );
}

/** How a finished game ended (there is no win). */
export type GameResultKind = "stuck" | "moveLimit";

/** The board as the UI sees it. */
export interface BoardView {
  size: number;
  /** Row-major occupancy: `0` empty, `1` filled. */
  cells: number[][];
  score: number;
  streak: number;
  combo: number;
  gameOver: boolean;
  result: GameResultKind | null;
}

/** A tray piece as the UI sees it. */
export interface PieceView {
  slot: number;
  key: string;
  name: string;
  tier: "standard" | "wild" | "magic";
  points: number;
  rows: number;
  cols: number;
  /** The shape's occupancy matrix, row-major. */
  cells: number[][];
}

/** A legal move (place slot at anchor). */
export interface MoveView {
  slot: number;
  row: number;
  col: number;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  daily_seed(day_index: number): number;
  board_json(): number;
  tray_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  is_over(): number;
  play_place(slot: number, row: number, col: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** A loaded Blockdoku binding bound to one game. */
export class Blockdoku {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/blockdoku.wasm"): Promise<Blockdoku> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Blockdoku(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  /** Start a game from a base seed + configuration (packs internally). */
  newGame(baseSeed: bigint, config: DealConfig = DEFAULT_CONFIG): void {
    this.newGamePacked(packSeed(baseSeed, config));
  }

  /** Start a game from an already-packed seed (used by verify/share replay). */
  newGamePacked(packed: bigint): void {
    this.x.new_game(Number(packed & 0xffff_ffffn), Number((packed >> 32n) & 0xffff_ffffn));
  }

  /** The daily **base** seed for `dayIndex` from the baked pack. */
  dailySeed(dayIndex: number): number {
    return this.x.daily_seed(dayIndex);
  }

  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  tray(): (PieceView | null)[] {
    return JSON.parse(this.read(this.x.tray_json())) as (PieceView | null)[];
  }
  legalMoves(): MoveView[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as MoveView[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isOver(): boolean {
    return this.x.is_over() === 1;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  /** Place tray `slot` at `(row, col)`. An illegal/over move is a no-op. */
  playPlace(slot: number, row: number, col: number): MoveStatus {
    return STATUS[this.x.play_place(slot, row, col)]!;
  }
}
