//! Pure outcome/verify/share logic for Drop 4 — no DOM. The verifiable claim:
//! "on seed X this alternating column sequence reached this result" — replay the
//! columns through the core and re-derive the hash; nothing is trusted. A match
//! records **both** sides' drops in one list, so the replay reproduces the final
//! board regardless of who chose each move (the verifiable-outcome property).

import { decodeShare, encodeShare } from "../share.js";

/** Result from Side A's (the human / opening player's) perspective. */
export type Drop4Result = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for Drop 4 as it crosses the boundary. */
export interface Drop4Record {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The columns played (alternating A/B) — the proof, replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = Side A won; `Lost` = Side B won or a draw; `Abandoned` = unfinished. */
  result: Drop4Result;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`Drop4Record`]. */
export interface Drop4Envelope {
  kind: string;
  version: number;
  payload: Drop4Record;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Drop4` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(col: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number;
}

/** Encode a Drop 4 outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: Drop4Envelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a Drop 4 outcome envelope. */
export async function decodeRecord(payload: string): Promise<Drop4Envelope> {
  return decodeShare<Drop4Envelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, columns)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A `Won` record must
 * re-reach a Side-A win; a `Lost` record must re-reach a Side-B win or a draw.
 */
export function verifyRecord(v: Verifier, env: Drop4Envelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const col of rec.moves) v.play(col);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
