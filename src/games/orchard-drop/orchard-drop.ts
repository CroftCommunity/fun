//! Orchard Drop — a Tier-2 wrapped game (an original Suika-style fruit-merge
//! game built for the shelf, bundling the Matter.js physics engine, MIT © liabru).
//! It is physics-driven and keeps no verifiable record, so it is honestly
//! represented as a wrap: the chrome renders the "no verifiable record" banner
//! and credits Matter.js + the Suika lineage. This module is a thin adapter that
//! mounts the vendored single-file bundle through the shared `mountWrappedGame`
//! primitive and tears it down on unmount. Provenance + posture live in
//! `tier2.meta.json` beside this file.

import type { GameModule } from "../../contract.js";
import { mountWrappedGame, type WrappedGameHandle } from "../../wrapped-game.js";

/** Construct a fresh Orchard Drop module. */
export function orchardDropModule(): GameModule {
  let handle: WrappedGameHandle | null = null;
  return {
    mount(container: HTMLElement): void {
      handle = mountWrappedGame(container, {
        src: "/orchard-drop/vendor/index.html",
        title: "Orchard Drop — a wrapped fruit-merge game",
      });
    },
    unmount(): void {
      handle?.teardown();
      handle = null;
    },
  };
}
