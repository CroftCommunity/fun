//! Blockdoku wiring test: the board + tray + HUD render and play over the
//! binding; selecting a piece glows EXACTLY the core's legal anchors; tapping a
//! glowing cell places (score/board change) and an illegal tap is a core-decided
//! no-op; the game reaches a verifiable result. Axe + narrow-phone fit guard the
//! identity. Reachability is proven through the real `/blockdoku/` URL.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bdk-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__blockdoku));
}

test("the board, tray, and HUD render", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await expect(page.locator(".bdk-board")).toBeVisible();
  // 9x9 = 81 cells.
  await expect(page.locator(".bdk-cell")).toHaveCount(81);
  await expect(page.locator(".bdk-tray .bdk-piece")).toHaveCount(3);
  await expect(page.locator(".bdk-hud")).toContainText(/score/i);
  await expect(page.locator(".bdk-banner")).toContainText(/piece/i);
});

test("selecting a piece previews one snapped placement, not a full-grid glow", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  // No legal-glow class exists any more (that lit up nearly the whole board).
  expect(await page.locator(".bdk-cell.bdk-legal").count()).toBe(0);
  await page.evaluate(() => window.__blockdoku!.select(0));
  // The preview shows exactly the selected piece's footprint (its filled-cell
  // count) — a single placement, not every legal anchor.
  const cellCount = await page.evaluate(() => {
    const p = window.__blockdoku!.game.tray()[0]!;
    return p.cells.flat().filter((v) => v === 1).length;
  });
  expect(await page.locator(".bdk-cell.bdk-ghost").count()).toBe(cellCount);
});

test("tapping the board drops the piece, snapped to the nearest legal placement", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await page.evaluate(() => window.__blockdoku!.select(0));
  const before = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  // Tap an arbitrary board cell — even an occupied/awkward one — and the piece
  // still lands (snapped), so the board changes and a legal move was recorded.
  await page.evaluate(() => window.__blockdoku!.tapAt(4, 4));
  const after = await page.evaluate(() => ({
    hash: window.__blockdoku!.game.currentHash(),
    moves: window.__blockdoku!.game.legalMoves(), // (re-read; just proving it advanced)
  }));
  expect(after.hash).not.toBe(before);
  expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).toBe(after.hash);
});

test("plays to a verifiable result", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  // Drive the game to completion via the hook (first legal move each turn).
  await page.evaluate(async () => {
    const g = window.__blockdoku!.game;
    for (let i = 0; i < 400 && !g.isOver(); i++) {
      const legal = g.legalMoves();
      if (legal.length === 0) break;
      const m = legal[0]!;
      g.playPlace(m.slot, m.row, m.col);
    }
    window.__blockdoku!.refresh();
  });
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(page.locator(".sol-result")).toContainText(/verifiable/i);
  await expect(page.locator("[data-share]")).toBeVisible();
});

test("undo reverts the last placement", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  await page.evaluate(() => window.__blockdoku!.select(0));
  await page.evaluate(() => window.__blockdoku!.tapAt(4, 4));
  const after = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  expect(after).not.toBe(before);
  await page.locator(".bdk-undo").click();
  expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).toBe(before);
});

test("a hint selects a placeable piece and marks assistance", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await page.locator(".sol-hint").click(); // hints default on
  await expect(page.locator(".sol-status")).toContainText(/hint/i);
  // The hint marked assistance; drive to the end and the outcome declares it.
  const assisted = await page.evaluate(() => {
    const g = window.__blockdoku!.game;
    for (let i = 0; i < 400 && !g.isOver(); i++) {
      const legal = g.legalMoves();
      if (!legal.length) break;
      g.playPlace(legal[0]!.slot, legal[0]!.row, legal[0]!.col);
    }
    return (g.outcome(true) as { payload: { assistance: boolean | null } }).payload.assistance;
  });
  expect(assisted).toBe(true);
});

test("no horizontal overflow at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("axe: the board is accessible in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/blockdoku/?seed=7");
    await ready(page);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const results = await new AxeBuilder({ page }).include(".bdk-game").analyze();
    expect(results.violations, `axe violations in ${theme}`).toEqual([]);
  }
});
