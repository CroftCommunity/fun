//! The progress store — what "Continue" reads (plan 2026-08-30, D1).
//!
//! One `localStorage` key per game, `fun-progress-<id>`; the newest record wins and
//! there is no history. A game opts in by implementing `snapshot()` / `resume()` on
//! its module (`src/contract.ts`); the frame decides WHEN to snapshot (after every
//! move) and the game decides WHAT (for a Tier-1 game, the move list its outcome
//! record already carries — resume is replay). The `summary.line` is what the
//! continue card and the rail show WITHOUT loading the engine.
//!
//! Expiry: a `daily:YYYY-MM-DD` record dies at the LOCAL rollover after the day it
//! was last updated — the same "today" the shelf uses — whether in progress or
//! finished (a finished one is kept until then so the card can say "won today";
//! plan Q6). A `free` record never expires. A record the resolver rejects is
//! cleared on read and the reason logged at debug (plan Q8).
//!
//! Storage denied (private mode): read is null, write and clear are no-ops, one
//! debug line each — the `settings.ts` rule: "Cosmetic/preference settings degrade
//! (session-only) rather than failing loud if storage is denied." A player must
//! never lose a launch to a storage quirk.

import { today } from "./shelf.js";

/** The stored shape. `record` is the game's own and opaque to the store. */
export interface Progress {
  readonly v: 1;
  readonly status: "in-progress" | "finished";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly setup: {
    /** `"daily:YYYY-MM-DD"` or `"free"`, plus whatever the game's New game card chose. */
    readonly mode: string;
    readonly [key: string]: unknown;
  };
  readonly record: unknown;
  readonly summary: {
    /** One line for the card: "Move 14 · you lead 9–4". */
    readonly line: string;
    readonly [key: string]: unknown;
  };
}

/** What the pure resolver says about a stored string. */
export type Resolved = { readonly ok: true; readonly progress: Progress } | { readonly ok: false; readonly reason: string };

const KEY_PREFIX = "fun-progress-";

/** The storage key for a game. */
export function progressKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validate a stored string as of `now`. Pure: no storage, no clock of its own.
 * Rejects the wrong version, the wrong shape, a missing summary line, and a daily
 * record whose local day has rolled over.
 */
export function resolveProgress(raw: string | null, now: Date): Resolved {
  if (raw === null) return { ok: false, reason: "nothing stored" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "not a record" };
  if (parsed.v !== 1) return { ok: false, reason: `version ${JSON.stringify(parsed.v)}` };
  if (parsed.status !== "in-progress" && parsed.status !== "finished") {
    return { ok: false, reason: `status: ${String(parsed.status)}` };
  }
  if (typeof parsed.startedAt !== "string" || typeof parsed.updatedAt !== "string") {
    return { ok: false, reason: "no timestamps" };
  }
  if (!isObject(parsed.setup) || typeof parsed.setup.mode !== "string") return { ok: false, reason: "no setup.mode" };
  if (!isObject(parsed.summary) || typeof parsed.summary.line !== "string" || parsed.summary.line === "") {
    return { ok: false, reason: "no summary line" };
  }
  if (parsed.setup.mode.startsWith("daily:")) {
    const updated = new Date(parsed.updatedAt);
    if (Number.isNaN(updated.getTime())) return { ok: false, reason: "bad updatedAt" };
    if (today(updated) !== today(now)) return { ok: false, reason: "daily expired" };
  }
  return { ok: true, progress: parsed as unknown as Progress };
}

/** The stored record for a game as of `now`, or null. A rejected record is cleared. */
export function readProgress(id: string, now: Date = new Date()): Progress | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(progressKey(id));
  } catch {
    console.debug(`[progress] ${id} storage denied: read`);
    return null;
  }
  if (raw === null) return null;
  const r = resolveProgress(raw, now);
  if (r.ok) return r.progress;
  console.debug(`[progress] ${id} rejected: ${r.reason}`);
  clearProgress(id);
  return null;
}

/** Store a record for a game, overwriting whatever was there. Never throws. */
export function writeProgress(id: string, p: Progress): void {
  try {
    localStorage.setItem(progressKey(id), JSON.stringify(p));
  } catch {
    console.debug(`[progress] ${id} storage denied: write`);
  }
}

/** Forget a game's record. Never throws; absent is fine. */
export function clearProgress(id: string): void {
  try {
    localStorage.removeItem(progressKey(id));
  } catch {
    console.debug(`[progress] ${id} storage denied: clear`);
  }
}
