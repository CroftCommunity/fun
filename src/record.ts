//! The game record — one `$type`-shaped object per game holding the player's
//! stats and the game in progress (plan 2026-08-29-plan-color-sort-redesign, D9;
//! mock E proposal 6). Owner: "keep the state local to the browser but shaped
//! for a later lexicon if we so choose, see forage doing the same thing".
//!
//! So the SHAPE is a record (a `$type` NSID and lexicon-style fields), and the
//! PERSISTENCE is a substrate the caller chooses — `localSubstrate` over
//! `localStorage` today, an atproto substrate later, a `memorySubstrate` in
//! tests. A substrate never reaches for storage on its own (forage
//! `js/substrates/`); `readRecord`/`writeRecord` take one explicitly.
//!
//! The NSID `ing.croft.fun.progress` is TENTATIVE — LEXICONS.md act 1
//! (investigate the official and `community.lexicon.*` namespaces) precedes
//! any publishing. Nothing here sends a record anywhere. `did` is bound on
//! sign-in (phase D) and stays null while anonymous.
//!
//! `stats.played` — solves of any kind — is what the Daily gate reads (D4:
//! Daily unlocks after five). The daily streak counts once per UTC day.

/** The record type, as an NSID. Tentative until LEXICONS.md act 1 runs. */
export const RECORD_TYPE = "ing.croft.fun.progress";
export const DAILY_UNLOCK_SOLVES = 5;

export interface RecordStats {
  readonly solved: number;
  readonly strictSolved: number;
  readonly streak: number;
  readonly maxStreak: number;
  /** The UTC day index of the last daily solve, or -1. */
  readonly lastDay: number;
  readonly bestLevel: number;
  /** Solves of any kind — the gate's input. */
  readonly played: number;
}

export interface InProgress {
  readonly mode: "daily" | "endless";
  /** Endless: the level. Daily: the UTC day index. */
  readonly level: number;
  readonly seed: string;
  /** Pours as `[from, to]` pairs. */
  readonly moves: readonly (readonly [number, number])[];
  /** Daily: the pack's par, once known. */
  readonly par?: number;
  /** Daily: solved today (kept so the result can be shown again). */
  readonly solved?: boolean;
  readonly strict?: boolean;
}

export interface GameRecord {
  readonly $type: typeof RECORD_TYPE;
  readonly game: string;
  readonly did: string | null;
  readonly stats: RecordStats;
  readonly inProgress: InProgress | null;
  readonly updatedAt: string;
}

/** Where a record lives. The caller picks; a substrate never picks for it. */
export interface RecordSubstrate {
  read(game: string): string | null;
  write(game: string, raw: string): void;
  clear(game: string): void;
}

const KEY_PREFIX = "fun-record-";

/** `localStorage`, degrading to nothing when storage is denied (private mode). */
export const localSubstrate: RecordSubstrate = {
  read(game) {
    try {
      return localStorage.getItem(`${KEY_PREFIX}${game}`);
    } catch {
      return null;
    }
  },
  write(game, raw) {
    try {
      localStorage.setItem(`${KEY_PREFIX}${game}`, raw);
    } catch {
      console.debug(`[record] ${game} storage denied: write`);
    }
  },
  clear(game) {
    try {
      localStorage.removeItem(`${KEY_PREFIX}${game}`);
    } catch {
      console.debug(`[record] ${game} storage denied: clear`);
    }
  },
};

/** An in-memory substrate — tests, and the shape a remote one will take. */
export function memorySubstrate(): RecordSubstrate {
  const m = new Map<string, string>();
  return {
    read: (g) => m.get(g) ?? null,
    write: (g, raw) => void m.set(g, raw),
    clear: (g) => void m.delete(g),
  };
}

export function emptyRecord(game: string): GameRecord {
  return {
    $type: RECORD_TYPE,
    game,
    did: null,
    stats: { solved: 0, strictSolved: 0, streak: 0, maxStreak: 0, lastDay: -1, bestLevel: 1, played: 0 },
    inProgress: null,
    updatedAt: new Date().toISOString(),
  };
}

export type ResolvedRecord = { readonly ok: true; readonly record: GameRecord } | { readonly ok: false; readonly reason: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const STAT_KEYS: readonly (keyof RecordStats)[] = ["solved", "strictSolved", "streak", "maxStreak", "lastDay", "bestLevel", "played"];

/** Pure: validate a stored string as a record for `game`. Loud about why not. */
export function resolveRecord(raw: string | null, game: string): ResolvedRecord {
  if (raw === null) return { ok: false, reason: "nothing stored" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "not a record" };
  if (parsed.$type !== RECORD_TYPE) return { ok: false, reason: `$type ${String(parsed.$type)}` };
  if (parsed.game !== game) return { ok: false, reason: `game ${String(parsed.game)}` };
  if (parsed.did !== null && typeof parsed.did !== "string") return { ok: false, reason: "did" };
  if (!isObject(parsed.stats)) return { ok: false, reason: "no stats" };
  for (const k of STAT_KEYS) {
    if (typeof parsed.stats[k] !== "number") return { ok: false, reason: `stats.${k}` };
  }
  if (parsed.inProgress !== null && !isObject(parsed.inProgress)) return { ok: false, reason: "inProgress" };
  if (typeof parsed.updatedAt !== "string") return { ok: false, reason: "updatedAt" };
  return { ok: true, record: parsed as unknown as GameRecord };
}

/** The record for `game`, or null. A rejected record is cleared and the reason logged. */
export function readRecord(game: string, sub: RecordSubstrate = localSubstrate): GameRecord | null {
  const raw = sub.read(game);
  if (raw === null) return null;
  const r = resolveRecord(raw, game);
  if (r.ok) return r.record;
  console.debug(`[record] ${game} rejected: ${r.reason}`);
  sub.clear(game);
  return null;
}

export function writeRecord(record: GameRecord, sub: RecordSubstrate = localSubstrate): void {
  sub.write(record.game, JSON.stringify(record));
}

/** A solve happened. Pure: returns the updated record. */
export function recordSolve(
  r: GameRecord,
  solve: { kind: "daily"; strict: boolean; day: number } | { kind: "endless"; level: number; strict: boolean; day: number },
): GameRecord {
  const s = r.stats;
  const now = new Date().toISOString();
  if (solve.kind === "endless") {
    return {
      ...r,
      stats: { ...s, played: s.played + 1, solved: s.solved + 1, strictSolved: s.strictSolved + (solve.strict ? 1 : 0), bestLevel: Math.max(s.bestLevel, solve.level) },
      updatedAt: now,
    };
  }
  if (s.lastDay === solve.day) return r; // today's daily already counted
  const streak = s.lastDay === solve.day - 1 ? s.streak + 1 : 1;
  return {
    ...r,
    stats: {
      ...s,
      played: s.played + 1,
      solved: s.solved + 1,
      strictSolved: s.strictSolved + (solve.strict ? 1 : 0),
      streak,
      maxStreak: Math.max(s.maxStreak, streak),
      lastDay: solve.day,
    },
    updatedAt: now,
  };
}

/** How many solves remain before the Daily unlocks (0 = unlocked). */
export function solvesToDaily(r: GameRecord | null): number {
  return Math.max(0, DAILY_UNLOCK_SOLVES - (r?.stats.played ?? 0));
}
