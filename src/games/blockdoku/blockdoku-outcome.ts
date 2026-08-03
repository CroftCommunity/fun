//! Pure outcome/verify/share logic for Blockdoku — no DOM. The verifiable claim:
//! "on this config-packed seed, this sequence of placements reached score S and
//! ended stuck / at the move limit" — replay the moves and re-derive the hash and
//! score; nothing is trusted.

import { decodeShare, encodeShare } from "../share.js";
import type { MoveView } from "./blockdoku-wasm.js";

/** How a Blockdoku game ended (endless score-attack: never "Won"). */
export type BlockdokuResult = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for Blockdoku as it crosses the boundary. */
export interface BlockdokuRecord {
  kind: string;
  /** The config-packed deal seed (≤ Number.MAX_SAFE_INTEGER by construction). */
  seed: number;
  /** The placements played — the proof, replayed to re-derive the hash. */
  moves: MoveView[];
  move_count: number;
  final_hash: string;
  result: BlockdokuResult;
  assistance: boolean | null;
  /** Final score. */
  score?: number;
}

/** A `pond-docformat` envelope wrapping a [`BlockdokuRecord`]. */
export interface BlockdokuEnvelope {
  kind: string;
  version: number;
  payload: BlockdokuRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Blockdoku` wrapper satisfies it). */
export interface Verifier {
  newGamePacked(packed: bigint): void;
  playPlace(slot: number, row: number, col: number): unknown;
  currentHash(): string;
  board(): { score: number };
}

/** Encode a Blockdoku outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: BlockdokuEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a Blockdoku outcome envelope. */
export async function decodeRecord(payload: string): Promise<BlockdokuEnvelope> {
  return decodeShare<BlockdokuEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(packed seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. The score, when present, is
 * re-derived (a shared claim of "N points" is only accepted if the replay
 * reproduces it), never trusted.
 */
export function verifyRecord(v: Verifier, env: BlockdokuEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGamePacked(BigInt(rec.seed));
  for (const mv of rec.moves) v.playPlace(mv.slot, mv.row, mv.col);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const scoreOk = rec.score === undefined || rec.score === v.board().score;
  return { ok: hashOk && scoreOk, expected: rec.final_hash, actual };
}
