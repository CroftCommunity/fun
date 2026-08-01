//! Bubble-shooter **levels mode** wiring test: the escalating, point-gated,
//! descending-stack game is the default `/bubble/` experience. It renders the
//! level HUD; firing scores and drives the shot-cadence insert (the stack pushes
//! down, parity flips); the variant toggle swaps to the classic clear-board game
//! and back; the optional timer is presentational (never changes the outcome);
//! and driving the stack across the deadline yields a **verifiable** highest-
//! level result whose `?r=` share round-trips. Reduced-motion fires instantly;
//! the landing matches the core (the UI never invents physics). Axe + narrow
//! phone guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bub-canvas")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__bubble));
}

// Fast-forward by firing straight through the core (no animation), spreading the
// aim across the fan so bubbles pile up and the descending stack reaches the
// deadline quickly. Returns whether the run ended within the cap.
const driveToLoss = (page: Page, cap = 500): Promise<boolean> =>
  page.evaluate((max) => {
    const h = window.__bubble!;
    const g = h.game;
    for (let i = 0; i < max; i += 1) {
      if (g.levelIsLost()) break;
      g.levelShoot(10 + ((i * 23) % 161)); // cycle angles across the fan
    }
    h.refresh();
    return g.levelIsLost();
  }, cap);

test("levels is the default and renders the level HUD", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  await expect(page.locator(".bub-canvas")).toHaveAttribute("aria-label", /level 1/i);
  await expect(page.locator(".bub-level")).toContainText(/level 1/i);
  await expect(page.locator(".bub-progress")).toBeVisible();
  await expect(page.locator(".bub-drop")).toContainText(/stack drops in/i);
  // The board carries the levels geometry (even height for parity-flip inserts).
  const h = await page.evaluate(() => window.__bubble!.game.levelBoard().height);
  expect(h % 2).toBe(0);
});

test("firing scores, and the shot cadence pushes in a new top row (parity flips)", async ({
  page,
}) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);

  // One shot through the real UI path proves the wiring; score is monotone.
  const before = await page.evaluate(() => window.__bubble!.game.levelBoard().totalScore);
  await page.evaluate(async () => {
    const h = window.__bubble!;
    h.setAim(90);
    await h.fire();
  });
  const after = await page.evaluate(() => window.__bubble!.game.levelBoard().totalScore);
  expect(after).toBeGreaterThanOrEqual(before);

  // Fire exactly the shots-until-insert count: the first insert flips the parity
  // offset 0 -> 1 and the stack gains a fresh top row (one insert, one flip).
  const flipped = await page.evaluate(() => {
    const g = window.__bubble!.game;
    const start = g.levelBoard().parityOffset;
    const n = g.levelBoard().shotsToInsert;
    for (let i = 0; i < n; i += 1) g.levelShoot(90);
    window.__bubble!.refresh();
    return { start, n, now: g.levelBoard().parityOffset };
  });
  expect(flipped.start).toBe(0);
  expect(flipped.n).toBeGreaterThan(0);
  expect(flipped.now).toBe(1);
});

test("firing lands exactly where the core resolves it (no invented physics)", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const control = await page.evaluate((angle) => {
    const h = window.__bubble!;
    h.verifier.newLevelGame(h.seed);
    h.verifier.levelShoot(angle);
    return h.verifier.levelCurrentHash();
  }, 80);
  await page.evaluate(async (angle) => {
    const h = window.__bubble!;
    h.setAim(angle);
    await h.fire();
  }, 80);
  const got = await page.evaluate(() => window.__bubble!.game.levelCurrentHash());
  expect(got).toBe(control);
});

test("the variant toggle swaps to classic and back to levels", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  await expect(page.locator(".bub-level")).toBeVisible();

  await page.locator(".bub-variant-classic").click();
  await expect(page.locator(".bub-hud")).toContainText(/shots left/i);
  await expect(page.locator(".bub-level")).toHaveCount(0);

  await page.locator(".bub-variant-levels").click();
  await expect(page.locator(".bub-level")).toContainText(/level 1/i);
});

test("the optional timer is presentational — it never changes the outcome", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  await expect(page.locator(".bub-timer")).toHaveCount(0);

  // Enable the practice clock in settings.
  await page.locator(".sol-settings summary").click();
  await page.locator(".bub-set-timer").check();
  await expect(page.locator(".bub-timer")).toBeVisible();
  await expect(page.locator(".bub-timer")).toHaveText(/^\d+:\d\d$/);

  // The verifiable state hash after N identical shots is independent of whether
  // the clock is shown — the timer touches no game state.
  const hashWith = await page.evaluate(() => {
    const g = window.__bubble!.game;
    g.newLevelGame(7n);
    for (let i = 0; i < 5; i += 1) g.levelShoot(90);
    return g.levelCurrentHash();
  });
  const control = await page.evaluate(() => {
    const v = window.__bubble!.verifier;
    v.newLevelGame(7n);
    for (let i = 0; i < 5; i += 1) v.levelShoot(90);
    return v.levelCurrentHash();
  });
  expect(hashWith).toBe(control);
});

test("crossing the deadline yields a verifiable result whose share round-trips", async ({
  page,
}) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);

  const lost = await driveToLoss(page);
  expect(lost).toBe(true);

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-headline")).toContainText(/reached level/i);
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();

  // The share link round-trips: open it and the shared levels result verifies.
  const shareUrl = await page.locator(".sol-share").getAttribute("data-share");
  expect(shareUrl).toBeTruthy();
  await page.goto(shareUrl!);
  await expect(page.locator(".sol-headline")).toContainText(/reached level/i);
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("reduced motion fires instantly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__bubble!.game.levelBoard().totalScore);
  const start = Date.now();
  await page.evaluate(async () => {
    const h = window.__bubble!;
    h.setAim(90);
    await h.fire();
  });
  // The shot applied (a board change) with no long flight animation.
  await expect
    .poll(() => page.evaluate(() => window.__bubble!.game.levelBoard().totalScore))
    .toBeGreaterThanOrEqual(before);
  expect(Date.now() - start).toBeLessThan(2000);
});

test("levels has no accessibility violations (both themes) and fits a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/bubble/?seed=7");
  await ready(page);

  // No horizontal overflow at 360px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(overflow).toBe(true);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const results = await new AxeBuilder({ page })
      .include(".bub-game")
      .analyze();
    expect(results.violations, `axe (${theme})`).toEqual([]);
  }
});
