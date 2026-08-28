//! The game-module contract. A game renders chrome-agnostically into a
//! container and never knows whether it is in the drawer, full-screen, or a
//! standalone tab. Built once; every game implements this.

/** How the game is currently presented. */
export type PresentationMode = "drawer" | "fullscreen" | "standalone";

/** Services the chrome hands a game at mount time. */
export interface GameServices {
  /** The presentation mode at mount time. */
  readonly mode: PresentationMode;
}

/** A live, mountable game instance. */
export interface GameModule {
  /** Render into `container`. Called once per launch. */
  mount(container: HTMLElement, services: GameServices): void;
  /** Tear down and release resources. */
  unmount(): void;
}

/**
 * Provenance for a Tier-2 wrapped game. Required on every Tier-2 entry so the
 * shelf can attribute the upstream work honestly (author, license, source).
 */
export interface GameAttribution {
  /** The developer we credit — the original author or the port's author. */
  readonly author: string;
  /** SPDX-ish license name (e.g. "MIT", "The Unlicense", "GPL-3.0"). */
  readonly license: string;
  /** Canonical upstream URL (repo or project home) — the "view the original" link. */
  readonly upstreamUrl: string;
  /**
   * The original work this game pays homage to, if it descends from another
   * (e.g. a clone or a port). Free text: "Flappy Bird by Dong Nguyen". Optional.
   */
  readonly basedOn?: string;
}

/** Fields common to every catalog entry, whatever its tier. */
interface BaseGameEntry {
  readonly id: string;
  readonly title: string;
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
}

/**
 * A Tier-1 Croft-native game: determinism-first, verifiable outcome. `tier` is
 * optional and defaults to 1 — existing entries need no change.
 */
export interface Tier1GameEntry extends BaseGameEntry {
  readonly tier?: 1;
}

/**
 * A Tier-2 opportunistic wrap: an already-packaged ethical game taken as-is,
 * with **no verifiable outcome**. The discriminant `tier: 2` forces
 * `attribution` to be present so a wrap can never ship without honest credit.
 */
export interface Tier2GameEntry extends BaseGameEntry {
  readonly tier: 2;
  readonly attribution: GameAttribution;
}

/** A catalog entry describing a game and how to load it. */
export type GameEntry = Tier1GameEntry | Tier2GameEntry;
