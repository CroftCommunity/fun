//! The match-3 campaign — a numbered ladder of levels layered over the game's
//! *verifiable* core seeds. A level is just a curated seed plus a front-end star
//! rule (three score thresholds); the board is played by the real core, so every
//! outcome keeps its `(seed, moves) → state_hash` and `?r=` share. Stars are a
//! front-end *reading* of the recorded score — the campaign never re-grades the
//! core or bakes custom budgets (that would need a Rust change; deferred).
//!
//! Progress and an in-progress resume live in localStorage (match3-scoped keys),
//! degrading to session-only if storage is denied — same posture as `settings.ts`.

import type { Swap } from "./match3-wasm.js";

/** One campaign level: a curated seed, its three star-score thresholds, and an
 *  optional tutorial opening swap (`hint`) + intro line. */
export interface Level {
  id: number;
  seed: number;
  stars: [number, number, number];
  hint?: Swap;
  intro?: string;
}

/** The ordered ladder (served as a pack, like the objective winnable packs). */
export interface Campaign {
  levels: Level[];
}

/** Stars (0–3) for a final `score` under a level's thresholds `[1★, 2★, 3★]`. */
export function campaignStars(score: number, [one, two, three]: [number, number, number]): number {
  if (score >= three) return 3;
  if (score >= two) return 2;
  if (score >= one) return 1;
  return 0;
}

/** The level with `id`, or `undefined`. */
export function levelById(campaign: Campaign, id: number): Level | undefined {
  return campaign.levels.find((l) => l.id === id);
}

/** The id of the level after `id`, or `null` at the end of the ladder. */
export function nextLevelId(campaign: Campaign, id: number): number | null {
  const i = campaign.levels.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < campaign.levels.length ? campaign.levels[i + 1]!.id : null;
}

/** Fetch + unwrap the campaign pack (same doc-envelope shape as the other packs). */
export async function fetchCampaign(url = "/match3-campaign-pack.json"): Promise<Campaign> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const env = (await res.json()) as { payload: Campaign };
  return env.payload;
}

// ---------- persistence (match3-scoped; session-only if storage denied) ----------

const PROGRESS_KEY = "fun-match3-campaign";
const RESUME_KEY = "fun-match3-resume";

/** Best stars earned per level id. */
export type Progress = Record<number, number>;

/** The saved best-stars map (empty if none / storage denied). */
export function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Progress;
  } catch {
    return {};
  }
}

/** Record `stars` for `id`, keeping the best ever (never a downgrade). */
export function recordStars(id: number, stars: number): Progress {
  const p = loadProgress();
  if (stars > (p[id] ?? 0)) {
    p[id] = stars;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch {
      /* session-only */
    }
  }
  return p;
}

/** The highest level the player may enter: the first uncleared level in the
 *  ladder (a level is cleared at ≥1 star), capped at the last level's id. */
export function unlockedLevel(campaign: Campaign): number {
  const p = loadProgress();
  let unlocked = campaign.levels[0]?.id ?? 1;
  for (const l of campaign.levels) {
    if ((p[l.id] ?? 0) >= 1) unlocked = nextLevelId(campaign, l.id) ?? l.id;
    else break;
  }
  return unlocked;
}

/** An in-progress board saved as its **move list** (replayed into a fresh seeded
 *  core on resume — deterministic + verifiable, never a serialized board). */
export interface Resume {
  objective: string;
  seed: string;
  level?: number;
  moves: Swap[];
}

/** Persist the in-progress board. */
export function saveResume(r: Resume): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(r));
  } catch {
    /* session-only */
  }
}

/** The saved in-progress board, or `null`. */
export function loadResume(): Resume | null {
  try {
    const s = localStorage.getItem(RESUME_KEY);
    return s ? (JSON.parse(s) as Resume) : null;
  } catch {
    return null;
  }
}

/** Forget the saved in-progress board (finished / abandoned). */
export function clearResume(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* nothing to do */
  }
}
