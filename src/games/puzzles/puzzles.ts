//! The Tatham puzzles collection — a Tier-2 wrap presented as ONE drawer entry
//! whose module renders a picker over several vendored puzzles (Option A; see
//! plans/2026-07-31-tatham-puzzles-collection.md). Each puzzle is Simon Tatham's
//! emscripten build, vendored under `/puzzles/vendor/<id>.html` and mounted
//! through the shared `mountWrappedGame` iframe so the containment posture
//! (opaque-origin `allow-scripts`) cannot drift. Selecting a puzzle swaps the
//! frame; `?p=<id>` deep-links one. The collection grows by extending
//! `PUZZLE_MANIFEST` and vendoring the bundle — no chrome or contract change.

import type { GameModule } from "../../contract.js";
import { mountWrappedGame, type WrappedGameHandle } from "../../wrapped-game.js";

/** One vendored puzzle in the collection. */
export interface PuzzleDef {
  /** Stable id, matching the vendored bundle name and `?p=<id>`. */
  readonly id: string;
  /** Display name (as Simon Tatham names it). */
  readonly title: string;
  /** One-line "what you do", shown as the control's tooltip/label. */
  readonly blurb: string;
  /** Same-origin entry document for the sandboxed iframe. */
  readonly entry: string;
}

/** The vendored puzzles, in shelf order. Add a puzzle here + vendor its bundle. */
export const PUZZLE_MANIFEST: readonly PuzzleDef[] = [
  {
    id: "net",
    title: "Net",
    blurb: "Rotate each tile until the whole network links up with no loose ends.",
    entry: "/puzzles/vendor/net.html",
  },
];

/**
 * The puzzle to show first: the one named by `?p=<id>` when it is valid, else
 * the first in the manifest. Pure so it is unit-testable without a location.
 */
export function initialPuzzle(search: string): PuzzleDef {
  const wanted = new URLSearchParams(search).get("p");
  return PUZZLE_MANIFEST.find((p) => p.id === wanted) ?? PUZZLE_MANIFEST[0]!;
}

/** Construct a fresh puzzles-collection module. */
export function puzzlesModule(): GameModule {
  let handle: WrappedGameHandle | null = null;
  let currentId = "";

  return {
    mount(container: HTMLElement): void {
      const root = document.createElement("div");
      root.className = "puzzle-collection";

      // A toolbar of toggle buttons (role=group + aria-pressed) rather than a
      // tablist: no separate tabpanel to associate, so it stays axe-clean and
      // the wrapped-game frame remains the single mounted surface.
      const picker = document.createElement("div");
      picker.className = "puzzle-picker";
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", "Choose a puzzle");

      const host = document.createElement("div");
      host.className = "puzzle-host";

      const paintPressed = (): void => {
        for (const b of picker.querySelectorAll<HTMLButtonElement>("button[data-puzzle]")) {
          b.setAttribute("aria-pressed", String(b.dataset.puzzle === currentId));
        }
      };

      const select = (def: PuzzleDef): void => {
        if (def.id === currentId) return;
        currentId = def.id;
        handle?.teardown();
        handle = mountWrappedGame(host, {
          src: def.entry,
          title: `${def.title} — a Simon Tatham puzzle`,
        });
        paintPressed();
      };

      for (const def of PUZZLE_MANIFEST) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "puzzle-tab";
        btn.dataset.puzzle = def.id;
        btn.setAttribute("aria-pressed", "false");
        btn.title = def.blurb;
        btn.textContent = def.title;
        btn.addEventListener("click", () => select(def));
        picker.append(btn);
      }

      root.append(picker, host);
      container.append(root);

      const search = typeof location === "undefined" ? "" : location.search;
      select(initialPuzzle(search));
    },

    unmount(): void {
      handle?.teardown();
      handle = null;
      currentId = "";
    },
  };
}
