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
