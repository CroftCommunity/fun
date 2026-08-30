//! Blockdoku wiring test: the board + tray + HUD render and play over the
//! binding; the nine 3×3 boxes are drawn; nothing glows until a piece is held;
//! a piece can be DRAGGED from the tray onto the board to place it, and the
//! tap/keyboard fallback places at an exact legal anchor; the game reaches a
//! verifiable result. Axe + narrow-phone fit guard the identity. Reachability is
//! proven through the real `/blockdoku/` URL.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bdk-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__blockdoku));
}

test("the board, tray, and HUD render with visible 3×3 boxes", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await expect(page.locator(".bdk-board")).toBeVisible();
  // 9x9 = 81 cells.
  await expect(page.locator(".bdk-cell")).toHaveCount(81);
  await expect(page.locator(".bdk-tray .bdk-piece")).toHaveCount(3);
  await expect(page.locator(".gf-meters")).toContainText(/score/i);
  await expect(page.locator(".gf-meters")).toContainText(/streak/i);
  // The instruction is a toast over the stage, not a banner that re-wrote itself
  // in flow above the board on every selection.
  await expect(page.locator(".gf-toast")).toContainText(/piece/i);
  await expect(page.locator(".bdk-banner, .bdk-hud, .sol-controls")).toHaveCount(0);
  // The nine 3×3 boxes are drawn via heavy dividers on every third row/column
  // start (cols/rows 0,3,6): 3 columns × 9 = 27 each. Their presence is what
  // makes the sub-squares legible.
  await expect(page.locator(".bdk-cell.bdk-box-left")).toHaveCount(27);
  await expect(page.locator(".bdk-cell.bdk-box-top")).toHaveCount(27);
});

test("nothing glows until a piece is held", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  // At rest: no stray cursor ring, no preview. (The old build left a permanent
  // ring glowing in the centre.)
  expect(await page.locator(".bdk-cell.bdk-cursor").count()).toBe(0);
  expect(await page.locator(".bdk-cell.bdk-ghost, .bdk-cell.bdk-ghost-bad").count()).toBe(0);
  // Pick up a piece and the preview appears — exactly its footprint of cells.
  await page.evaluate(() => window.__blockdoku!.select(0));
  const cellCount = await page.evaluate(() => {
    const p = window.__blockdoku!.game.tray()[0]!;
    return p.cells.flat().filter((v) => v === 1).length;
  });
  expect(await page.locator(".bdk-cell.bdk-ghost, .bdk-cell.bdk-ghost-bad").count()).toBe(cellCount);
});

test("dragging a piece from the tray onto the board places it", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  // Ask the core for a legal anchor for piece 0, then compute the exact pointer
  // position that lands the dragged clone's top-left on that anchor.
  const plan = await page.evaluate(() => {
    const g = window.__blockdoku!.game;
    const m = g.legalMoves().find((x) => x.slot === 0)!;
    const piece = g.tray()[0]!;
    const c0 = document
      .querySelector('.bdk-cell[data-r="0"][data-c="0"]')!
      .getBoundingClientRect();
    const cell = c0.width;
    const cloneLeft = c0.left + m.col * cell;
    const cloneTop = c0.top + m.row * cell;
    return {
      slot: 0,
      // Mirror the module's grab offsets (centre-x, lifted above the finger).
      px: cloneLeft + (piece.cols * cell) / 2,
      py: cloneTop + piece.rows * cell + cell * 0.6,
    };
  });
  const before = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  // A real pointer drag: press the tray piece, drag over the board, release.
  const pieceBox = (await page.locator('.bdk-piece[data-slot="0"]').boundingBox())!;
  await page.mouse.move(pieceBox.x + pieceBox.width / 2, pieceBox.y + pieceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(plan.px, plan.py, { steps: 8 });
  // While hovering a legal cell, the preview shows the valid (`bdk-ghost`) class.
  await expect(page.locator(".bdk-cell.bdk-ghost")).not.toHaveCount(0);
  await page.mouse.up();
  // The drop placed the piece, so the board advanced and no clone lingers.
  const after = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  expect(after).not.toBe(before);
  await expect(page.locator(".bdk-drag")).toHaveCount(0);
});

test("tap-to-place drops the piece at an exact legal anchor", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  // Select piece 0 and place it at a core-legal anchor (no "nearest fit" magic).
  const moved = await page.evaluate(() => {
    window.__blockdoku!.select(0);
    const m = window.__blockdoku!.game.legalMoves().find((x) => x.slot === 0)!;
    window.__blockdoku!.tapAt(m.row, m.col);
    return true;
  });
  expect(moved).toBe(true);
  const after = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  expect(after).not.toBe(before);
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
  await page.evaluate(() => {
    window.__blockdoku!.select(0);
    const m = window.__blockdoku!.game.legalMoves().find((x) => x.slot === 0)!;
    window.__blockdoku!.tapAt(m.row, m.col);
  });
  const after = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  expect(after).not.toBe(before);
  await page.locator('.gf-verb[data-verb="undo"]').click();
  expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).toBe(before);
});

test("a hint selects a placeable piece and marks assistance", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="hint"]').click(); // hints default on
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

// --- the frame (plan Phase 10): verbs, the chip, setup, and a board that does not move ---

test("the verbs, the chip, and the New board sheet's difficulty", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  const verbs = await page.locator(".gf-dock .gf-verb").evaluateAll((els) => els.map((e) => e.getAttribute("data-verb")));
  expect(verbs).toEqual(["undo", "hint", "new", "settings"]);
  await expect(page.locator(".gf-mode")).toContainText(/normal · new/i);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet.locator('[data-setting="difficulty"] .sheet-choice-opt')).toHaveCount(4);
  await sheet.locator('[data-setting="difficulty"] input[value="hard"]').check();
  await sheet.locator(".gf-sheet-start").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".gf-mode")).toContainText(/hard/i);
});

test("the board does not move when a piece is picked up, put down, hinted, or the sheet opens", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  const v = await boardTopStable(page, ".bdk-board", async () => {
    await page.evaluate(() => window.__blockdoku!.select(0));
    await expect(page.locator(".bdk-cell.bdk-ghost, .bdk-cell.bdk-ghost-bad").first()).toBeVisible();
    await page.evaluate(() => window.__blockdoku!.deselect());
    await page.locator('.gf-verb[data-verb="hint"]').click();
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".gf-sheet")).toBeHidden();
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("leaving mid-board and returning to the bare URL resumes the placements", async ({ page }) => {
  await page.goto("/blockdoku/?seed=7");
  await ready(page);
  await page.evaluate(() => {
    window.__blockdoku!.select(0);
    const m = window.__blockdoku!.game.legalMoves().find((x) => x.slot === 0)!;
    window.__blockdoku!.tapAt(m.row, m.col);
  });
  const hash = await page.evaluate(() => window.__blockdoku!.game.currentHash());
  await page.goto("/blockdoku/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toContainText(/score/i);
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  expect(await page.evaluate(() => window.__blockdoku!.game.currentHash())).toBe(hash);
});
