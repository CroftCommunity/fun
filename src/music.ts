//! Music: lazy, best-effort, and quiet about failure.
//!
//! Tracks live in `assets/audio/` — shelf-level, not per-game, because a piece
//! belongs to the shelf even when a game claims one by default. The same loop is
//! the shelf's ambient bed and could be another game's theme; filing it under one
//! game would be a lie about what it is.
//!
//! Three rules the implementation exists to keep:
//!
//! - **Lazy.** Nothing is fetched until the player turns music on. A silent
//!   visitor pays zero bytes, which matters when the library is ~13.8 MB.
//! - **Best-effort.** Every failure path is silent. Music is decoration; a
//!   missing file, a denied autoplay, or a full cache must never break a game.
//!   This is the one place the repo's "fail loud" rule is deliberately inverted,
//!   and it is inverted because the user's alternative to music is silence.
//! - **Offline-friendly, not offline-guaranteed.** Fetched tracks are put in a
//!   Cache Storage bucket and read from there first, so a second visit costs
//!   nothing. True offline still waits on the service worker
//!   (`TODO/pwa.md` — the shelf has none yet), and this claims no more than it
//!   does.
//!
//! Autoplay is never attempted: browsers refuse audio without a gesture, and the
//! toggle is that gesture.

/** A track in the library. */
export interface Track {
  readonly id: string;
  readonly title: string;
  /** ~30s pieces loop seamlessly enough to sit under a shelf; longer ones play out. */
  readonly kind: "loop" | "piece";
}

/** Preference key: "on" or "off". Absent means off — music never starts uninvited. */
export const MUSIC_KEY = "fun-music";
/** Preference key: the last track the player picked from the list. */
export const TRACK_KEY = "fun-music-track";
/**
 * Preference key: "on" or "off". Absent means ON — coupling a game to its named
 * track is what the shelf always did, so the default must not change it.
 */
export const COUPLE_KEY = "fun-music-couple";

const CACHE = "fun-audio-v1";

/** The library, as filed by `tools/intake.mjs`. */
export const TRACKS: readonly Track[] = [
  { id: "morning-miles", title: "Morning Miles", kind: "loop" },
  { id: "porch-light-nocturne", title: "Porch Light Nocturne", kind: "loop" },
  { id: "clover-hill-crossing", title: "Clover Hill Crossing", kind: "loop" },
  { id: "gateway-to-the-spire", title: "Gateway to the Spire", kind: "loop" },
  { id: "lower-cavern-bloom", title: "Lower Cavern Bloom", kind: "loop" },
  { id: "morning-after-the-rain", title: "Morning After the Rain", kind: "loop" },
  { id: "morning-in-the-lower-valley", title: "Morning in the Lower Valley", kind: "loop" },
  { id: "glass-office-walls", title: "Glass Office Walls", kind: "piece" },
  { id: "gravity-glass", title: "Gravity Glass", kind: "piece" },
  { id: "last-life-remaining", title: "Last Life Remaining", kind: "piece" },
  { id: "morning-grid", title: "Morning Grid", kind: "piece" },
  { id: "morning-inside-the-basin", title: "Morning Inside the Basin", kind: "piece" },
  { id: "porcelain-afternoon", title: "Porcelain Afternoon", kind: "piece" },
  { id: "save-point-morning", title: "Save Point Morning", kind: "piece" },
  { id: "six-sides-of-logic", title: "Six Sides of Logic", kind: "piece" },
  { id: "sunday-drive-south", title: "Sunday Drive South", kind: "piece" },
  { id: "sunset-at-the-harbor", title: "Sunset at the Harbor", kind: "piece" },
  { id: "the-last-cab-home", title: "The Last Cab Home", kind: "piece" },
  { id: "the-unfolding-hour", title: "The Unfolding Hour", kind: "piece" },
  { id: "tuesday-night-rainfall", title: "Tuesday Night Rainfall", kind: "piece" },
];

/** The shelf's own ambient bed. A loop, because the home page is a place you linger. */
export const SHELF_TRACK = "morning-miles";

/**
 * Which track a game gets by default. A game NAMES a track; it does not own one
 * — the file stays in the shelf's library and any game may name the same piece.
 */
const BY_GAME: Readonly<Record<string, string>> = {
  "trio-tumble": "gateway-to-the-spire",
  solitaire: "sunset-at-the-harbor",
  bubble: "gravity-glass",
  wyrdle: "six-sides-of-logic",
  othello: "the-unfolding-hour",
  checkers: "sunday-drive-south",
  chess: "the-unfolding-hour",
  drop4: "six-sides-of-logic",
  dots: "six-sides-of-logic",
  furrow: "morning-in-the-lower-valley",
  "color-sort": "clover-hill-crossing",
  looseends: "lower-cavern-bloom",
  align: "morning-grid",
  blockdoku: "morning-grid",
  2048: "save-point-morning",
  "orchard-drop": "morning-after-the-rain",
};

const KNOWN = new Set(TRACKS.map((t) => t.id));

/** The track for a page: the game's default, else the shelf's bed. Pure. */
export function trackFor(gameId: string | null): string {
  const named = gameId === null ? undefined : BY_GAME[gameId];
  return named !== undefined && KNOWN.has(named) ? named : SHELF_TRACK;
}

