//! Pure outcome/verify/share/daily logic for the solitaire front-end — no DOM.
//!
//! The verifiable clean-clear is the pond's whole point, so this module is kept
//! isolated and unit-tested: it never re-implements rules (verification replays
//! through the binding, the source of truth) and never trusts a stored hash.

import { decodeShare, encodeShare, dayIndexUTC } from "./share.js";
import type { SolMove } from "./solitaire-wasm.js";

export { dayIndexUTC } from "./share.js";

/** How a game ended, matching `pond_outcome::Outcome`. */
export type OutcomeResult = "Won" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` as it crosses the wasm boundary as JSON. */
export interface OutcomeRecord {
  kind: string;
  /** The deal seed. Kept within `Number.MAX_SAFE_INTEGER` so JSON round-trips exactly. */
  seed: number;
  moves: SolMove[];
  move_count: number;
  final_hash: string;
  result: OutcomeResult;
  /** Self-declared assistance: `false` none, `true` declared, `null` opted out. */
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping an [`OutcomeRecord`]. */
export interface OutcomeEnvelope {
  kind: string;
  version: number;
  payload: OutcomeRecord;
}

/** One winnable deal with its verified winning line (the pack's fixture). */
export interface PackEntry {
  seed: number;
  moves: SolMove[];
}

/**
 * The `deal-pack` `pond-docformat` document served as a static asset (v2,
 * seeds-lean): a year of winnable seeds the runtime indexes by date, plus one
 * `fixture` deal that keeps its line for the win-path E2E / guide.
 */
export interface DealPack {
  kind: string;
  version: number;
  payload: {
    seeds: number[];
    fixture: PackEntry;
  };
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  /** The hash stored in the record. */
  expected: string;
  /** The hash re-derived by replaying through the core. */
  actual: string;
}

/**
 * The minimal binding surface [`verifyRecord`] drives. `Solitaire` satisfies it
 * structurally; keeping it an interface lets verification run on any conforming
 * binding without re-implementing rules here.
 */
export interface Verifier {
  newGame(seed: bigint): void;
  play(move: SolMove): unknown;
  currentHash(): string;
  isWon(): boolean;
}

/** Encode an outcome envelope as the deflated base64url share payload (`?r=`). */
export async function encodeRecord(env: OutcomeEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a base64url share payload back into an outcome envelope. */
export async function decodeRecord(payload: string): Promise<OutcomeEnvelope> {
  return decodeShare<OutcomeEnvelope>(payload);
}

/** The seed for `now`'s daily deal: the UTC day index into the seed list (wrapping). */
export function dailySeed(pack: DealPack, now: Date): bigint {
  const { seeds } = pack.payload;
  return BigInt(seeds[dayIndexUTC(now) % seeds.length]!);
}

/**
 * Re-verify a record by replaying `(seed, moves)` through the binding and
 * re-hashing — the stored `final_hash` is never trusted. For a `Won` record the
 * replay must also actually win.
 */
export function verifyRecord(v: Verifier, env: OutcomeEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const move of rec.moves) v.play(move);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}
