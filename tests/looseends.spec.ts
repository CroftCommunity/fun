//! Loose Ends wiring test: the game mounts at its own `/looseends/` URL, the
//! home → level flow renders, and play goes through the real core — a FREE tap
//! releases (remaining drops), a BLOCKED tap costs a droplet and never moves an
//! arrow (the core decides legality), a full clear reaches a verification-forward
//! win whose `?r=` share re-verifies, and the chrome is axe-clean + fits a phone.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

// The `window.__looseends` E2E hook is declared by the game module itself.

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__looseends));
}
async function openLevel(page: Page, n: number): Promise<void> {
  await page.evaluate((lvl) => window.__looseends!.openLevel(lvl), n);
  await expect(page.locator(".le-canvas")).toBeVisible();
}
const board = (page: Page): Promise<{ arrows: { present: boolean; free: boolean }[]; remaining: number }> =>
  page.evaluate(() => {
    const b = window.__looseends!.board();
    return { arrows: b.arrows.map((a) => ({ present: a.present, free: a.free })), remaining: b.remaining };
  });

test("Play opens the next unsolved level; the frame names it, and the game's own home is gone", async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  await expect(page.locator(".le-canvas")).toBeVisible();
  await expect(page.locator(".le-home")).toHaveCount(0);
  await expect(page.locator('.gf-stat[data-meter="level"]')).toContainText(/level 1/i);
  await expect(page.locator('.gf-stat[data-meter="solved"]')).toContainText(/100/);
  await expect(page.locator('.gf-verb[data-verb="new"]')).toHaveCount(1);
  // The rule sentence that was the home's tagline is a toast over the board.
  await expect(page.locator(".gf-toast")).toContainText(/untangle/i);
});

test("a level renders the canvas board, HUD, droplets, and hint", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  await openLevel(page, 6);
  await expect(page.locator(".le-canvas")).toBeVisible();
  await expect(page.locator(".le-hud")).toContainText(/level 6/i);
  await expect(page.locator(".le-droplet")).toHaveCount(3);
  await expect(page.locator(".le-hint-btn")).toBeVisible();
});

test("the core decides legality — a FREE tap releases, a BLOCKED tap only costs a droplet", async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  await openLevel(page, 6);

  const b0 = await board(page);
  const freeId = b0.arrows.findIndex((a) => a.present && a.free);
  expect(freeId, "a fresh board has a free arrow").toBeGreaterThanOrEqual(0);

  // A FREE tap releases: remaining drops by exactly one.
  await page.evaluate((id) => window.__looseends!.tapArrow(id), freeId);
  const b1 = await board(page);
  expect(b1.remaining).toBe(b0.remaining - 1);

  // A BLOCKED tap never moves an arrow — remaining is unchanged and a droplet dims.
  const b2 = await board(page);
  const blockedId = b2.arrows.findIndex((a) => a.present && !a.free);
  if (blockedId >= 0) {
    await page.evaluate((id) => window.__looseends!.tapArrow(id), blockedId);
    const b3 = await board(page);
    expect(b3.remaining, "a blocked tap changes nothing").toBe(b2.remaining);
    await expect(page.locator(".le-droplet.spent")).toHaveCount(1);
  }
});

test("clearing the board reaches a verified win, and its share re-verifies", async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  await openLevel(page, 3);

  // Greedy solve through the real tap path: release every free arrow until none.
  await page.evaluate(() => {
    const h = window.__looseends!;
    for (let guard = 0; guard < 500; guard++) {
      const b = h.board();
      if (b.remaining === 0) break;
      const free = b.arrows.map((a, i) => ({ a, i })).filter((x) => x.a.present && x.a.free);
      if (free.length === 0) break;
      for (const { i } of free) h.tapArrow(i);
    }
  });

  const modal = page.locator(".le-modal");
  await expect(modal).toBeVisible({ timeout: 4000 });
  await expect(modal.locator(".le-modal-head")).toContainText(/flawless|solved|untangled/i);
  // Verification is forward and passes for an honest clear.
  await expect(modal.locator(".le-verify.ok")).toBeVisible({ timeout: 4000 });

  const shareHref = await modal.locator(".le-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".le-shared")).toBeVisible();
  await expect(shared.locator(".le-verify.ok")).toBeVisible({ timeout: 4000 });
  await shared.close();
});

test("level select and daily calendar render from the home screen", async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  // Both live behind the New game card now: pick where to go, then Start.
  const go = async (where: string): Promise<void> => {
    await page.locator('.gf-verb[data-verb="new"]').click();
    await page.locator(`.gf-sheet [data-setting="mode"] input[value="${where}"]`).check();
    await page.locator(".gf-sheet .gf-sheet-start").click();
  };
  await go("levels");
  await expect(page.locator(".le-level-grid")).toBeVisible();
  await expect(page.locator(".le-tile")).toHaveCount(100);

  // Back from the grid returns to the board, not to a home that no longer exists.
  await page.locator(".le-back").click();
  await expect(page.locator(".le-canvas")).toBeVisible();
  await go("daily");
  await expect(page.locator(".le-cals .le-cal")).toHaveCount(12);
  await expect(page.locator(".le-streak-card")).toContainText(/daily streak/i);
  // Future days are locked (non-interactive).
  await expect(page.locator(".le-day-future").first()).toBeDisabled();
});

test("a release does not move the board, and neither does the settings sheet", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/looseends/?play=1");
  await ready(page);
  await openLevel(page, 6);
  const v = await boardTopStable(page, ".le-canvas", async () => {
    await page.evaluate(() => {
      const h = window.__looseends!;
      const free = h.board().arrows.findIndex((a) => a.present && a.free);
      if (free >= 0) h.tapArrow(free);
    });
    await page.waitForTimeout(250);
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("no axe violations in light and dark, and no horizontal overflow at 360px", async ({ page }) => {
  await page.goto("/looseends/?play=1");
  await ready(page);
  await openLevel(page, 6);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 360, height: 720 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, "no horizontal overflow at 360px").toBe(false);
});
