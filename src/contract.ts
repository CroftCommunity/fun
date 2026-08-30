//! The game-module contract. A game renders chrome-agnostically into a
//! container and never knows whether it is in the drawer, full-screen, or a
//! standalone tab. Built once; every game implements this.

import type { GameFrame } from "./game-frame.js";
import type { Progress } from "./progress.js";
import type { SettingRow } from "./settings-sheet.js";

/** How the game is currently presented. */
export type PresentationMode = "drawer" | "fullscreen" | "standalone";

/** Services the chrome hands a game at mount time. */
export interface GameServices {
  /** The presentation mode at mount time. */
  readonly mode: PresentationMode;
  /**
   * The game frame this game renders inside (`src/game-frame.ts`). The chrome
   * mounts the frame with the game's title and menu and hands the game its
   * stage; a migrated game declares its meters and verbs with `frame.update()`.
   * Absent only when a module is mounted outside the chrome (a unit test).
   */
  readonly frame?: GameFrame;
  /**
   * The shelf's sign-in (src/signin): who is signed in, if anyone, and a way to
   * open the atmo-provider sheet — for a game's own offer after a solve
   * (mock E6.1). Absent outside the chrome (a unit test).
   */
  readonly signIn?: {
    readonly current: () => { readonly did: string; readonly handle: string } | null;
    readonly open: () => void;
  };
}

/** A live, mountable game instance. */
export interface GameModule {
  /** Render into `container`. Called once per launch. */
  mount(container: HTMLElement, services: GameServices): void;
  /** Tear down and release resources. */
  unmount(): void;
  /**
   * The game in progress, for the progress store (`src/progress.ts`). The frame
   * decides when to ask (after every move); the game decides what to say — for a
   * Tier-1 game, the seed and the move list its outcome record already carries.
   * Optional: a game without it gets the start screen but never a continue card.
   */
  snapshot?(): Progress;
  /** Restore a game the store handed back. Replay, for a Tier-1 game. */
  resume?(progress: Progress): void;
}

/** A catalog entry describing a game and how to load it. */
export interface GameEntry {
  readonly id: string;
  readonly title: string;
  /**
   * The rest of the game's name, for the surfaces that have room for it.
   *
   * Tiles and the drawer show `title` alone. `.home-tile-title` has no
   * truncation or clamp and the shelf's floor is 360px, so a title much past
   * the shipped maximum ("Dots and Boxes", 14 chars) wraps. Trio Tumble's full
   * name is "Trio Tumble: Jewel Drop" — 23 — so it is split here rather than
   * given clamp CSS no other game needs. Compose with {@link displayName};
   * never concatenate by hand, or the surfaces drift.
   */
  readonly subtitle?: string;
  /** Fallback glyph, shown where a game has no icon art yet. */
  readonly emoji: string;
  readonly status: "playable" | "soon";
  /**
   * Which shelf group the home page files this under (`src/shelf.ts` GROUPS).
   * Omitted means "by tier": Tier-2 wraps land in `wrapped`, everything else in
   * `provable`. Only the adversarial games need to say so explicitly.
   */
  readonly group?: "provable" | "versus" | "wrapped";
  /**
   * This game ships `src/games/<id>/assets/icon.jpg` — a 512² square, served at
   * `/<id>/assets/icon.jpg`. It is the game's ICON in the manifest sense: the
   * home page shows it as the tile, and the PWA work will use the same file.
   * One asset, both jobs. Asserted against the filesystem by `tests/art.test.ts`
   * in BOTH directions, so the claim cannot drift from the file.
   */
  readonly icon?: true;
  /** Construct a fresh module instance. Absent for `soon` games. */
  readonly load?: () => GameModule;
  /**
   * The one line under the name on the start screen (`docs/BUILDING-GAMES.md` §4c).
   * On the ENTRY, not the module, because the poster shows before the game mounts.
   */
  readonly pitch?: string;
  /**
   * The setup card the poster shows before the game mounts — the same rows the
   * module's `GameFrameSpec.setup` declares, built from the persisted settings so
   * the poster and the New game sheet cannot disagree. A factory, read at render.
   */
  readonly setup?: () => readonly SettingRow[];
  /**
   * A short chip above the name on the start screen — "Today's puzzle · par 32 ·
   * not yet played" — or null for none. A factory, read when the poster renders,
   * so it can reflect the game's record without the engine loaded.
   */
  readonly chip?: () => string | null;
}

/**
 * The game's whole name: `title`, plus `subtitle` after a colon when it has one.
 *
 * Use this on surfaces with room — the how-to page, the browser tab. Tiles and
 * the drawer stay on `title` alone. A blank or whitespace-only subtitle yields
 * the bare title rather than a dangling colon.
 */
export function displayName(entry: Pick<GameEntry, "title" | "subtitle">): string {
  const sub = entry.subtitle?.trim();
  return sub ? `${entry.title}: ${sub}` : entry.title;
}
