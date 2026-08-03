//! The narrative scaffold — Biscuit, a small dog who lives under the board and
//! rewards good play with confident, incorrect wisdom. This maps a subset of the
//! gameplay success events (the bus) to **beats**, fires each beat at most once
//! ever (a persisted seen-set) and at most once per board, and hands the beat to
//! a `show` callback (the overlay). It carries no DOM and no media — the copy is
//! placeholder; Phase 3 drops in the character art + real side-quest clips against
//! this same contract. See docs/MATCH3-STORY.md.

import type { Bus, M3Event } from "./match3-events.js";

/** A story beat: a title + caption (and, later, a media clip slot). */
export interface Beat {
  key: string;
  title: string;
  caption: string;
}

/** The placeholder beat copy (Phase 2). Phase 3 revises + adds `media`. */
export const BEATS: Record<string, Beat> = {
  "first-clear": {
    key: "first-clear",
    title: "Biscuit stirs",
    caption: "Biscuit saw that. Biscuit will remember that. Biscuit forgets things.",
  },
  "first-cascade-3": {
    key: "first-cascade-3",
    title: "A sign!",
    caption: "Three in a row means rain. Or lunch. The signs are unclear but delicious.",
  },
  "first-special": {
    key: "first-special",
    title: "Powerful candy",
    caption: "You have made a Powerful Candy. Do not tell the other candy.",
  },
  "level-1-complete": {
    key: "level-1-complete",
    title: "Level one!",
    caption: "Level one, conquered. Biscuit always believed in you, starting just now.",
  },
  "level-2-complete": {
    key: "level-2-complete",
    title: "A career",
    caption: "Two levels. That’s basically a career. Consider retiring at the top.",
  },
  comeback: {
    key: "comeback",
    title: "Clutch",
    caption: "Down to your last swap and you SWUNG it. Biscuit is legally your dog now.",
  },
};

/** The beat an event earns, or `null`. Rare, earned, emotionally legible only —
 *  never routine moves, never failure. */
export function beatForEvent(e: M3Event): string | null {
  switch (e.type) {
    case "move":
      return e.cleared > 0 ? "first-clear" : null;
    case "cascade":
      return e.depth >= 3 ? "first-cascade-3" : null;
    case "special":
      return "first-special";
    case "level-win":
      if (e.clutch) return "comeback";
      if (e.level === 1) return "level-1-complete";
      if (e.level === 2) return "level-2-complete";
      return null;
    default:
      return null;
  }
}

const SEEN_KEY = "fun-match3-beats";

function seenBeats(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markBeatSeen(key: string): void {
  try {
    const s = seenBeats();
    s.add(key);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* session-only */
  }
}

/** The running story engine bound to a bus. */
export interface StoryEngine {
  /** Re-arm for a new board (a beat can fire once per board). */
  resetForNewBoard(): void;
  /** Unsubscribe from the bus. */
  stop(): void;
}

/** Subscribe to the bus and drive beats: each beat fires at most once ever and
 *  at most once per board. `show` returns whether it actually displayed the beat
 *  (e.g. it may decline outside the campaign); a beat is only *consumed* — marked
 *  seen + counted for this board — when it was shown, so a declined beat can still
 *  fire later where it belongs. */
export function attachStory(bus: Bus, show: (beat: Beat) => boolean): StoryEngine {
  let firedThisBoard = false;
  const off = bus.on((e) => {
    if (firedThisBoard) return;
    const key = beatForEvent(e);
    if (!key || seenBeats().has(key)) return;
    const beat = BEATS[key];
    if (!beat) return;
    if (show(beat) === false) return; // declined (e.g. not in campaign) — leave unconsumed
    markBeatSeen(key);
    firedThisBoard = true;
  });
  return {
    resetForNewBoard() {
      firedThisBoard = false;
    },
    stop: off,
  };
}
