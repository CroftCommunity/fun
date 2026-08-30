//! The shelf's home surface: one model, two layouts.
//!
//! `ShelfModel` is computed once and is **skin-agnostic**. Each layout renders a
//! subset of it, so adding a game or a daily pack updates both layouts for free
//! — neither owns data, only presentation. That is the whole reason the model
//! exists rather than two renderers each fetching their own facts.
//!
//! WHAT THE MODEL MAY SAY is bounded by what is actually stored. Verified
//! 2026-08-28: this repo has **no per-game progress persistence at all** — the
//! only `localStorage` keys are the `fun-*` settings and Clumsy Bird's vendored
//! melonJS `me.save`. So the shelf reports what the SHELF observes: which games
//! you opened, and whether you opened today's board. It does not claim
//! "Level 4 of 6", which the design mock showed and nothing here can source.
//! Adding that means adding a progress store first, deliberately.

import type { GameEntry } from "./contract.js";
import type { Progress } from "./progress.js";
import { FAMILIES, SKINS } from "./skins.js";

// ---------------------------------------------------------------------------
// Shelf state — pure functions over a plain record, so the logic is testable
// without a DOM. The storage wrapper at the bottom is the only impure part.
// ---------------------------------------------------------------------------

/** `{ gameId: ISO timestamp of the last open }`. */
export type ShelfState = Readonly<Record<string, string>>;

