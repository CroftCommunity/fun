//! Pure outcome/verify/share logic for the daily word game — no DOM. The
//! verifiable claim: "on seed X I solved the word (or didn't) with these
//! guesses" — replay them and re-derive the hash; nothing is trusted. Two share
//! affordances: the spoiler-free emoji grid (the brag) and the verifiable `?r=`
//! record (which, by necessity, contains the guesses).

import { decodeShare, encodeShare } from "../share.js";
import type { Mark } from "./wyrdle-wasm.js";

export type WyrdleResult = "Won" | "Lost" | "Stuck" | "Abandoned";

/** A `pond_outcome::Record` for the word game as it crosses the boundary. */
export interface WyrdleRecord {
  kind: string;
  /** The deal seed (kept ≤ Number.MAX_SAFE_INTEGER for exact JSON round-trip). */
  seed: number;
  /** The guesses (words) — the proof, replayed to re-derive the hash. */
  moves: string[];
  move_count: number;
  final_hash: string;
  result: WyrdleResult;
  assistance: boolean | null;
}

/** A `pond-docformat` envelope wrapping a [`WyrdleRecord`]. */
export interface WyrdleEnvelope {
  kind: string;
  version: number;
  payload: WyrdleRecord;
}

/** The result of re-verifying a record by replay. */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** The minimal binding surface [`verifyRecord`] drives (the `Wyrdle` wrapper satisfies it). */
export interface Verifier {
  newGame(seed: bigint): void;
  guess(word: string): unknown;
  currentHash(): string;
  isWon(): boolean;
}

/** Encode a word-game outcome envelope as the `?r=` share payload. */
export async function encodeRecord(env: WyrdleEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into a word-game outcome envelope. */
export async function decodeRecord(payload: string): Promise<WyrdleEnvelope> {
  return decodeShare<WyrdleEnvelope>(payload);
}

/**
 * Re-verify a record by replaying `(seed, guesses)` through the binding and
 * re-hashing — never trusts the stored `final_hash`. A `Won` record must
 * re-solve the puzzle.
 */
export function verifyRecord(v: Verifier, env: WyrdleEnvelope): VerifyResult {
  const rec = env.payload;
  v.newGame(BigInt(rec.seed));
  for (const word of rec.moves) v.guess(word);
  const actual = v.currentHash();
  const hashOk = actual === rec.final_hash;
  const resultOk = rec.result !== "Won" || v.isWon();
  return { ok: hashOk && resultOk, expected: rec.final_hash, actual };
}

const MARK_EMOJI = ["⬛", "🟨", "🟩"] as const;

/**
 * The spoiler-free emoji grid (the classic brag) from the per-guess marks —
 * `🟩🟨⬛` only, never the letters. `label` names the puzzle (e.g. a day number
 * or `#seed`); `solved` picks `n/6` vs `X/6`.
 */
export function emojiGrid(rows: Mark[][], label: string, solved: boolean, maxGuesses: number): string {
  const header = `Wyrdle ${label} ${solved ? rows.length : "X"}/${maxGuesses}`;
  const grid = rows.map((marks) => marks.map((m) => MARK_EMOJI[m]).join("")).join("\n");
  return `${header}\n${grid}`;
}