/** Stored coupling preference → on/off. Only an explicit "off" uncouples. Pure. */
export function resolveCouple(stored: string | null): boolean {
  return stored !== "off";
}

/**
 * Which track a page starts on. Coupled: the page's own track, whatever was
 * picked before. Uncoupled: the last pick, if it still exists; else the page's.
 * Pure.
 */
export function startingTrack({
  gameId,
  coupled,
  stored,
}: {
  readonly gameId: string | null;
  readonly coupled: boolean;
  readonly stored: string | null;
}): string {
  if (!coupled && stored !== null && KNOWN.has(stored)) return stored;
  return trackFor(gameId);
}

/**
 * The track before or after `id` in library order, wrapping at both ends. An
 * unknown id steps to the start of the list: the list is the only place to go.
 * Pure.
 */
export function stepTrack(id: string, dir: 1 | -1): string {
  const at = TRACKS.findIndex((t) => t.id === id);
  if (at < 0) return TRACKS[0]!.id;
  const n = TRACKS.length;
  return TRACKS[(at + dir + n) % n]!.id;
}

/** Is a track a loop? Pure. */
export function isLoop(id: string): boolean {
  return TRACKS.find((t) => t.id === id)?.kind === "loop";
}

/** Stored preference → on/off. Absent or unrecognised means OFF. Pure. */
export function resolveMusic(stored: string | null): boolean {
  return stored === "on";
}

/** The URL a track is served from. */
export function trackUrl(id: string): string {
  return `/assets/audio/${id}.mp3`;
}

/**
 * Fetch a track through Cache Storage so a second visit costs nothing.
 * Returns a playable URL, or the network URL if caching is unavailable — the
 * caller must not care which.
 */
async function cachedUrl(id: string): Promise<string> {
  const url = trackUrl(id);
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return URL.createObjectURL(await hit.blob());
    const res = await fetch(url);
    if (!res.ok) return url;
    await cache.put(url, res.clone());
    return URL.createObjectURL(await res.blob());
  } catch {
    // No Cache Storage (private mode, old browser), or a quota refusal. Play
    // from the network; the only cost is doing it again next time.
    return url;
  }
}

/** A running music player. Every method is safe to call at any time. */
export interface MusicPlayer {
  /** Turn music on (fetching lazily) or off. Persists the choice. */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** The track this page is playing, or would play. */
  current(): string;
  /** Pick a track. Remembered; played now only if music is on. */
  select(id: string): void;
  next(): void;
  prev(): void;
  /** Whether opening a game starts that game's named track. */
  isCoupled(): boolean;
  /** Re-coupling snaps to the page's own track; uncoupling keeps what plays. */
  setCoupled(on: boolean): void;
  /** Hear every change (track, on/off, coupling). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  stop(): void;
}

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage denied: the choice holds for this page view only.
  }
}

/**
 * Start the music layer for a page. Fetches nothing unless music is already on.
 */
export function startMusic(gameId: string | null): MusicPlayer {
  let coupled = resolveCouple(readPref(COUPLE_KEY));
  let id = startingTrack({ gameId, coupled, stored: readPref(TRACK_KEY) });
  let audio: HTMLAudioElement | null = null;
  let enabled = resolveMusic(readPref(MUSIC_KEY));
  const listeners = new Set<() => void>();

  const publish = (): void => {
    for (const fn of listeners) fn();
  };

  const stop = (): void => {
    try {
      audio?.pause();
    } catch {
      // Ignore: we are stopping anyway.
    }
    audio = null;
  };

  const play = (): void => {
    const wanted = id;
    void (async () => {
      try {
        const src = await cachedUrl(wanted);
        // A pick made while the fetch was in flight wins; this one is stale.
        if (wanted !== id || !enabled) return;
        stop();
        const el = new Audio(src);
        el.loop = isLoop(wanted);
        el.volume = 0.35;
        // A piece plays out; a transport that then stops dead reads as broken,
        // so advance. Loops never fire `ended`.
        el.addEventListener("ended", () => {
          if (enabled && audio === el) step(1);
        });
        audio = el;
        // A rejected play() is normal (no gesture yet, or the tab is muted).
        await el.play().catch(() => undefined);
      } catch {
        // Best-effort: music never breaks a page.
      }
    })();
  };

  const select = (next: string): void => {
    if (!KNOWN.has(next)) return;
    id = next;
    writePref(TRACK_KEY, next);
    if (enabled) play();
    publish();
  };

  const step = (dir: 1 | -1): void => select(stepTrack(id, dir));

  if (enabled) play();

  return {
    isEnabled: () => enabled,
    current: () => id,
    stop,
    setEnabled: (on) => {
      enabled = on;
      writePref(MUSIC_KEY, on ? "on" : "off");
      if (on) play();
      else stop();
      publish();
    },
    select,
    next: () => step(1),
    prev: () => step(-1),
    isCoupled: () => coupled,
    setCoupled: (on) => {
      coupled = on;
      writePref(COUPLE_KEY, on ? "on" : "off");
      if (on && id !== trackFor(gameId)) {
        // Snap without persisting: the page's track is the coupling's choice,
        // not the player's pick, and their pick should survive re-uncoupling.
        id = trackFor(gameId);
        if (enabled) play();
      }
      publish();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