/** The local calendar day, as `YYYY-MM-DD`. Local, because "today's board" is. */
export function today(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Record that a game was opened. Returns a NEW state; never mutates. */
export function noteOpened(state: ShelfState, id: string, now: Date): ShelfState {
  return { ...state, [id]: now.toISOString() };
}

/** Was this game opened on `now`'s local day? */
export function openedOn(state: ShelfState, id: string, now: Date): boolean {
  const at = state[id];
  return at !== undefined && today(new Date(at)) === today(now);
}

/** Game ids by most recently opened, newest first. */
export function recentFirst(state: ShelfState): string[] {
  return Object.entries(state)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// The groups. These carry the COPY the shelf layout argues with — the tier,
// named for what it promises a player rather than for its internal number. The
// today-first layout simply does not render the blurbs, which is why they live
// in the model rather than in either layout.
// ---------------------------------------------------------------------------

/** A named shelf of games, with the copy that says what it promises. */
export interface ShelfGroup {
  readonly id: string;
  readonly label: string;
  readonly headline: string;
  readonly blurb: string;
  readonly games: readonly GameEntry[];
}

interface GroupCopy {
  readonly label: string;
  readonly headline: string;
  readonly blurb: string;
}

/** Group metadata, in the order the home page shows them. */
export const GROUPS: ReadonlyArray<readonly [string, GroupCopy]> = [
  [
    "provable",
    {
      label: "Shelf one",
      headline: "Solo, and provable",
      blurb:
        "Decided entirely in your browser. Each finished board hands you a record anyone can re-check.",
    },
  ],
  [
    "versus",
    {
      label: "Shelf two",
      headline: "Against the engine",
      blurb: "Opponents that tell you, honestly, when they already know they have won.",
    },
  ],
];

/** The group a game belongs to, defaulting when the entry omits it. */
function groupOf(game: GameEntry): string {
  const declared = (game as { group?: string }).group;
  // Every game on the shelf is now provable — the "wrapped" default went with
  // Tier 2 on 2026-08-29. An entry can still declare a group explicitly.
  return declared ?? "provable";
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** A daily board, and whether you have opened today's. */
export interface TodayEntry {
  readonly id: string;
  readonly title: string;
  readonly opened: boolean;
}

/** What the home page renders, in whichever layout. */
export interface ShelfModel {
  /**
   * What Continue points at. An unfinished game from the progress store wins,
   * with its summary `line`; otherwise the game most recently opened, without one
   * (plan Phase 5b — the store exists now; the module note above is history).
   */
  readonly resume?: { readonly id: string; readonly title: string; readonly line?: string };
  readonly today: readonly TodayEntry[];
  readonly groups: readonly ShelfGroup[];
}

/** Everything `buildShelfModel` needs, injected so the model is pure. */
export interface ShelfDeps {
  readonly games: readonly GameEntry[];
  readonly state: ShelfState;
  readonly now: Date;
  /** The progress store's records by game id, already validated (`readProgress`). */
  readonly progress?: Readonly<Record<string, Progress>>;
}

/** Games that ship a daily pack (`games/<id>/daily-pack.json`). */
const DAILY = new Set(["solitaire", "wyrdle", "2048", "bubble", "align", "blockdoku", "color-sort"]);

/** Dev fixtures the home page does not advertise even in a dev build (src/registry.ts). */
const UNLISTED = new Set(["placeholder"]);

/** Build the model both layouts consume. Pure. */
export function buildShelfModel({ games, state, now, progress = {} }: ShelfDeps): ShelfModel {
  // `placeholder` exists to exercise the chrome. It once led the shelf as drawer
  // item #1; now it is not in the shipped catalog at all, and a dev build (the
  // test runs) keeps it off the home page too.
  const playable = games.filter((g) => g.status === "playable" && !UNLISTED.has(g.id));
  const byId = new Map(playable.map((g) => [g.id, g]));

  // Continue: the unfinished game the store holds (newest first when several),
  // else the last one opened. A finished record is not Continue material, and a
  // key for a game no longer in the registry is a stale key, ignored.
  const unfinished = Object.entries(progress)
    .filter(([id, p]) => byId.has(id) && p.status === "in-progress")
    .sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : a[1].updatedAt > b[1].updatedAt ? -1 : 0))[0];
  const lastId = recentFirst(state).find((id) => byId.has(id));
  const last = lastId === undefined ? undefined : byId.get(lastId);
  const resume = unfinished
    ? { id: unfinished[0], title: byId.get(unfinished[0])!.title, line: unfinished[1].summary.line }
    : last
      ? { id: last.id, title: last.title }
      : undefined;

  const dailyFlag = (g: GameEntry): boolean =>
    (g as { daily?: boolean }).daily ?? DAILY.has(g.id);

  const groups: ShelfGroup[] = [];
  for (const [id, copy] of GROUPS) {
    const members = playable.filter((g) => groupOf(g) === id);
    if (members.length > 0) groups.push({ id, ...copy, games: members });
  }

  return {
    ...(resume ? { resume } : {}),
    today: playable.filter(dailyFlag).map((g) => ({
      id: g.id,
      title: g.title,
      opened: openedOn(state, g.id, now),
    })),
    groups,
  };
}

// ---------------------------------------------------------------------------
// Layouts. Both are FIRST-CLASS app options the user can reach; a skin family
// only expresses a PREFERENCE among them, and the user's explicit choice wins
// in BOTH directions. A preference overridable one way only is a lock wearing a
// preference's name. Same rule as forage's prefersDensity (DL-028).
// ---------------------------------------------------------------------------

/** The home layouts the app ships. */
export const LAYOUTS: Readonly<Record<string, { readonly label: string }>> = Object.freeze({
  "today-first": { label: "Today first" },
  shelf: { label: "Shelf index" },
});

/** Device-local override. Absent means "follow the skin family's preference". */
export const LAYOUT_KEY = "fun-layout";

/**
 * The family's preferred layout for a skin. Lives on the FAMILY, not the skin
 * (plan D5): on the skin, two members of one family could disagree, and then the
 * ☾/☀ control would silently re-lay-out the page.
 */
export function prefersLayoutFor(skinId: string): string {
  const family = SKINS[skinId]?.family;
  const preferred = family === undefined ? undefined : FAMILIES[family]?.prefersLayout;
  return preferred ?? "today-first";
}

/** An explicit stored choice wins; otherwise take the family's suggestion. */
export function resolveLayout(stored: string | null, preferred: string): string {
  if (stored && LAYOUTS[stored]) return stored;
  return LAYOUTS[preferred] ? preferred : "today-first";
}
