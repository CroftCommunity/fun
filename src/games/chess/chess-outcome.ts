//! Pure outcome/verify/share logic for chess — no DOM. The verifiable claim:
//! "on seed X this move sequence reached this result" — replay the moves
//! through the core and re-derive the hash; nothing is trusted.
//!
//! A chess move's wire code is the packed `(from | to << 6 | promo << 12)`
//! integer — 15 bits, still a plain JSON number, so the share format is the
//! same `number[]` every shelf game carries. There is no pass code.
//!
//! One property is chess's own: the core's replay **poisons** on a move that
//! is not legal where it stands (a tampered move, or one appended after the
//! terminal), so a padded record fails verification instead of quietly
//! replaying to the honest hash. The wrapper sees that as a hash mismatch.

import { decodeShare, encodeShare } from "../share.js";

/** Result from Side A's (White's) perspective. */
export type ChessResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for chess as it crosses the boundary. */
export interface ChessRecord {
  kind: string;
  /** The seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The packed move codes — replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = White won; `Lost` = Black won or a draw; `Abandoned` = unfinished. */
  result: ChessResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`ChessRecord`]. */
export interface ChessEnvelope {
  kind: string;
  version: number;
  payload: ChessRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (`Chess` satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(code: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 White won, 2 Black won. */
  resultCode(): number;
}

/** Encode a chess outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: ChessEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a chess outcome envelope. */
export async function decodeRecord(payload: string): Promise<ChessEnvelope> {
  return decodeShare<ChessEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A tampered move is
 * refused by the core (it is not legal there), so the replay stops short and
 * the hash diverges; a truncated list diverges too; a move appended after the
 * terminal is refused (status "over") and the count of applied moves falls
 * short of the record's. A `Won` record must re-reach a White win; a `Lost`
 * record a Black win or a draw. Never throws on a bad code — the binding
 * answers "over" for anything structurally invalid.
 */
export function verifyRecord(v: Verifier, env: ChessEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  let applied = 0;
  for (const code of rec.moves) {
    if (v.play(code) === "applied") applied += 1;
  }
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash && applied === rec.moves.length;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}

/** The human-facing label for a finished game, from the human's seat. */
export function resultLabel(code: number, humanIsWhite: boolean): string {
  if (code === 0) return "Draw";
  if (code === -1) return "In progress";
  const humanWon = (code === 1) === humanIsWhite;
  return humanWon ? "You won" : "The Engine won";
}
