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
  /** Upstream author / project owner. */
  readonly author: string;
  /** SPDX-ish license name (e.g. "MIT", "The Unlicense", "GPL-3.0"). */
  readonly license: string;
  /** Canonical upstream URL (repo or project home). */
  readonly upstreamUrl: string;
}

/** Fields common to every catalog entry, whatever its tier. */
interface BaseGameEntry {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly status: "playable" | "soon";
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
