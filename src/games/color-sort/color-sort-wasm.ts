//! Typed TS wrapper over the `color-sort-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules (legality, the pour, the
//! deal, win/deadlock, and the solver hint all come from the core).

/** A pour from tube `from` to tube `to`. */
export interface Move {
  from: number;
  to: number;
}

/** The board as the UI sees it. */
export interface BoardView {
  /** Each tube bottom→top: a colour id `0..colors` (empty tube = `[]`). */
  tubes: number[][];
  colors: number;
  cap: number;
  /** Per-tube: full-and-monochrome (locked — capped, untappable). */
  locked: boolean[];
  /** The UI-legal pours (glow the targets for a selected source). */
  moves: Move[];
  won: boolean;
  deadlocked: boolean;
  /** The solver's line length for the deal (par); `0` when unknown. */
  par: number;
  moveCount: number;
}

/** Pour application status. */
export type PourStatus = "applied" | "illegal" | "over";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_daily(day_index: number): void;
  new_endless(level: number): void;
  new_seed(base: number, colors: number, empties: number): void;
  new_packed(lo: number, hi: number): void;
  board_json(): number;
  current_hash(): number;
  is_won(): number;
  is_deadlocked_(): number;
  hint(): number;
  pour(from: number, to: number): number;
  undo(): number;
  restart(): void;
  mark_assistance(): void;
  outcome_json(declare: number): number;
  seed_lo(): number;
  seed_hi(): number;
}

const STATUS: Record<number, PourStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** A loaded Color Sort binding bound to one game. */
export class ColorSort {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/color-sort.wasm"): Promise<ColorSort> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new ColorSort(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  /** Deal today's daily puzzle (`dayIndex` = UTC days since the epoch). */
  newDaily(dayIndex: number): void {
    this.x.new_daily(dayIndex);
  }
  /** Deal endless level `level` (1-based); generated + certified at runtime. */
  newEndless(level: number): void {
    this.x.new_endless(level);
  }
  /** Deal a free-play puzzle for an explicit base seed at `colors`/`empties`. */
  newSeed(base: number, colors: number, empties: number): void {
    this.x.new_seed(base, colors, empties);
  }
  /** Reconstruct a game from a packed outcome seed (the verifier / `?r=` path). */
  newGame(seed: bigint): void {
    this.x.new_packed(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
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
  isDeadlocked(): boolean {
    return this.x.is_deadlocked_() === 1;
  }
  /** A hint move (solved from the current state), or null if won / unsolvable. */
  hint(): Move | null {
    return JSON.parse(this.read(this.x.hint())) as Move | null;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
  /** The packed deal seed of the current game (for building the share/replay). */
  seed(): bigint {
    return (BigInt(this.x.seed_hi() >>> 0) << 32n) | BigInt(this.x.seed_lo() >>> 0);
  }

  /** Pour `from → to`. An illegal (no-change) or post-win pour is a no-op. */
  pour(from: number, to: number): PourStatus {
    return STATUS[this.x.pour(from, to)]!;
  }
  /** The verifier `play` alias (drives `verifyRecord`). */
  play(mv: Move): PourStatus {
    return this.pour(mv.from, mv.to);
  }
  /** Undo the last pour (Free mode). Returns whether a pour was undone. */
  undo(): boolean {
    return this.x.undo() === 1;
  }
  restart(): void {
    this.x.restart();
  }
}
