//! Typed TS wrapper over the `chess-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI and the
//! AI harness. The wasm holds the game; this wrapper never re-implements rules —
//! legality, castling, en passant, promotion, the draws and the oracle all come
//! from the core + solver. Mirrors `Checkers` / `Othello` / `Drop4`.
//!
//! Two shapes are chess's own. `board().legal` carries each move's `from`,
//! `to` and `promo` unpacked from the 15-bit code, so a promotion square shows
//! up as four entries the picker chooses among and the UI never re-derives the
//! code layout. And the oracle/tutor reports carry the **depth actually
//! reached and the nodes consumed** — chess is the first shelf engine to ship
//! a deepening search, so a named level's depth is a ceiling, not a promise.

/** Side to move / piece owner: 1 = White (Side A, opens), 2 = Black (Side B). */
export type SideCode = 1 | 2;

/**
 * One legal move, unpacked. `code` is the packed `(from | to << 6 | promo <<
 * 12)` wire code `play` takes — 15 bits, still a plain JSON number.
 */
export interface LegalMove {
  code: number;
  /** 0-based origin square, a1 = 0 … h8 = 63. */
  from: number;
  /** 0-based destination square. */
  to: number;
  /** 0 none; 1 knight, 2 bishop, 3 rook, 4 queen. */
  promo: number;
}

/** The board as the UI / harness sees it. */
export interface BoardView {
  /** 64 cells, a1 = index 0: 0 empty, 1–6 white P N B R Q K, 9–14 black. */
  cells: number[];
  toMove: SideCode;
  /** Castling rights bits: K = 1, Q = 2, k = 4, q = 8. */
  castling: number;
  /** The en-passant square, or null. */
  ep: number | null;
  /** Plies since the last pawn move or capture; the game is drawn at 100. */
  halfmove: number;
  fullmove: number;
  /** Whether the side to move is in check. */
  inCheck: boolean;
  /** The last move's code, or null before the first move. */
  lastMove: number | null;
  /** The last move in SAN ("Nf3+"), or null before the first move. */
  lastSan: string | null;
  /** Points of material each side has captured: [white, black]. */
  captured: [number, number];
  /** Every legal move, unpacked. Empty when the game is over. */
  legal: LegalMove[];
  /** -1 ongoing, 0 draw, 1 White won, 2 Black won. */
  result: -1 | 0 | 1 | 2;
}

/** One legal move and its engine value (higher = better for the side to move). */
export interface MoveValue {
  /** The packed move code. (Named `col` for the shared harness field.) */
  col: number;
  value: number;
}

/** The analysis oracle's values plus what the search actually did. */
export interface OracleValues {
  moves: MoveValue[];
  /** The depth the deepening search reached — a ceiling, not a promise. */
  depth: number;
  nodes: number;
}

/** A move's quality relative to the position's best move. */
export type MoveQuality = "optimal" | "resultPreserving" | "blunder";

/**
 * Engine-grounded assessment of one legal move. `exact` says whether this
 * move's value came from a **proven terminal** or a horizon judgement, so the
 * UI can be honest. A structural superset of the shared harness
 * `TutorFactMove`; the chess-specific one-ply facts follow.
 */
export interface MoveAssessment {
  col: number;
  /** The move in SAN — what a player reads. */
  san: string;
  value: number;
  bestValue: number;
  regret: number;
  quality: MoveQuality;
  /** This move mates on the spot. */
  immediateWin: boolean;
  /** Always false for chess (carried for the shared shape). */
  blocksOpponentWin: boolean;
  givesCheck: boolean;
  /** The captured piece kind: 0 none; 1–6 P N B R Q K. */
  captures: number;
  /** The promotion piece code: 0 none; 1–4 N B R Q. */
  promotes: number;
  castles: boolean;
  exact: boolean;
}

