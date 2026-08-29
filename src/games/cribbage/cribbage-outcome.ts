//! Pure outcome/verify/share logic for cribbage — no DOM. The verifiable claim:
//! "from seed X this move list reached this result" — replay the moves through
//! the core and re-derive the hash; nothing stored is trusted.
//!
//! Three things to know reading a record:
//!
//! - The seed reshuffles **every deal**, so the deals are part of the proof.
//! - The list holds both seats' moves in play order — discards, plays, gos and
//!   **claims** (the show is three `32 + n` codes per deal). A record made with
//!   manual counting off and one made with it on have the same shape.
//! - `score` is the game's value: 1, 2 for a skunk, 3 for a double skunk. It
//!   is re-derived by replay like everything else.

import { decodeShare, encodeShare } from "../share.js";

/** Result from the human's (seat A's) perspective. */
export type CribbageResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for cribbage as it crosses the boundary. */
export interface CribbageRecord {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** Move codes in play order — both seats, replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = you (seat A) won; `Lost` = the engine won; `Abandoned` = unfinished. */
  result: CribbageResult;
  assistance: boolean | null;
  /** The game's value once over: 1, 2 (skunk) or 3 (double skunk). */
  score?: number;
}

/** A `pond-docformat` envelope wrapping a [`CribbageRecord`]. */
export interface CribbageEnvelope {
  kind: string;
  version: number;
  payload: CribbageRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Cribbage` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(code: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 1 you won, 2 the engine won. */
  resultCode(): number;
}

/** Encode a cribbage outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: CribbageEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a cribbage outcome envelope. */
export async function decodeRecord(payload: string): Promise<CribbageEnvelope> {
  return decodeShare<CribbageEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A refused move replays as
 * a no-op, so a forged list diverges. A `Won` record must re-reach a seat-A
 * win; a `Lost` record a seat-B win.
 */
export function verifyRecord(v: Verifier, env: CribbageEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const code of rec.moves) v.play(code);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk = rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
