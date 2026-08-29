//! Loose Ends wiring test: the game mounts at its own `/looseends/` URL, the
//! home → level flow renders, and play goes through the real core — a FREE tap
//! releases (remaining drops), a BLOCKED tap costs a droplet and never moves an
//! arrow (the core decides legality), a full clear reaches a verification-forward
//! win whose `?r=` share re-verifies, and the chrome is axe-clean + fits a phone.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

test("mounts at its own URL and shows the home screen", async ({ page }) => {
  await page.goto("/looseends/");
  await ready(page);
  await expect(page.locator(".le-home")).toBeVisible();
  await expect(page.locator(".le-logo")).toContainText(/loose ends/i);
  await expect(page.locator(".le-home-actions")).toContainText(/daily puzzle/i);
});

test("a level renders the canvas board, HUD, droplets, and hint", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/looseends/");
  await ready(page);
  await openLevel(page, 6);
  await expect(page.locator(".le-canvas")).toBeVisible();
  await expect(page.locator(".le-hud")).toContainText(/level 6/i);
  await expect(page.locator(".le-droplet")).toHaveCount(3);
  await expect(page.locator(".le-hint-btn")).toBeVisible();
});

test("the core decides legality — a FREE tap releases, a BLOCKED tap only costs a droplet", async ({ page }) => {
  await page.goto("/looseends/");
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
  await page.goto("/looseends/");
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
  await page.goto("/looseends/");
  await ready(page);
  await page.getByRole("button", { name: "All levels" }).click();
  await expect(page.locator(".le-level-grid")).toBeVisible();
  await expect(page.locator(".le-tile")).toHaveCount(100);

  await page.locator(".le-back").click();
  await page.getByRole("button", { name: "Daily puzzle" }).click();
  await expect(page.locator(".le-cals .le-cal")).toHaveCount(12);
  await expect(page.locator(".le-streak-card")).toContainText(/daily streak/i);
  // Future days are locked (non-interactive).
  await expect(page.locator(".le-day-future").first()).toBeDisabled();
});

test("no axe violations in light and dark, and no horizontal overflow at 360px", async ({ page }) => {
  await page.goto("/looseends/");
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
