//! Typed TS wrapper over the `bubble-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules (legality, shot
//! resolution, and the launcher colour all come from the core).

/** The board as the UI sees it (staggered hex — the UI derives each row's
 *  on-screen offset from its parity: even rows are full `width`, odd rows are
 *  `width - 1` and shifted half a cell). */
export interface BoardView {
  /** Cells in a full (even) row. */
  width: number;
  height: number;
  /** Row-major, one inner list per row with that row's length; `-1` = empty,
   *  else the bubble colour `0..colors`. */
  cells: number[][];
  /** The colour the next shot places. */
  currentColor: number;
  score: number;
  shotsLeft: number;
  shotBudget: number;
  /** Whether the board is cleared (the objective is met). */
  cleared: boolean;
}

/** A landing cell to aim at: `[row, col]`. */
export type Target = [number, number];

/** Shot application status. */
export type ShotStatus = "applied" | "illegal" | "bad";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  bubble_daily_seed(day_index: number): number;
  board_json(): number;
  legal_targets_json(): number;
  current_hash(): number;
  score(): number;
  shots_left(): number;
  current_color(): number;
  is_cleared(): number;
  shoot(r: number, c: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

const STATUS: Record<number, ShotStatus> = { 0: "applied", 1: "illegal", 2: "bad" };

/** A loaded bubble-shooter binding bound to one game. */
export class Bubble {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/bubble.wasm"): Promise<Bubble> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Bubble(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** The clear-the-board daily seed for `dayIndex` — a winnable seed from the
   *  baked pack (so the daily deal is guaranteed clearable). */
  dailySeed(dayIndex: number): number {
    return this.x.bubble_daily_seed(dayIndex);
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  /** The legal landing cells — the UI glows exactly these; the core decides. */
  legalTargets(): Target[] {
    return JSON.parse(this.read(this.x.legal_targets_json())) as Target[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  score(): number {
    return this.x.score();
  }
  shotsLeft(): number {
    return this.x.shots_left();
  }
  currentColor(): number {
    return this.x.current_color();
  }
  isCleared(): boolean {
    return this.x.is_cleared() === 1;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  /** Fire the current colour at a landing cell. Illegal / budget-spent shots
   *  leave the board unchanged. */
  shoot(target: Target): ShotStatus {
    return STATUS[this.x.shoot(target[0], target[1])]!;
  }
}
