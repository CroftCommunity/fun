//! Typed TS wrapper over the `align-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the game module. The
//! wasm holds the run; this wrapper never re-implements rules (gravity, legality,
//! kicks, scoring all come from the core). The host drives the fixed timestep:
//! queue atomic actions with `input`, then call `tick` once per 1/60 s.

/** An atomic action the core understands. */
export type Action =
  | "ShiftL"
  | "ShiftR"
  | "RotCW"
  | "RotCCW"
  | "Rot180"
  | "SoftStep"
  | "HardDrop"
  | "Hold"
  | "Quit";

const ACTION_CODE: Record<Action, number> = {
  ShiftL: 0,
  ShiftR: 1,
  RotCW: 2,
  RotCCW: 3,
  Rot180: 4,
  SoftStep: 5,
  HardDrop: 6,
  Hold: 7,
  Quit: 8,
};

/** An `(x, y)` board cell (`+y` up, row 0 at the bottom). */
export type Cell = [number, number];

/** The active piece as the renderer sees it. */
export interface ActivePiece {
  color: number;
  cells: Cell[];
  ghost: Cell[];
}

/** The full render state, straight from the core. */
export interface BoardView {
  width: number;
  height: number;
  visible: number;
  /** Colour ids, bottom-to-top (`rows[0]` is the bottom row). */
  rows: number[][];
  active: ActivePiece | null;
  hold: number;
  holdLocked: boolean;
  next: number[];
  score: number;
  level: number;
  lines: number;
  goalLines: number;
  combo: number;
  b2b: boolean;
  tick: number;
  over: boolean;
  won: boolean;
  label: string;
}

/** Action application status. */
export type InputStatus = "applied" | "rejected" | "over";

/** The re-verification result of a shared record (from the Rust verifier). */
export interface SharedVerify {
  ok: boolean;
  expected: string;
  actual: string;
  seed: number;
  score: number | null;
  won: boolean;
  mode: number;
  startLevel: number;
  moveCount: number;
}

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  alloc(len: number): number;
  new_game(lo: number, hi: number, mode: number, startLevel: number): void;
  tick(): void;
  input(code: number): number;
  board_json(): number;
  current_hash(): number;
  is_over(): number;
  is_won(): number;
  hint_json(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
  verify_shared(len: number): number;
  daily_seed(dayIndex: number): number;
}

const STATUS: Record<number, InputStatus> = { 0: "applied", 1: "rejected", 2: "over" };

/** A loaded Align binding bound to one run. */
export class Align {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/align.wasm"): Promise<Align> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Align(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint, mode: number, startLevel: number): void {
    this.x.new_game(
      Number(seed & 0xffff_ffffn),
      Number((seed >> 32n) & 0xffff_ffffn),
      mode,
      startLevel,
    );
  }
  dailySeed(dayIndex: number): number {
    return this.x.daily_seed(dayIndex);
  }
  tick(): void {
    this.x.tick();
  }
  input(action: Action): InputStatus {
    return STATUS[this.x.input(ACTION_CODE[action])]!;
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isOver(): boolean {
    return this.x.is_over() === 1;
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  /** A hint placement (four cells), or null. Using it counts as assistance. */
  hint(): Cell[] | null {
    const v = JSON.parse(this.read(this.x.hint_json())) as Cell[] | null;
    return v && v.length === 4 ? v : null;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The `pond-docformat` outcome envelope for the current run. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  /**
   * Re-verify a shared record with the authoritative Rust verifier: write the
   * envelope bytes into the wasm input buffer, then run `pond_outcome::verify`.
   * Never trusts the stored hash.
   */
  verifyShared(envelope: unknown): SharedVerify {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const ptr = this.x.alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    const outPtr = this.x.verify_shared(bytes.length);
    return JSON.parse(this.read(outPtr)) as SharedVerify;
  }
}
