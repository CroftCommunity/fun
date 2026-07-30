//! Pure outcome/verify/share/daily logic for the solitaire front-end — no DOM.
//!
//! The verifiable clean-clear is the pond's whole point, so this module is kept
//! isolated and unit-tested: it never re-implements rules (verification replays
//! through the binding, the source of truth) and never trusts a stored hash.

import type { SolMove } from "./solitaire-wasm.js";

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

const toB64Url = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string): string => s.replace(/-/g, "+").replace(/_/g, "/");

/** Base64 a byte array without blowing the call stack on large move lists. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pipe(stream: TransformStream, bytes: Uint8Array): Promise<Uint8Array> {
  // Begin consuming `readable` before writing so the stream's backpressure
  // never deadlocks the single large write (it can, e.g. in Chromium).
  const collected = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await collected);
}

/**
 * Encode an outcome envelope as the base64url share payload (`?r=`). The record
 * is the full, self-verifying document (the recipient re-verifies offline by
 * replay), and a winning move list is long and repetitive, so it is deflated
 * first — a 500-move win shrinks from ~21 KB to ~1.3 KB, keeping the share URL
 * portable.
 */
export async function encodeRecord(env: OutcomeEnvelope): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(env));
  const compressed = await pipe(new CompressionStream("deflate-raw"), json);
  return toB64Url(bytesToBase64(compressed));
}

/** Decode a base64url share payload back into an outcome envelope. */
export async function decodeRecord(payload: string): Promise<OutcomeEnvelope> {
  const compressed = base64ToBytes(fromB64Url(payload));
  const json = await pipe(new DecompressionStream("deflate-raw"), compressed);
  return JSON.parse(new TextDecoder().decode(json)) as OutcomeEnvelope;
}

const MS_PER_DAY = 86_400_000;

/** Whole UTC days since the Unix epoch — the daily-deal rollover boundary. */
export function dayIndexUTC(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
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
