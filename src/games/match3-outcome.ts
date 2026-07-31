//! Pure outcome/verify/share logic for match-3 — no DOM. The verifiable claim:
//! "on seed X I scored S (T stars) in these swaps" — replay them and re-derive
//! the score; nothing is trusted. Shares the deflate/base64url + daily helpers.

import { decodeShare, encodeShare } from "./share.js";
import type { Swap } from "./match3-wasm.js";

export type M3Result = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for match-3 as it crosses the wasm boundary. */
export interface M3Record {
  kind: string;
  /** The deal seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  moves: Swap[];
  move_count: number;
  final_hash: string;
  result: M3Result;
  assistance: boolean | null;
  score?: number;
  stars?: number;
}

/** A `pond-docformat` envelope wrapping an [`M3Record`]. */
export interface M3Envelope {
  kind: string;
  version: number;
  payload: M3Record;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The `pond-outcome` kinds for the win-objective modes. */
export const BLOCKERS_KIND = "match3-blockers";
export const JELLY_KIND = "match3-jelly";
export const INGREDIENTS_KIND = "match3-ingredients";

/** The minimal binding surface [`verifyRecord`] drives (the `Match3` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  newBlockersGame(seed: bigint): void;
  newJellyGame(seed: bigint): void;
  newIngredientsGame(seed: bigint): void;
  play(swap: Swap): unknown;
  currentHash(): string;
  isWon(): boolean;
  board(): { score: number; stars: number };
}

/** Encode a match-3 outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: M3Envelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a match-3 outcome envelope. */
export async function decodeRecord(payload: string): Promise<M3Envelope> {
  return decodeShare<M3Envelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, swaps)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. The mode is taken from the
 * envelope `kind`: target-score replays a normal deal (a `Won` record must
 * re-clear the 1★ target); clear-the-blockers replays a blocker deal (must
 * re-clear every blocker); clear-the-jelly replays a jelly deal (must scrub all
 * jelly). Score/stars, when present, are re-derived too, never trusted.
 */
export function verifyRecord(v: Verifier, env: M3Envelope): VerifyResult {
  const rec = env.payload;
  if (env.kind === BLOCKERS_KIND) v.newBlockersGame(BigInt(rec.seed));
  else if (env.kind === JELLY_KIND) v.newJellyGame(BigInt(rec.seed));
  else if (env.kind === INGREDIENTS_KIND) v.newIngredientsGame(BigInt(rec.seed));
  else v.newGame(BigInt(rec.seed));
  for (const swap of rec.moves) v.play(swap);
  const actual = v.currentHash();
  const board = v.board();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  // The score/stars are re-derived here, not trusted from the record — a shared
  // claim of "N points, T stars" is only accepted if the replay reproduces it.
  const scoreOk = rec.score === undefined || rec.score === board.score;
  const starsOk = rec.stars === undefined || rec.stars === board.stars;
  return { ok: hashOk && resultOk && scoreOk && starsOk, expected: rec.final_hash, actual };
}
