//! A minimal placeholder game module used to prove the chrome in all three
//! presentation modes without any game logic. Tracks a global mount counter so
//! tests can assert that switching to full-screen preserves the SAME instance
//! (re-parent, not remount).
//!
//! Since the game frame (plan 2026-08-30) it is also the frame's own exercise:
//! it declares one meter and one verb, and the verb changes the meter — the
//! cheapest proof that a change above the board moves nothing.

import type { GameModule, GameServices } from "../contract.js";
import { renderGameFrame, type GameFrame, type GameFrameSpec } from "../game-frame.js";
import type { Progress } from "../progress.js";

let totalMounts = 0;

/** Total times any placeholder instance has been mounted (test observability). */
export function placeholderMountCount(): number {
  return totalMounts;
}

/** Construct a fresh placeholder module. */
export function placeholderModule(): GameModule {
  let el: HTMLElement | null = null;
  let frame: GameFrame | null = null;
  let pokes = 0;
  let startedAt = new Date().toISOString();

  const spec = (): GameFrameSpec => ({
    title: "Placeholder",
    pitch: "Nothing to play; everything to prove.",
    meters: [{ kind: "stat", id: "pokes", value: pokes, label: "pokes" }],
    verbs: [
      {
        id: "poke",
        label: "Poke",
        icon: "☝",
        primary: true,
        onPress: () => {
          pokes += 1;
          frame?.update(spec());
        },
      },
    ],
  });

  return {
    mount(container: HTMLElement, services: GameServices): void {
      totalMounts += 1;
      // Inside the chrome the frame is the chrome's; declare into it. Mounted bare
      // (a unit test), the placeholder brings its own.
      frame = services.frame ?? renderGameFrame(container);
      frame.update(spec());
      el = document.createElement("div");
      el.className = "placeholder-game";
      el.dataset.mode = services.mode;
      el.dataset.mountCount = String(totalMounts);
      el.textContent = `Placeholder game — mounted in "${services.mode}" mode (mount #${totalMounts}).`;
      frame.stage.appendChild(el);
    },
    unmount(): void {
      el?.remove();
      frame = null;
      el = null;
    },
    // The store's smallest possible client: the counter IS the record.
    snapshot(): Progress {
      return {
        v: 1,
        status: "in-progress",
        startedAt,
        updatedAt: new Date().toISOString(),
        setup: { mode: "free" },
        record: { pokes },
        summary: { line: `${pokes} poke${pokes === 1 ? "" : "s"}` },
      };
    },
    resume(p: Progress): void {
      const rec = p.record as { pokes?: unknown };
      pokes = typeof rec?.pokes === "number" ? rec.pokes : 0;
      startedAt = p.startedAt;
      frame?.update(spec());
    },
  };
}
