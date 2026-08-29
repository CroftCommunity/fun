//! Typed TS wrapper over the `cribbage-wasm` raw C-ABI binding. Loads the
//! wasm, decodes the output buffer, and presents a typed API to the board UI.
//! The wasm holds the game; this wrapper never re-implements rules — legality,
//! scoring, the go, the show order, the claim grading and the game's value all
//! come from the core.
//!
//! The one thing to know that no other wrapper on the shelf has to say: **there
//! is no `state()`**. `view()` is the human's view — its own cards, the table,
//! the count, and at the show each hand as it comes face up. The engine's hand
//! is not in any buffer this module reads, which is the binding's half of the
//! "never peeks" property (`crates/cribbage-wasm/src/lib.rs`).

import type { Verifier } from "./cribbage-outcome.js";

/** A card: rank 1 (ace) to 13 (king), suit 0..3 (♣ ♦ ♥ ♠), wire code 0..51. */
export interface CardView {
  rank: number;
  suit: number;
  code: number;
}

/** A hand's true score, broken down the way the show counts it. */
export interface HandBreakdown {
  fifteens: number;
  pairs: number;
  runs: number;
  flush: number;
  nobs: number;
  total: number;
}

/** A hand on the table at the show. */
export interface RevealedHand {
  step: "nonDealer" | "dealer" | "crib";
  /** 1 = you, 2 = the engine. */
  owner: 1 | 2;
  cards: CardView[];
  claimed: number | null;
  actual: HandBreakdown | null;
  muggins: number | null;
}

/** What the last move scored, for narration. */
export interface LastEvent {
  seat: 1 | 2;
  kind: "heels" | "peg" | "go" | "lastCard" | "claim";
  points: number;
  fifteen: number;
  thirtyOne: number;
  pairs: number;
  run: number;
  claimed: number | null;
  actual: HandBreakdown | null;
  muggins: number | null;
}

/** The phase, as the binding names it. */
export type Phase = "discard" | "peg" | "showNonDealer" | "showDealer" | "showCrib" | "over";

/** The human's view of the game. */
export interface UiView {
  /** 1 = you deal this deal, 2 = the engine. */
  dealer: 1 | 2;
  /** 1 = your move, 2 = the engine's. */
  toMove: 1 | 2;
  phase: Phase;
  dealNo: number;
  /** `[you, the engine]`. */
  scores: [number, number];
  /** Cards still in your hand. */
  hand: CardView[];
  /** The four you kept (empty until you have discarded). */
  kept: CardView[];
  cut: CardView | null;
  /** Cards since the count last reset, in play order. */
  stack: CardView[];
  count: number;
  /** Every card played this deal: `[seat, card]`. */
  played: [1 | 2, CardView][];
  opponentCards: number;
  /** How many cards are in the crib (0, 2 or 4) — never which. */
  cribCards: number;
  revealed: RevealedHand[];
  last: LastEvent | null;
  /** Legal move codes for the seat to move. */
  legal: number[];
  /** -1 ongoing, 1 you won, 2 the engine won. */
  result: -1 | 1 | 2;
  /** 1, 2 (skunk) or 3 (double skunk) once over; 0 before. */
  value: number;
}

/** One of your options, assessed by the engine. */
export interface Assessment {
  code: number;
  /** Expected points, hundredths. */
  expected: number;
  regret: number;
  quality: "best" | "close" | "loose" | "blunder";
  /** True for a discard verdict (exhaustive); false for pegging (a model). */
  exact: boolean;
  /** The coach's sentence, bound to `exact` in Rust. */
  line: string;
}

/** Your options assessed, best first. */
export interface TutorReport {
  moves: Assessment[];
  best: number | null;
  exact: boolean;
}

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "over";
const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "over" };

/** Opponent difficulty. Expert is exact-expectation discards and two-ply pegging. */
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
const LEVEL_CODE: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2, Expert: 3 };

/** Move codes (`crates/cribbage-core/RULES.md` → "Move codes"). */
export const GO_CODE = 20;
export const PLAY_BASE = 16;
export const CLAIM_BASE = 32;
/** The pair index for throwing hand positions `a < b` of six (lexicographic). */
export function discardCode(a: number, b: number): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return lo * 6 - (lo * (lo + 1)) / 2 + (hi - lo - 1);
}

/** The `live_move` / `auto_claim` "nothing" sentinel (`u32::MAX`). */
const MOVE_OVER = 0xffff_ffff;

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  view_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  result_code(): number;
  to_move(): number;
  play(code: number): number;
  live_move(level: number): number;
  auto_claim(): number;
  tutor_json(): number;
  assess_json(code: number): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

/** A loaded cribbage binding bound to one game. */
export class Cribbage implements Verifier {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/cribbage.wasm"): Promise<Cribbage> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Cribbage(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    return new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, ptr, len));
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** Your view — never the engine's cards. */
  view(): UiView {
    return JSON.parse(this.read(this.x.view_json())) as UiView;
  }
  legalMoves(): number[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as number[];
  }
  /** The canonical state hash — raw UTF-8. */
  currentHash(): string {
    return this.read(this.x.current_hash());
  }
  /** -1 ongoing, 1 you won, 2 the engine won. */
  resultCode(): number {
    return this.x.result_code();
  }
  /** 1 = you, 2 = the engine, 0 with no game. */
  toMove(): number {
    return this.x.to_move();
  }
  /** Play a move code for the seat to move. */
  play(code: number): MoveStatus {
    return STATUS[this.x.play(code)]!;
  }
  /** The engine's move for the seat to move, or null when there is none. */
  liveMove(level: Level): number | null {
    const code = this.x.live_move(LEVEL_CODE[level]);
    return code >>> 0 === MOVE_OVER ? null : code;
  }
  /** The exact claim code for the hand on the table, or null off the show. */
  autoClaim(): number | null {
    const code = this.x.auto_claim();
    return code >>> 0 === MOVE_OVER ? null : code;
  }
  /** Assess one of your candidate moves, or null if it is not an option. */
  assess(code: number): Assessment | null {
    return JSON.parse(this.read(this.x.assess_json(code))) as Assessment | null;
  }
  /** Your options assessed, best first. */
  tutor(): TutorReport {
    return JSON.parse(this.read(this.x.tutor_json())) as TutorReport;
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  /** The verifiable `pond-outcome` record envelope for the current game. */
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }
}
