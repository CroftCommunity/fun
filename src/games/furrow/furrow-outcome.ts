//! Pure outcome/verify/share logic for Furrow — no DOM. The verifiable claim:
//! "on seed X this sequence of sown pits reached this result" — replay the moves
//! through the core and re-derive the hash; nothing stored is trusted.
//!
//! A move is a plain **absolute cell index**, so unlike Othello (which needs a
//! pass code) and checkers (which packs a jump chain) nothing is encoded. Two
//! things to know reading a record:
//!
//! - The move list is **not** alternating: a move that landed in the mover's own
//!   store was followed by another from the same side.
//! - A store index (6 or 13) can never legally appear, which makes one whole
//!   class of forgery detectable by inspection as well as by replay.

import { decodeShare, encodeShare } from "../share.js";

/** Result from Side A's (the opening player's) perspective. */
export type FurrowResult = "Won" | "Lost" | "Abandoned";

/** A `pond_outcome::Record` for Furrow as it crosses the boundary. */
export interface FurrowRecord {
  kind: string;
  /** The RNG seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The sown pits in play order — both sides, replayed for the hash. */
  moves: number[];
  move_count: number;
  final_hash: string;
  /** `Won` = Side A won; `Lost` = Side B won or the game was drawn. */
  result: FurrowResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`FurrowRecord`]. */
export interface FurrowEnvelope {
  kind: string;
  version: number;
  payload: FurrowRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Furrow` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  play(pit: number): unknown;
  currentHash(): string;
  /** -1 ongoing, 0 draw, 1 A won, 2 B won. */
  resultCode(): number;
}

/** Encode a Furrow outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: FurrowEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a Furrow outcome envelope. */
export async function decodeRecord(payload: string): Promise<FurrowEnvelope> {
  return decodeShare<FurrowEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. An illegal move replays as
 * a no-op, so a forged list diverges.
 *
 * A `Won` record must re-reach a Side-A win; a `Lost` record a Side-B win **or a
 * draw**. Unlike dots, where nine boxes could not split and the draw arm was
 * unreachable, 24–24 is a real outcome of real play here — so that arm is doing
 * work rather than stating a rule for completeness.
 */
export function verifyRecord(v: Verifier, env: FurrowEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const pit of rec.moves) v.play(pit);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const code = v.resultCode();
  const resultOk =
    rec.result === "Won" ? code === 1 : rec.result === "Lost" ? code === 2 || code === 0 : true;
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
