//! Typed TS wrapper over the `looseends-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the game UI. The wasm
//! holds the game; this wrapper never re-implements rules — FREE/BLOCKED, release,
//! generation, and grading all come from the core.

/** One arrow as the UI sees it: its body path, head direction, and live state. */
export interface ArrowView {
  /** Cells `[[x, y], ...]` ordered tail → head. */
  cells: [number, number][];
  /** Unit head direction `[dx, dy]`. */
  dir: [number, number];
  /** Whether the arrow is still on the board. */
  present: boolean;
  /** Whether the arrow is currently FREE (its exit ray is clear). */
  free: boolean;
}

/** The board as the UI sees it. */
export interface BoardView {
  width: number;
  height: number;
  arrows: ArrowView[];
  remaining: number;
  total: number;
  won: boolean;
}

/** A tap outcome the core decided. */
export type TapStatus = "released" | "blocked" | "gone";

/** The `pond-docformat` outcome envelope for a finished board. */
export interface OutcomeEnvelope {
  kind: string;
  version: number;
  payload: {
    seed: number;
    moves: number[];
    move_count: number;
    final_hash: string;
    result: "Won" | "Stuck" | "Abandoned" | "Lost";
    assistance: boolean | null;
  };
}

const TAP: Record<number, TapStatus> = { 0: "released", 1: "blocked", 2: "gone" };

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_level(n: number): void;
  new_daily(seed: number): void;
  new_from_packed(lo: number, hi: number): void;
  board_json(): number;
  current_hash(): number;
  is_won(): number;
  remaining(): number;
  hint(): number;
  stars_for(mistakes: number, hints: number): number;
  score_for(mistakes: number, hints: number): number;
  tap(id: number): number;
  outcome_json(declare: number, assisted: number): number;
}

/**
 * FNV-1a over a string's bytes — the spec's `hashStr`, mirrored so the daily
 * seed is derived the same way on the host as in the core
 * (`looseends_core::daily_seed`). Loose Ends only hashes ASCII keys.
 */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The FNV daily seed for an ISO `YYYY-MM-DD` date key. */
export function dailySeedFor(dateKey: string): number {
  return hashStr(`loose-ends-daily-${dateKey}`);
}

/** A loaded Loose Ends binding bound to one game. */
export class LooseEnds {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/looseends.wasm"): Promise<LooseEnds> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new LooseEnds(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  /** Start campaign level `n` (1..100). */
  newLevel(n: number): void {
    this.x.new_level(n);
  }
  /** Start the daily board for a precomputed daily seed. */
  newDaily(seed: number): void {
    this.x.new_daily(seed >>> 0);
  }
  /** Rebuild a game from a record's packed origin (for re-verification). */
  newFromPacked(packed: number): void {
    this.x.new_from_packed(packed >>> 0, Math.floor(packed / 0x1_0000_0000) >>> 0);
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
  remaining(): number {
    return this.x.remaining();
  }
  /** A FREE arrow id to highlight as a hint, or null if none. */
  hint(): number | null {
    const id = this.x.hint();
    return id === 0xffffffff ? null : id;
  }
  starsFor(mistakes: number, hints: number): number {
    return this.x.stars_for(mistakes, hints);
  }
  scoreFor(mistakes: number, hints: number): number {
    return this.x.score_for(mistakes, hints);
  }
  /** Tap arrow `id`. The core decides FREE (released) / BLOCKED / GONE. */
  tap(id: number): TapStatus {
    return TAP[this.x.tap(id)]!;
  }
  outcome(declareAssistance: boolean, assisted: boolean): OutcomeEnvelope {
    return JSON.parse(
      this.read(this.x.outcome_json(declareAssistance ? 1 : 0, assisted ? 1 : 0)),
    ) as OutcomeEnvelope;
  }
}
