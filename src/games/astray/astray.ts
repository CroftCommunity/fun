//! Astray — a Tier-2 wrapped game (a WebGL marble-in-maze by wwwtyro, The
//! Unlicense). It is not Croft-native and has no verifiable record; the shelf
//! says so via the honest-representation banner (rendered by the chrome). The
//! module is a thin adapter: it mounts the vendored bundle through the shared
//! `mountWrappedGame` primitive and tears it down on unmount. All provenance and
//! posture live in `tier2.meta.json` beside this file.

import type { GameModule } from "../../contract.js";
import { mountWrappedGame, type WrappedGameHandle } from "../../wrapped-game.js";

/** Construct a fresh Astray module. */
export function astrayModule(): GameModule {
  let handle: WrappedGameHandle | null = null;
  return {
    mount(container: HTMLElement): void {
      handle = mountWrappedGame(container, {
        src: "/astray/vendor/index.html",
        title: "Astray — a wrapped WebGL maze game",
      });
    },
    unmount(): void {
      handle?.teardown();
      handle = null;
    },
  };
}
