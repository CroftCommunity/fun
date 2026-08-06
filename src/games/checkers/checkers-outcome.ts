//! Pure outcome/verify/share logic for checkers — no DOM. The verifiable claim:
//! "on seed X this alternating move sequence reached this result" — replay the
//! moves through the core and re-derive the hash; nothing is trusted.
//!
//! A checkers move is a **path**, so its wire code is the packed
//! `(from | to << 5 | variant << 10)` integer — the shelf's first move code
//! above 255. It is still a plain JSON number, which is what keeps the share
//! format identical to every other game's (`number[]`) and lets the harness type
//! moves as `number`. There is no pass code: checkers has no pass, and no legal
//! move is a loss.

import { decodeShare, encodeShare } from "../share.js";

/** Result from Side A's (the human / opening player's) perspective. */
export type CheckersResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for checkers as it crosses the boundary. */
export interface CheckersRecord {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The packed move codes — replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = Side A won; `Lost` = Side B won or a draw; `Abandoned` = unfinished. */
  result: CheckersResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`CheckersRecord`]. */
export interface CheckersEnvelope {
  kind: string;
  version: number;
  payload: CheckersRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (`Checkers` satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(code: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number;
}

/** Encode a checkers outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: CheckersEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a checkers outcome envelope. */
export async function decodeRecord(payload: string): Promise<CheckersEnvelope> {
  return decodeShare<CheckersEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A tampered move is either
 * rejected by the core (it is not legal there) or applies and diverges the
 * hash; either way the replay does not reach the claimed state. A `Won` record
 * must re-reach a Side-A win; a `Lost` record a Side-B win or a draw.
 */
export function verifyRecord(v: Verifier, env: CheckersEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const code of rec.moves) v.play(code);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
