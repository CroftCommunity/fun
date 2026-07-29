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
  readonly icon: string;
  readonly status: "playable" | "soon";
  /** Construct a fresh module instance. Absent for `soon` games. */
  readonly load?: () => GameModule;
}
