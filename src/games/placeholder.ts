//! A minimal placeholder game module used to prove the chrome in all three
//! presentation modes without any game logic. Tracks a global mount counter so
//! tests can assert that switching to full-screen preserves the SAME instance
//! (re-parent, not remount).

import type { GameModule, GameServices } from "../contract.js";

let totalMounts = 0;

/** Total times any placeholder instance has been mounted (test observability). */
export function placeholderMountCount(): number {
  return totalMounts;
}

/** Construct a fresh placeholder module. */
export function placeholderModule(): GameModule {
  let el: HTMLElement | null = null;
  return {
    mount(container: HTMLElement, services: GameServices): void {
      totalMounts += 1;
      el = document.createElement("div");
      el.className = "placeholder-game";
      el.dataset.mode = services.mode;
      el.dataset.mountCount = String(totalMounts);
      el.textContent = `Placeholder game — mounted in "${services.mode}" mode (mount #${totalMounts}).`;
      container.appendChild(el);
    },
    unmount(): void {
      el?.remove();
      el = null;
    },
  };
}
