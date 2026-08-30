//! Color Sort ↔ mock E parity (mocks/e-color-sort.claims.json). One test per claim,
//! titled exactly as the claim names it — tests/mock-parity.test.ts requires the
//! title once the claim's phase is COMPLETE in the plan. Each test proves the
//! claim the way its `kind` says: structure by DOM, measure by rects, behaviour by
//! driving the core and reading animations, look by computed style.

import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".cs-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__colorSort));
}

/** A deterministic random walk in the page until the core reports deadlock. */
async function driveToDeadlock(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = window.__colorSort!;
    let s = 0x9e3779b9;
    const rnd = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let attempt = 0; attempt < 400; attempt++) {
      h.game.restart();
      for (let i = 0; i < 80; i++) {
        const b = h.board();
        if (b.deadlocked || b.won) break;
        const mv = b.moves[Math.floor(rnd() * b.moves.length)]!;
        h.game.pour(mv.from, mv.to);
      }
      if (h.board().deadlocked) {
        h.refresh();
        return true;
      }
    }
    return false;
  });
}

test("mock E1.1: a bare land opens the poster, not a board", async ({ page }) => {
  await page.goto("/color-sort/");
  const poster = page.locator(".gf-start.gf-poster");
  await expect(poster).toBeVisible();
  await expect(poster.locator(".gf-start-title")).toHaveText("Color Sort");
  await expect(poster.locator(".gf-start-pitch")).not.toBeEmpty();
  await expect(poster.locator('.gf-start-setup [data-setting="mode"]')).toHaveCount(1);
  await expect(poster.locator(".gf-play")).toBeVisible();
  await expect(page.locator(".cs-board")).toHaveCount(0);
});

test("mock E2.1: meters and verbs are the frame's, in the mock's order", async ({ page }) => {
  await page.goto("/color-sort/?level=3");
  await ready(page);
  // Three stats, always: moves · level (or par, on a daily) · best.
  const meters = await page.locator(".gf-meters .gf-stat").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.meter),
  );
  expect(meters).toEqual(["moves", "mark", "best"]);
  await expect(page.locator('.gf-stat[data-meter="mark"] .gf-stat-label')).toHaveText(/level/i);
  // The dock, left to right: Undo · Hint · New game · Restart · Settings (the frame's).
  const verbs = await page.locator(".gf-dock .gf-verb").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.verb),
  );
  expect(verbs).toEqual(["undo", "hint", "new", "restart", "settings"]);
});

test("mock E2.2: the board does not move on pour, deadlock, hint or undo", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?level=25"); // nine colours: a random walk dead-ends readily
  await ready(page);
  const v = await boardTopStable(page, ".cs-board", async () => {
    const mv = await page.evaluate(() => window.__colorSort!.game.hint());
    await page.locator(`.cs-tube[data-tube="${mv!.from}"]`).click();
    await page.locator(`.cs-tube[data-tube="${mv!.to}"].legal`).click();
    await page.locator('.gf-verb[data-verb="hint"]').click();
    await page.locator('.gf-verb[data-verb="undo"]').click();
    await page.locator('.gf-verb[data-verb="undo"]').click();
    expect(await driveToDeadlock(page)).toBe(true);
    await expect(page.locator(".gf-toast")).toContainText(/no moves left/i);
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("mock E2.3: tubes clear the 44px tap floor at 390", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?play=1"); // the daily: twelve tubes, the tightest fit
  await ready(page);
  const boxes = await page.locator(".cs-tube").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  );
  expect(boxes).toHaveLength(12);
  for (const b of boxes) {
    expect(b.w, `tube width ${b.w}`).toBeGreaterThanOrEqual(44);
    expect(b.h, `tube height ${b.h}`).toBeGreaterThanOrEqual(44);
  }
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("mock E2.4: deadlock is a stage toast, not a banner", async ({ page }) => {
  await page.goto("/color-sort/?level=25");
  await ready(page);
  expect(await driveToDeadlock(page)).toBe(true);
  const toast = page.locator(".gf-stage .gf-toast");
  await expect(toast).toContainText(/no moves left/i);
  expect(await toast.evaluate((e) => getComputedStyle(e).position)).toBe("absolute");
  await expect(page.locator(".cs-banner")).toHaveCount(0);
});

test("mock E7.1: the desktop rail carries meters, verbs, This game and settings", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/color-sort/?level=2");
  await ready(page);
  await expect(page.locator("[data-gf-shape]")).toHaveAttribute("data-gf-shape", "rail");
  const rail = page.locator(".gf-extra");
  await expect(page.locator(".gf-meters .gf-stat")).toHaveCount(3);
  for (const verb of ["undo", "hint", "new", "restart"]) {
    await expect(page.locator(`.gf-dock .gf-verb[data-verb="${verb}"]`)).toHaveCount(1);
  }
  await expect(rail.locator(".gf-readonly")).toContainText(/mode/i);
  for (const setting of ["skin", "icons", "strict"]) {
    await expect(rail.locator(`[data-setting="${setting}"]`)).toHaveCount(1);
  }
});
