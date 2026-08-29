//! Typed TS wrapper over the `orchard-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the game UI.
//!
//! The wasm holds the run. This wrapper **never re-implements a rule** — not the
//! cooldown, not the clamp, not the merge, not game-over. It decodes and calls.
//! Anything it decided for itself would be a second opinion the record could not
//! verify.

/** A fruit as the renderer needs it. Whole pixels; the core keeps the precision. */
export interface FruitView {
  readonly id: number;
  readonly tier: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Rotation in milliradians — integer, so no float crosses the boundary. */
  readonly ang: number;
}

/** The crate and the header state, as one read. */
export interface WorldView {
  readonly tick: number;
  readonly score: number;
  readonly held: number;
  readonly next: number;
  readonly over: boolean;
  readonly max_tier: number;
  readonly fruit: readonly FruitView[];
}

/** Why a drop was refused, or that it was not. */
export type DropStatus = "dropped" | "cooling" | "backwards" | "over" | "no-game";

const STATUS: Record<number, DropStatus> = {
  0: "dropped",
  1: "cooling",
  2: "backwards",
  3: "over",
  4: "no-game",
};

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
}

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  drop_at(tick: number, x: number): number;
  wait_until(tick: number): number;
  world_json(): number;
  current_hash(): number;
  score(): number;
  is_over(): number;
  held(): number;
  next_up(): number;
  tick(): number;
  ladder_tiers(): number;
  daily_seed_lo(day: number): number;
  daily_seed_hi(day: number): number;
  record_json(): number;
  verify_json(ptr: number, len: number): number;
  tick_digest(n: number): number;
}

/** Scratch address in the wasm heap for handing bytes in. */
const SCRATCH = 1024;

/** A loaded Orchard Drop binding bound to one run. */
export class OrchardDrop {
  private constructor(private readonly x: Exports) {}

  /** Load the module. */
  static async load(wasmUrl = "/orchard-drop.wasm"): Promise<OrchardDrop> {
    if (typeof fetch !== "function") throw new Error("no fetch available to load wasm");
    const source = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(
      async () => WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
    );
    return new OrchardDrop(source.instance.exports as unknown as Exports);
  }

  /** Wrap an already-instantiated module (tests, and the Node cross-check). */
  static fromInstance(instance: WebAssembly.Instance): OrchardDrop {
    return new OrchardDrop(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, this.x.out_len());
    return new TextDecoder().decode(bytes);
  }

  /**
   * Start a run. Seeds are 64-bit and cross the boundary as two 32-bit halves —
   * a `number` cannot hold one exactly, so `bigint` is the honest type here.
   */
  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffffffffn), Number((seed >> 32n) & 0xffffffffn));
  }

  /** The seed for a UTC day index. */
  dailySeed(dayIndex: number): bigint {
    const lo = BigInt(this.x.daily_seed_lo(dayIndex) >>> 0);
    const hi = BigInt(this.x.daily_seed_hi(dayIndex) >>> 0);
    return (hi << 32n) | lo;
  }

  /** Release the held fruit at `x`, at `tick`. */
  drop(tick: number, x: number): DropStatus {
    return STATUS[this.x.drop_at(tick, x)] ?? "no-game";
  }

  /** Advance to `tick` without dropping. */
  waitUntil(tick: number): DropStatus {
    return STATUS[this.x.wait_until(tick)] ?? "no-game";
  }

  /** The whole visible state, in one read. */
  world(): WorldView | null {
    const text = this.read(this.x.world_json());
    return text === "null" ? null : (JSON.parse(text) as WorldView);
  }

  /** The canonical state hash. */
  hash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }

  /** The running score. */
  score(): number {
    return this.x.score();
  }

  /** Whether the run has ended. */
  isOver(): boolean {
    return this.x.is_over() === 1;
  }

  /** The current tick. */
  tick(): number {
    return this.x.tick();
  }

  /** How many tiers the ladder has, read from the core rather than hardcoded. */
  ladderTiers(): number {
    return this.x.ladder_tiers();
  }

  /** The run's `pond-outcome` record, as a JSON string ready to share. */
  record(): string | null {
    const text = this.read(this.x.record_json());
    return text === "null" ? null : text;
  }

  /** Re-verify a record by replay. Never trusts a stored field. */
  verify(recordJson: string): VerifyResult {
    const bytes = new TextEncoder().encode(recordJson);
    new Uint8Array(this.x.memory.buffer).set(bytes, SCRATCH);
    return JSON.parse(this.read(this.x.verify_json(SCRATCH, bytes.length))) as VerifyResult;
  }

  /** The state hash at tick `n` — the divergence bisect. */
  tickDigest(n: number): string {
    return JSON.parse(this.read(this.x.tick_digest(n))) as string;
  }
}