/** The current position's whole-position tutor report. */
export interface TutorReport {
  /** One assessment per legal move; empty if terminal. */
  moves: MoveAssessment[];
  /** The best move code (first, if several tie), or null if nothing to assess. */
  bestCol: number | null;
  /** True only when **every** move in the report is proven. */
  exact: boolean;
  /** The depth the search reached and the nodes it consumed. */
  depth: number;
  nodes: number;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty levels. */
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
export const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Expert: 3 };

/** The `live_move` / `oracle_best` "no move" sentinel. */
const MOVE_OVER = 0xffff_ffff;

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  fen(): number;
  san_json(code: number): number;
  current_hash(): number;
  result_code(): number;
  render_text(): number;
  play(code: number): number;
  live_move(level: number): number;
  oracle_best(level: number): number;
  oracle_move_values_json(): number;
  assess_json(code: number): number;
  coach_json(): number;
  tutor_json(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded Chess binding bound to one game. */
export class Chess {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/chess.wasm"): Promise<Chess> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Chess(instance.exports as unknown as Exports);
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
  /** Every legal move, unpacked — the source for the tap-target glow and the picker. */
  legalMoveDetails(): LegalMove[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as LegalMove[];
  }
  /** The legal move codes only — what the `GameOracle` port speaks. */
  legalMoves(): number[] {
    return this.legalMoveDetails().map((m) => m.code);
  }
  /** The current position's FEN. */
  fen(): string {
    return JSON.parse(this.read(this.x.fen())) as string;
  }
  /** The SAN of a legal move not yet played (the Hint ring), or "" if not legal here. */
  san(code: number): string {
    return JSON.parse(this.read(this.x.san_json(code))) as string;
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  /** -1 ongoing, 0 draw, 1 White won, 2 Black won, -2 no game. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** A human/LLM-readable rendering of the board + whose turn. */
  renderText(): string {
    return JSON.parse(this.read(this.x.render_text())) as string;
  }
  /** Play the move named by the packed `code` for the side to move. */
  play(code: number): MoveStatus {
    return STATUS[this.x.play(code)]!;
  }
  /** The **live** (shipped) opponent's move at `level`, or null if the game is over. */
  liveMove(level: Level): number | null {
    return this.decodeMove(this.x.live_move(LEVEL_CODE[level]));
  }
  /** The analysis oracle's best move, or null if the game is over. */
  oracleBest(level: Level): number | null {
    return this.decodeMove(this.x.oracle_best(LEVEL_CODE[level]));
  }
  /**
   * The core returns the `u32` sentinel `MOVE_OVER`, but a wasm `i32` result
   * reaches JS **signed** — it arrives as `-1`, so the unsigned coercion is
   * what makes the comparison fire (`tests/wasm-move-sentinels.test.ts`).
   */
  private decodeMove(code: number): number | null {
    return (code >>> 0) === MOVE_OVER ? null : code;
  }
  /** The engine value of every legal move, with the depth/nodes the search reached. */
  oracleMoveValues(): OracleValues {
    return JSON.parse(this.read(this.x.oracle_move_values_json())) as OracleValues;
  }
  /**
   * Engine-grounded assessment of the candidate move `code` at the current
   * position (the analysis budget), or null if there is no game or `code` is
   * not a legal move.
   */
  assess(code: number): MoveAssessment | null {
    return JSON.parse(this.read(this.x.assess_json(code))) as MoveAssessment | null;
  }
  /**
   * The whole-position report at the **panel** budget — the deep search that
   * buys the proofs behind "that threw the game". Opened deliberately; never
   * on a tap. Use {@link coach} there.
   */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  /**
   * The same report at the **per-move coach** budget — cheap enough for the
   * tap path. It hedges more often than {@link tutor}; never less honestly.
   */
  coach(): TutorReport {
    return JSON.parse(this.read(this.x.coach_json())) as TutorReport;
  }
  /** Record that a hint or an undo was used this game (assistance). */
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The verifiable `pond-outcome` record envelope for the current game. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
