//! Typed TS wrapper over the `othello-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and the
//! AI harness. The wasm holds the match; this wrapper never re-implements rules
//! (legality, flips, forced passes, win/draw, and the oracle all come from the
//! core + solver). Mirrors `Drop4`.

/** Side to move / disc owner: 1 = A (Black, opens), 2 = B (White). */
export type SideCode = 1 | 2;

/** The board as the UI / harness sees it. */
export interface BoardView {
  size: number;
  /** Row-major rows, row 0 = top. 0 empty, 1 = A/Black, 2 = B/White. */
  cells: number[][];
  /** Side to move. */
  toMove: SideCode;
  /** Legal placement cell indices. */
  legal: number[];
  /** True when the side to move has no placement but the game is live (auto-pass). */
  mustPass: boolean;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  result: -1 | 0 | 1 | 2;
}

/** One legal placement and its engine value (higher = better for side to move). */
export interface MoveValue {
  col: number;
  value: number;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal placement. `exact` says whether the
 * facts are provably right (deep endgame) or horizon-approximate (heuristic),
 * so the UI can be honest. `immediateWin`/`blocksOpponentWin` are always false
 * for Othello (carried for structural compatibility with the shared harness
 * `TutorFactMove`); `takesCorner` is Othello's one-ply fact.
 */
export interface MoveAssessment {
  col: number;
  value: number;
  bestValue: number;
  regret: number;
  quality: MoveQuality;
  immediateWin: boolean;
  blocksOpponentWin: boolean;
  takesCorner: boolean;
  exact: boolean;
}

/** The current position's whole-position tutor report. */
export interface TutorReport {
  /** One assessment per legal placement; empty if terminal or a forced pass. */
  moves: MoveAssessment[];
  /** The best cell (first, if several tie), or null if nothing to assess. */
  bestCol: number | null;
  /** True when the facts are provably exact; false when horizon-approximate. */
  exact: boolean;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty level codes. */
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Expert: 3 };

/** The `live_move` / `oracle_best` sentinels. */
const MOVE_OVER = 0xffff_ffff;
const MOVE_PASS = 0xffff_fffe;

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  result_code(): number;
  render_text(): number;
  play(idx: number): number;
  pass(): number;
  live_move(level: number): number;
  oracle_best(level: number): number;
  oracle_move_values_json(): number;
  assess_json(idx: number): number;
  tutor_json(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Othello binding bound to one match. */
export class Othello {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/othello.wasm"): Promise<Othello> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Othello(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  legalMoves(): number[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as number[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** A human/LLM-readable rendering of the board + whose turn. */
  renderText(): string {
    return JSON.parse(this.read(this.x.render_text())) as string;
  }
  /** Place a disc at cell `idx` for the side to move. */
  play(idx: number): MoveStatus {
    return STATUS[this.x.play(idx)]!;
  }
  /** Pass for the side to move (only legal when it has no placement). */
  pass(): MoveStatus {
    return STATUS[this.x.pass()]!;
  }
  /**
   * The **live** (shipped) opponent's move at `level`: a cell index to place,
   * `"pass"` if forced to pass, or `null` if the match is over.
   */
  liveMove(level: Level): number | "pass" | null {
    return this.decodeMove(this.x.live_move(LEVEL_CODE[level]));
  }
  /** The analysis oracle's best move (strongest level): index / `"pass"` / null. */
  oracleBest(level: Level): number | "pass" | null {
    return this.decodeMove(this.x.oracle_best(LEVEL_CODE[level]));
  }
  private decodeMove(code: number): number | "pass" | null {
    if (code === MOVE_OVER) return null;
    if (code === MOVE_PASS) return "pass";
    return code;
  }
  /** The engine value of every legal placement — the source for a difficulty band. */
  oracleMoveValues(): MoveValue[] {
    return JSON.parse(this.read(this.x.oracle_move_values_json())) as MoveValue[];
  }
  /**
   * Engine-grounded assessment of the candidate placement `idx` at the current
   * position, or `null` if there is no game or `idx` is not a legal placement.
   */
  assess(idx: number): MoveAssessment | null {
    return JSON.parse(this.read(this.x.assess_json(idx))) as MoveAssessment | null;
  }
  /** The current position's whole-position tutor report. */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /** Record that a hint was used this match (assistance). */
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The verifiable `pond-outcome` record envelope for the current match. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
