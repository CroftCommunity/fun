//! Pure outcome/verify/share logic for Mahjong — no DOM. The verifiable claim:
//! "the deal from packed origin X was cleared by this move list" — replay the
//! codes (pairs and shuffles) and re-derive the state hash; nothing is trusted.

import { decodeShare, encodeShare } from "../share.js";

export type MahjongResult = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for Mahjong as it crosses the boundary. */
export interface MahjongRecord {
  kind: string;
  /** The packed origin (`layout << 32 | seed`, < 2^40 — an exact JS integer). */
  seed: number;
  /** Move codes — the proof, replayed to re-derive the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  result: MahjongResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`MahjongRecord`]. */
export interface MahjongEnvelope {
  kind: string;
  version: number;
  payload: MahjongRecord;
}

export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface `verifyRecord` drives (the `Mahjong` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  playCode(code: number): unknown;
  currentHash(): string;
  isWon(): boolean;
}

export async function encodeRecord(env: MahjongEnvelope): Promise<string> {
  return encodeShare(env);
}

export async function decodeRecord(payload: string): Promise<MahjongEnvelope> {
  return decodeShare<MahjongEnvelope>(payload);
}

/** Re-verify by replay — never trusts the stored hash; a `Won` record must replay to a clear. */
export function verifyRecord(v: Verifier, env: MahjongEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const code of rec.moves) v.playCode(code);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
