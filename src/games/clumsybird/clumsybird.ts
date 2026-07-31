//! Clumsy Bird — a Tier-2 wrapped game (a MelonJS Flappy-Bird homage by
//! ellisonleao, GPL-3.0). Not Croft-native and no verifiable record; the chrome's
//! honest-representation banner says so and credits the original. Thin adapter
//! over the shared `mountWrappedGame` primitive. Provenance + posture (and the
//! GPL source offer, via `upstreamUrl`/`upstreamRef`) live in `tier2.meta.json`.

import type { GameModule } from "../../contract.js";
import { mountWrappedGame, type WrappedGameHandle } from "../../wrapped-game.js";

/** Construct a fresh Clumsy Bird module. */
export function clumsybirdModule(): GameModule {
  let handle: WrappedGameHandle | null = null;
  return {
    mount(container: HTMLElement): void {
      handle = mountWrappedGame(container, {
        src: "/clumsybird/vendor/index.html",
        title: "Clumsy Bird — a wrapped Flappy-Bird homage",
      });
    },
    unmount(): void {
      handle?.teardown();
      handle = null;
    },
  };
}
