//! Pure outcome/verify/share logic for Orchard Drop — no DOM.
//!
//! The verifiable claim: **"on seed X this sequence of drops reached score S."**
//! Replay the moves, re-derive the hash and the score; nothing stored is
//! trusted, including the score itself.
//!
//! Unlike the other games' outcome modules, the replay happens in **Rust**: the
//! binding exposes `verify_json`, so the record is re-derived by the same core
//! that produced it rather than by a TypeScript re-implementation that could
//! drift from it. This module's job is the envelope and the share URL.

import { decodeShare, encodeShare } from "../share.js";
import type { OrchardDrop, VerifyResult } from "./orchard-wasm.js";

/** How an Orchard Drop run ended. An endless score-chase: never "Stuck". */
export type OrchardResult = "Won" | "Lost" | "Abandoned";

/** One recorded action. Mirrors `orchard_core::game::Move`. */
export type OrchardMove = { Drop: { tick: number; x: number } } | { Wait: { tick: number } };

/** A `pond_outcome::Record` for Orchard Drop as it crosses the boundary. */
export interface OrchardRecord {
  kind: string;
  /** The run's seed. */
  seed: number;
  /** The drops and the final wait — the proof, replayed to re-derive the hash. */
  moves: OrchardMove[];
  move_count: number;
  final_hash: string;
  /** `Won` means a watermelon was grown; the score carries the real result. */
  result: OrchardResult;
  assistance: boolean | null;
  /** Final score. */
  score?: number;
}

/** A `pond-docformat` envelope wrapping an [`OrchardRecord`]. */
export interface OrchardEnvelope {
  kind: string;
  version: number;
  payload: OrchardRecord;
}

/** Wrap a record in the shelf's document envelope. */
export function envelope(record: OrchardRecord): OrchardEnvelope {
  return { kind: "orchard-drop-outcome", version: 1, payload: record };
}

/** Encode an outcome envelope as the `?r=` share payload (deflated). */
export async function encodeRecord(env: OrchardEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into an outcome envelope. */
export async function decodeRecord(payload: string): Promise<OrchardEnvelope> {
  return decodeShare<OrchardEnvelope>(payload);
}

/**
 * Re-verify a record by replay, through the core.
 *
 * The score is checked as well as the hash: a shared claim of "N points" is
 * only accepted when the replay reproduces it. Verifying the hash alone would
 * let a record carry an honest board and a dishonest number.
 */
export function verifyRecord(binding: OrchardDrop, env: OrchardEnvelope): VerifyResult {
  return binding.verify(JSON.stringify(env.payload));
}

/** How many drops a record contains — the moves-to-score metric. */
export function dropCount(record: OrchardRecord): number {
  return record.moves.filter((m) => "Drop" in m).length;
}

/**
 * The headline for a finished run.
 *
 * A verified record leads with what was proven; an unverified one says so
 * plainly rather than showing a number it cannot stand behind.
 */
export function headline(env: OrchardEnvelope, v: VerifyResult): string {
  if (!v.ok) return "This record did not verify.";
  const score = env.payload.score ?? 0;
  if (env.payload.result === "Won") return `Watermelon grown — ${score} points, verified.`;
  return `${score} points, verified.`;
}

/** The best score this browser has seen, degrading quietly when storage is blocked. */
const BEST_KEY = "fun-orchard-drop-best";

/** Read the stored best score. */
export function bestScore(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

/** Record a score if it beats the stored best, returning the best afterwards. */
export function recordBest(score: number): number {
  const prev = bestScore();
  if (score <= prev) return prev;
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage blocked. The run still stands; only the memory of it is lost —
    // which is a far better failure than refusing to record the score at all.
  }
  return score;
}
