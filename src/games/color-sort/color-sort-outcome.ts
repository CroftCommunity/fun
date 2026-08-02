//! Pure outcome/verify/share logic for Color Sort — no DOM. The verifiable claim:
//! "the puzzle dealt from packed seed X was solved by this pour sequence" —
//! replay the pours and re-derive the state hash; nothing is trusted.

import { decodeShare, encodeShare } from "../share.js";
import type { Move } from "./color-sort-wasm.js";

export type ColorSortResult = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for Color Sort as it crosses the boundary. */
export interface ColorSortRecord {
  kind: string;
  /** The packed deal seed (< 2^52, so JSON round-trips it exactly). */
  seed: number;
  /** The pours played — the proof, replayed to re-derive the hash. */
  moves: Move[];
  move_count: number;
  final_hash: string;
  result: ColorSortResult;
  /** Self-declared assistance (undo/hints): `false` none, `true` declared, `null` opted out. */
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`ColorSortRecord`]. */
export interface ColorSortEnvelope {
  kind: string;
  version: number;
  payload: ColorSortRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `ColorSort` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(move: Move): unknown;
  currentHash(): string;
  isWon(): boolean;
}

/** Encode a Color Sort outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: ColorSortEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a Color Sort outcome envelope. */
export async function decodeRecord(payload: string): Promise<ColorSortEnvelope> {
  return decodeShare<ColorSortEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A `Won` record must also
 * actually be a win after replay.
 */
export function verifyRecord(v: Verifier, env: ColorSortEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const mv of rec.moves) v.play(mv);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
