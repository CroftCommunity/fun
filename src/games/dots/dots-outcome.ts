//! Pure outcome/verify/share logic for Dots and Boxes — no DOM. The verifiable
//! claim: "on seed X this sequence of drawn edges reached this result" — replay
//! the moves through the core and re-derive the hash; nothing stored is trusted.
//!
//! A move is a plain edge number `0..23`, so unlike Othello (which needs a pass
//! code) and checkers (which packs a jump chain) nothing is encoded. The one
//! thing to know reading a record is that the move list is **not** alternating:
//! a move that closed a box was followed by another from the same side.

import { decodeShare, encodeShare } from "../share.js";

/** Result from Side A's (the opening player's) perspective. */
export type DotsResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for Dots and Boxes as it crosses the boundary. */
export interface DotsRecord {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The drawn edges in play order — both sides, replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = Side A won; `Lost` = Side B won (or the unreachable draw). */
  result: DotsResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`DotsRecord`]. */
export interface DotsEnvelope {
  kind: string;
  version: number;
  payload: DotsRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Dots` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(edge: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number;
}

/** Encode a Dots outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: DotsEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a Dots outcome envelope. */
export async function decodeRecord(payload: string): Promise<DotsEnvelope> {
  return decodeShare<DotsEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. An illegal move replays as
 * a no-op, so a forged list diverges. A `Won` record must re-reach a Side-A win;
 * a `Lost` record a Side-B win (the draw arm is unreachable at nine boxes, but
 * the check states the rule rather than the board size).
 */
export function verifyRecord(v: Verifier, env: DotsEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const edge of rec.moves) v.play(edge);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
