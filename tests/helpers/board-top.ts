//! The board-top sampler: the game frame's rule 1 — nothing above the board changes
//! height while you play — as a measurement. Samples the board's `top` on every
//! animation frame from before an action until it resolves, then judges the range.
//!
//! Plan Phase 0 D4 proved the sampler sees the engine's move (27–53 frames per turn
//! on both engines) and found Othello's board moving 24.8px on WebKit every turn.
//! The pure `judgeTops` is unit-tested with named boundaries; `boardTopStable` runs
//! the same logic in the page through Playwright.

import type { Page } from "@playwright/test";

/** What a sample run produced. */
export interface TopSamples {
  readonly frames: number;
  readonly min: number;
  readonly max: number;
}

/** The verdict. Sub-pixel drift (< 1px) is allowed; a pixel is a jump. */
export interface TopVerdict {
  readonly stable: boolean;
  readonly delta: number;
}

/** Judge a list of sampled tops. Zero frames is an error, never "stable". */
export function judgeTops(tops: readonly number[]): TopVerdict {
  if (tops.length === 0) {
    throw new Error("board-top: no frames observed — the sampler saw nothing, so it cannot report stable");
  }
  const min = Math.min(...tops);
  const max = Math.max(...tops);
  const delta = max - min;
  return { stable: delta < 1, delta };
}

/**
 * A sampler driven by a `requestAnimationFrame`-shaped scheduler: reads `getTop()`
 * every frame until `stop()`; returns the tops seen. The page-side sampler in
 * `boardTopStable` is this, inlined.
 */
export function sample(getTop: () => number | null, raf: (cb: () => void) => void): { stop(): number[] } {
  const tops: number[] = [];
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    const t = getTop();
    if (t !== null) tops.push(t);
    raf(tick);
  };
  tick();
  return {
    stop(): number[] {
      stopped = true;
      return tops;
    },
  };
}

/**
 * Sample `selector`'s top across `action` in the page and judge it. The element is
 * re-queried every frame, because a game re-renders with `replaceChildren`.
 */
export async function boardTopStable(page: Page, selector: string, action: () => Promise<unknown>): Promise<TopVerdict & TopSamples> {
  await page.evaluate((sel) => {
    const w = window as unknown as { __bt?: { tops: number[]; stopped: boolean } };
    w.__bt = { tops: [], stopped: false };
    const tick = (): void => {
      const s = w.__bt!;
      if (s.stopped) return;
      const el = document.querySelector(sel);
      if (el) s.tops.push(el.getBoundingClientRect().top);
      requestAnimationFrame(tick);
    };
    tick();
  }, selector);
  await action();
  const tops = await page.evaluate(() => {
    const w = window as unknown as { __bt: { tops: number[]; stopped: boolean } };
    w.__bt.stopped = true;
    return w.__bt.tops;
  });
  const verdict = judgeTops(tops);
  return { ...verdict, frames: tops.length, min: Math.min(...tops), max: Math.max(...tops) };
}
