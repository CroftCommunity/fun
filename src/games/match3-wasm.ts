//! Typed TS wrapper over the `match3-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The
//! wasm holds the game; this wrapper never re-implements rules.

/** The objective the board is being played under. */
export type Mode = "target-score" | "blockers" | "jelly";

/** The board as the UI sees it. */
export interface BoardView {
  /** Which objective this board serves — the UI branches on it. */
  mode: Mode;
  width: number;
  height: number;
  /** Row-major gem colours `0..colours`; `0` where a blocker sits (see `blockers`). */
  cells: number[][];
  /** Row-major blocker mask: `true` where a blocker cell sits (blockers mode). */
  blockers: boolean[][];
  /** Row-major jelly layers per cell (`0` = none, jelly mode). */
  jelly: number[][];
  score: number;
  movesLeft: number;
  moveBudget: number;
  /** Score thresholds for 1★ / 2★ / 3★ (target-score mode). */
  targets: [number, number, number];
  /** Stars earned at the current score (0–3, target-score mode). */
  stars: number;
  /** Blockers still on the board and the deal's original count (blockers mode). */
  blockersRemaining: number;
  blockersTotal: number;
  /** Jellied cells still on the board and the deal's original count (jelly mode). */
  jellyRemaining: number;
  jellyTotal: number;
  /** Whether the objective is met (1★ target, every blocker cleared, or all jelly scrubbed). */
  won: boolean;
}

/** A swap of two adjacent cells: `[fromRow, fromCol, toRow, toCol]`. */
export type Swap = [number, number, number, number];

/** One animation frame: a board as row strings (`.` empty, `0`-`9` gem,
 *  `A`-`Z` blocker), the same encoding the core's `to_rows` emits. */
export type Frame = string[];

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "bad";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  new_blockers_game(lo: number, hi: number): void;
  new_jelly_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  score(): number;
  moves_left(): number;
  is_won(): number;
  play_swap(r1: number, c1: number, r2: number, c2: number): number;
  play_swap_traced(r1: number, c1: number, r2: number, c2: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "bad" };

/** A loaded match-3 binding bound to one game. */
export class Match3 {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/match3.wasm"): Promise<Match3> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Match3(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** Start a clear-the-blockers game on `seed` (deal a winnable blocker board). */
  newBlockersGame(seed: bigint): void {
    this.x.new_blockers_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** Start a clear-the-jelly game on `seed` (deal a winnable jelly board). */
  newJellyGame(seed: bigint): void {
    this.x.new_jelly_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  legalMoves(): Swap[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as Swap[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  score(): number {
    return this.x.score();
  }
  movesLeft(): number {
    return this.x.moves_left();
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  play(swap: Swap): MoveStatus {
    return STATUS[this.x.play_swap(swap[0], swap[1], swap[2], swap[3])]!;
  }

  /** Play a swap and return the per-phase board snapshots (each a list of row
   *  strings: `.` empty, `0`-`9` gem, `A`-`Z` blocker) from the after-swap frame
   *  through each clear/fall/refill to the settled board. Empty on an illegal /
   *  budget-spent swap. The committed state matches `play` — this only adds the
   *  intermediate frames the UI animates. */
  playTraced(swap: Swap): Frame[] {
    return JSON.parse(this.read(this.x.play_swap_traced(swap[0], swap[1], swap[2], swap[3]))) as Frame[];
  }
}
