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
  /** The on-deck colour — the next-piece preview. */
  nextColor: number;
  score: number;
  shotsLeft: number;
  shotBudget: number;
  /** Whether the board is cleared (the objective is met). */
  cleared: boolean;
}

/** The levels-mode board + escalation state as the UI sees it. Endless survival:
 *  earn `targetScore` to advance the `level` while periodic inserts push the
 *  stack toward the deadline. */
export interface LevelBoardView {
  width: number;
  height: number;
  /** Row-parity offset (0/1): row `r` is full when `(r + parityOffset)` is even.
   *  The UI staggers each row's half-cell indent from this (it flips on inserts). */
  parityOffset: number;
  cells: number[][];
  currentColor: number;
  nextColor: number;
  /** Current level (starts at 1). */
  level: number;
  /** Points earned toward the current level's target. */
  levelScore: number;
  /** Cumulative score across the run (the shared metric). */
  totalScore: number;
  /** Points required to clear the current level. */
  targetScore: number;
  /** Colours in play at the current level. */
  colors: number;
  /** Shots remaining until the next top-row insert. */
  shotsToInsert: number;
  /** Reserved bottom deadline rows (a bubble here ends the run). */
  deadlineRows: number;
  /** Presentational per-level clock in seconds — a UI-only countdown, never a
   *  verified loss. */
  timeLimitSecs: number;
  /** Whether the run has ended (a bubble crossed the deadline). */
  lost: boolean;
  /** Whether the most recent shot pushed in a new top row (slide animation). */
  lastInserted: boolean;
}

/** The most recent levels shot's removed cells + whether a row was inserted. */
export interface LevelLastShot {
  popped: RemovedCell[];
  dropped: RemovedCell[];
  inserted: boolean;
}

/** A landing cell: `[row, col]`. */
export type Cell = [number, number];

/** A removed cell for the resolution animation: `[row, col, colour]`. */
export type RemovedCell = [number, number, number];

/** The most recent shot's removed cells, so the UI can animate the resolution
 *  (popped bubbles burst, orphaned bubbles fall) before re-rendering. */
export interface LastShot {
  popped: RemovedCell[];
  dropped: RemovedCell[];
}

/** A resolved aim trajectory: the fixed-point flight-path vertices (launcher →
 *  wall bounces → stop, `[x, y]` in the core's sub-pixel space) and the landing
 *  cell. The UI draws the preview along `points` and animates to `landing`. */
export interface Trajectory {
  points: [number, number][];
  landing: Cell;
}

/** The core's fixed sub-pixel geometry and legal aim fan — one source of truth
 *  for the canvas layout and the angle control's range. */
export interface Geom {
  diam: number;
  radius: number;
  rowH: number;
  fanLo: number;
  fanHi: number;
}

/** Shot application status (`applied`, or `bad` = no game / budget spent). */
export type ShotStatus = "applied" | "bad";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  bubble_daily_seed(day_index: number): number;
  board_json(): number;
  geom_json(): number;
  trajectory_json(angle: number): number;
  last_shot_json(): number;
  current_hash(): number;
  score(): number;
  shots_left(): number;
  current_color(): number;
  next_color(): number;
  is_cleared(): number;
  shoot(angle: number): number;
  hint_angle(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
  // levels mode
  new_level_game(lo: number, hi: number): void;
  level_board_json(): number;
  level_trajectory_json(angle: number): number;
  level_last_shot_json(): number;
  level_shoot(angle: number): number;
  level_hint_angle(): number;
  level_mark_assistance(): void;
  level_is_lost(): number;
  level_outcome_json(declare: number): number;
}

const STATUS: Record<number, ShotStatus> = { 0: "applied", 2: "bad" };

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
  /** The core geometry + aim fan (constant for the session). */
  geom(): Geom {
    return JSON.parse(this.read(this.x.geom_json())) as Geom;
  }
  /** A suggested aim angle (the best reachable pop, or the fan midpoint). A hint
   *  is assistance — call {@link markAssistance} when surfacing it. */
  hintAngle(): number {
    return this.x.hint_angle();
  }
  /** The resolved trajectory for aiming `angle` (whole degrees) — the flight
   *  path to preview and the landing cell the shot will stick to. The core owns
   *  both, so the animated bubble lands exactly where the shot resolves. */
  trajectory(angle: number): Trajectory {
    return JSON.parse(this.read(this.x.trajectory_json(angle))) as Trajectory;
  }
  /** The most recent shot's removed cells (`popped` burst, `dropped` fall). Read
   *  it right after {@link shoot} to animate the resolution before re-rendering;
   *  both lists are empty before the first shot. */
  lastShot(): LastShot {
    return JSON.parse(this.read(this.x.last_shot_json())) as LastShot;
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
  nextColor(): number {
    return this.x.next_color();
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

  /** Fire the current colour along `angle` (whole degrees). The core resolves
   *  the landing; a budget-spent shot (`bad`) leaves the board unchanged. */
  shoot(angle: number): ShotStatus {
    return STATUS[this.x.shoot(angle)]!;
  }

  // ---------- levels mode ----------

  /** Start a fresh levels-mode run (escalating, point-gated survival). */
  newLevelGame(seed: bigint): void {
    this.x.new_level_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** The levels board + level/score/pressure/timer state. */
  levelBoard(): LevelBoardView {
    return JSON.parse(this.read(this.x.level_board_json())) as LevelBoardView;
  }
  /** The resolved aim trajectory on the levels board. */
  levelTrajectory(angle: number): Trajectory {
    return JSON.parse(this.read(this.x.level_trajectory_json(angle))) as Trajectory;
  }
  /** The most recent levels shot's removed cells + whether a row was inserted. */
  levelLastShot(): LevelLastShot {
    return JSON.parse(this.read(this.x.level_last_shot_json())) as LevelLastShot;
  }
  /** A suggested aim angle for the levels board (assistance — declare it). */
  levelHintAngle(): number {
    return this.x.level_hint_angle();
  }
  levelMarkAssistance(): void {
    this.x.level_mark_assistance();
  }
  /** Whether the levels run has ended (a bubble crossed the deadline). */
  levelIsLost(): boolean {
    return this.x.level_is_lost() === 1;
  }
  levelOutcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.level_outcome_json(declareAssistance ? 1 : 0)));
  }
  /** Fire the current colour along `angle` in levels mode. */
  levelShoot(angle: number): ShotStatus {
    return STATUS[this.x.level_shoot(angle)]!;
  }
}
