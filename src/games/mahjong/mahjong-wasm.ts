//! Typed TS wrapper over the `mahjong-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules — FREE, the match,
//! the deal, the shuffle, undo and the hint all come from the core.

/** One slot as the UI sees it. Coordinates are half-tile units. */
export interface SlotView {
  x: number;
  y: number;
  z: number;
  /** Face id `0..42` (see tiles.ts). */
  face: number;
  present: boolean;
  free: boolean;
}

/** The board as the UI sees it. */
export interface BoardView {
  layout: string;
  layoutId: number;
  width: number;
  height: number;
  slots: SlotView[];
  remaining: number;
  total: number;
  moveCount: number;
  /** Legal pairs available right now. */
  pairs: number;
  won: boolean;
  stuck: boolean;
}

/** A hint from the oracle. `proven` = a full line to a clear was found. */
export interface HintView {
  a: number;
  b: number;
  proven: boolean;
}

/** A move outcome the core decided. */
export type MoveStatus = "applied" | "refused" | "none";

/** The wire code of the shuffle move (`mahjong_core::SHUFFLE`). */
export const SHUFFLE_CODE = 0x10000;

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_level(n: number): void;
  new_daily(seed: number): void;
  new_seed(layout: number, seed: number): void;
  new_packed(lo: number, hi: number): void;
  seed_lo(): number;
  seed_hi(): number;
  board_json(): number;
  matches_json(slot: number): number;
  current_hash(): number;
  is_won(): number;
  remaining(): number;
  hint_json(budget: number): number;
  play(a: number, b: number): number;
  play_code(code: number): number;
  shuffle(): number;
  undo(): number;
  restart(): void;
  outcome_json(declare: number, assisted: number): number;
}

const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "refused", 2: "none" };

/** FNV-1a over a string's bytes — the core's `hash_str`, mirrored so the daily seed is derived identically. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The daily seed for an ISO `YYYY-MM-DD` date key (`mahjong_core::daily_seed`). */
export function dailySeedFor(dateKey: string): number {
  return hashStr(`mahjong-daily-${dateKey}`);
}

/** A loaded Mahjong binding bound to one game. */
export class Mahjong {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/mahjong.wasm"): Promise<Mahjong> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Mahjong(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  /** Start campaign level `n` (1-based). */
  newLevel(n: number): void {
    this.x.new_level(n >>> 0);
  }
  /** Start the daily Turtle for a precomputed daily seed (`dailySeedFor`). */
  newDaily(seed: number): void {
    this.x.new_daily(seed >>> 0);
  }
  /** Start a free deal on layout `layout` (0 Pond … 4 Turtle) from `seed`. */
  newSeed(layout: number, seed: number): void {
    this.x.new_seed(layout >>> 0, seed >>> 0);
  }
  /** Rebuild a game from a record's packed origin (the verifier / `?r=` path). */
  newGame(seed: bigint): void {
    this.x.new_packed(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** The packed origin of the current game. */
  seed(): bigint {
    return (BigInt(this.x.seed_hi() >>> 0) << 32n) | BigInt(this.x.seed_lo() >>> 0);
  }

  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  /** The free tiles that could pair with `slot` (empty for a blocked/gone slot). */
  matchesFor(slot: number): number[] {
    return JSON.parse(this.read(this.x.matches_json(slot >>> 0))) as number[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  remaining(): number {
    return this.x.remaining();
  }
  /** A hint within `budget` solver nodes, or null when cleared / stuck. */
  hint(budget: number): HintView | null {
    return JSON.parse(this.read(this.x.hint_json(budget >>> 0))) as HintView | null;
  }
  /** Remove the pair `(a, b)`. The core decides. */
  play(a: number, b: number): MoveStatus {
    return STATUS[this.x.play(a >>> 0, b >>> 0)]!;
  }
  /** Replay a raw move code (a pair code or `SHUFFLE_CODE`). */
  playCode(code: number): MoveStatus {
    return STATUS[this.x.play_code(code >>> 0)]!;
  }
  /** Re-deal the remaining tiles (a recorded move). */
  shuffle(): MoveStatus {
    return STATUS[this.x.shuffle()]!;
  }
  /** Take back the last move. */
  undo(): boolean {
    return this.x.undo() === 1;
  }
  restart(): void {
    this.x.restart();
  }
  outcome(declareAssistance: boolean, assisted: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0, assisted ? 1 : 0)));
  }
}
