//! Pure outcome/verify/share logic for 2048 — no DOM. The verifiable claim: "on
//! seed X this sequence of slides reached score S (and, if won, the 2048 tile)"
//! — replay the directions and re-derive the hash; nothing is trusted.

import { decodeShare, encodeShare } from "../share.js";
import type { Direction } from "./2048-wasm.js";

export type Twenty48Result = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for 2048 as it crosses the boundary. */
export interface Twenty48Record {
  kind: string;
  /** The deal seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The directions played — the proof, replayed to re-derive the hash. */
  moves: Direction[];
  move_count: number;
  final_hash: string;
  result: Twenty48Result;
  assistance: boolean | null;
  /** Final score (sum of merge values). */
  score?: number;
}

/** A `pond-docformat` envelope wrapping a [`Twenty48Record`]. */
export interface Twenty48Envelope {
  kind: string;
  version: number;
  payload: Twenty48Record;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Twenty48` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  move(dir: Direction): unknown;
  currentHash(): string;
  isWon(): boolean;
  board(): { score: number };
}

/** Encode a 2048 outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: Twenty48Envelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a 2048 outcome envelope. */
export async function decodeRecord(payload: string): Promise<Twenty48Envelope> {
  return decodeShare<Twenty48Envelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, directions)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A `Won` record must
 * re-reach 2048; the score, when present, is re-derived (a shared claim of "N
 * points" is only accepted if the replay reproduces it), never trusted.
 */
export function verifyRecord(v: Verifier, env: Twenty48Envelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const dir of rec.moves) v.move(dir);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  const scoreOk = rec.score === undefined || rec.score === v.board().score;
  return { ok: hashOk && resultOk && scoreOk, expected: rec.final_hash, actual };
}
