//! Pure outcome/verify/share logic for the bubble shooter — no DOM. The
//! verifiable claim: "on seed X I cleared the board (score S) with these shots"
//! — replay them and re-derive the hash; nothing is trusted. Shares the
//! deflate/base64url + daily helpers.

import { decodeShare, encodeShare } from "../share.js";

export type BubbleResult = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for the bubble shooter as it crosses the boundary. */
export interface BubbleRecord {
  kind: string;
  /** The deal seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The aim line (whole-degree angles) — the proof, replayed to re-derive the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  result: BubbleResult;
  assistance: boolean | null;
  /** Cumulative pop/drop score (surfaced as a secondary metric). */
  score?: number;
}

/** A `pond-docformat` envelope wrapping a [`BubbleRecord`]. */
export interface BubbleEnvelope {
  kind: string;
  version: number;
  payload: BubbleRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Bubble` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  shoot(angle: number): unknown;
  currentHash(): string;
  isCleared(): boolean;
  score(): number;
}

/** Encode a bubble outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: BubbleEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a bubble outcome envelope. */
export async function decodeRecord(payload: string): Promise<BubbleEnvelope> {
  return decodeShare<BubbleEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, shots)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A `Won` record must
 * re-clear the board; the score, when present, is re-derived (a shared claim of
 * "N points" is only accepted if the replay reproduces it), never trusted.
 */
export function verifyRecord(v: Verifier, env: BubbleEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const angle of rec.moves) v.shoot(angle);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isCleared();
  const scoreOk = rec.score === undefined || rec.score === v.score();
  return { ok: hashOk && resultOk && scoreOk, expected: rec.final_hash, actual };
}
