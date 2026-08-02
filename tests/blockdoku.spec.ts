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

test("selecting a piece glows exactly the core's legal anchors", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  // Select slot 0 through the live hook, then compare the glowed cells to the
  // core's legalMoves for that slot. The UI must never invent or drop legality.
  await page.evaluate(() => window.__blockdoku!.select(0));
  const expected = await page.evaluate(() =>
    window
      .__blockdoku!.game.legalMoves()
      .filter((m) => m.slot === 0)
      .map((m) => `${m.row},${m.col}`)
      .sort(),
  );
  const glowed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".bdk-cell.bdk-legal")]
      .map((c) => `${c.dataset.r},${c.dataset.c}`)
      .sort(),
  );
  expect(glowed).toEqual(expected);
  expect(glowed.length).toBeGreaterThan(0);
});

test("tapping a glowing cell places; an illegal tap is a no-op", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await page.evaluate(() => window.__blockdoku!.select(0));

  const before = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  // Tap a non-legal cell (find one not in the legal set) — nothing changes.
  const illegal = await page.evaluate(() => {
    const legal = new Set(
      window.__blockdoku!.game.legalMoves().filter((m) => m.slot === 0).map((m) => `${m.row},${m.col}`),
    );
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) if (!legal.has(`${r},${c}`)) return { r, c };
    return null;
  });
  if (illegal) {
    await page.locator(`.bdk-cell[data-r="${illegal.r}"][data-c="${illegal.c}"]`).click();
    expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).toBe(before);
  }

  // Now tap a glowing legal cell — the board changes.
  await page.locator(".bdk-cell.bdk-legal").first().click();
  expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).not.toBe(before);
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
