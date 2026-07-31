//! HexGL — a Tier-2 wrapped game (a futuristic WebGL racer by Thibaut Despoulain
//! / BKcore, MIT). Not Croft-native and no verifiable record; the chrome's
//! honest-representation banner says so. Thin adapter over the shared
//! `mountWrappedGame` primitive. Provenance + posture live in `tier2.meta.json`.

import type { GameModule } from "../../contract.js";
import { mountWrappedGame, type WrappedGameHandle } from "../../wrapped-game.js";

/** Construct a fresh HexGL module. */
export function hexglModule(): GameModule {
  let handle: WrappedGameHandle | null = null;
  return {
    mount(container: HTMLElement): void {
      handle = mountWrappedGame(container, {
        src: "/hexgl/vendor/index.html",
        title: "HexGL — a wrapped WebGL racing game",
      });
    },
    unmount(): void {
      handle?.teardown();
      handle = null;
    },
  };
}
