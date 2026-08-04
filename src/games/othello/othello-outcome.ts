//! Pure outcome/verify/share logic for Othello — no DOM. The verifiable claim:
//! "on seed X this alternating move sequence reached this result" — replay the
//! moves through the core and re-derive the hash; nothing is trusted. Moves are
//! compact `u8` codes: `0..63` a placement cell, `64` a pass — so a match with
//! forced passes replays exactly (the verifiable-outcome property).

import { decodeShare, encodeShare } from "../share.js";

/** The `u8` code a pass serializes to (placements are their cell index `0..63`). */
export const PASS_CODE = 64;

/** Result from Side A's (the human / opening player's) perspective. */
export type OthelloResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for Othello as it crosses the boundary. */
export interface OthelloRecord {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The moves (compact codes: 0..63 placement, 64 pass) — replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = Side A won; `Lost` = Side B won or a draw; `Abandoned` = unfinished. */
  result: OthelloResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping an [`OthelloRecord`]. */
export interface OthelloEnvelope {
  kind: string;
  version: number;
  payload: OthelloRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Othello` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(idx: number): unknown;
  pass(): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number;
}

/** Encode an Othello outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: OthelloEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into an Othello outcome envelope. */
export async function decodeRecord(payload: string): Promise<OthelloEnvelope> {
  return decodeShare<OthelloEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A move code of
 * {@link PASS_CODE} replays as a pass; every other code as a placement. A `Won`
 * record must re-reach a Side-A win; a `Lost` record a Side-B win or a draw.
 */
export function verifyRecord(v: Verifier, env: OthelloEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const code of rec.moves) {
    if (code === PASS_CODE) v.pass();
    else v.play(code);
  }
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
