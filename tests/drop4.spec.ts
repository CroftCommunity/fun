//! Drop 4 wiring test: the board + turn bar + options render and play over the
//! binding; the whole column is a drop target with a core-driven legal glow; a
//! tap drops the player's disc and the engine replies with a visible last-move
//! ring; a full game plays to a terminal result whose verification-forward end
//! screen shows the final board (winning four highlighted) and a re-verifying
//! `?r=` share; the difficulty picker and the mark chooser take effect; hints-off
//! "I'm done" ends. Axe + narrow-phone fit + centred-board guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".drop4-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__drop4));
}

/** Number of discs on the board (both sides). */
const filled = (page: Page): Promise<number> =>
  page.evaluate(() =>
    window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length,
  );

/** Wait until it is the human's turn again (Side A) or the match is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => {
    const b = window.__drop4!.game.board();
    return b.toMove === 1 || b.result !== -1;
  });

test("the board, columns, turn bar, and options render", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await expect(page.locator(".drop4-board")).toBeVisible();
  await expect(page.locator(".drop4-col")).toHaveCount(7);
  // A goal banner explains the game (four in a row).
  await expect(page.locator(".drop4-banner")).toContainText(/four in a row/i);
  // The opponent has an identity: the turn bar names You and The Engine.
  await expect(page.locator(".drop4-turnbar")).toContainText(/you/i);
  await expect(page.locator(".drop4-turnbar")).toContainText(/the engine/i);
  // The difficulty picker offers the four levels.
  await expect(page.locator(".drop4-level option")).toHaveCount(4);
  // Fresh board: empty, and every column glows as a legal target.
  expect(await filled(page)).toBe(0);
  await expect(page.locator(".drop4-col.legal")).toHaveCount(7);
});

test("tapping a column drops a disc and the engine replies with a visible last move", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  expect(await filled(page)).toBe(0);
  await page.locator('.drop4-col[data-col="3"]').click();
  // The player's disc lands, then the engine replies — two discs on the board.
  await page.waitForFunction(
    () => window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length === 2,
  );
  // The engine's move is highlighted so the player can see where it went.
  await expect(page.locator(".drop4-cell.just-played")).toHaveCount(1);
});

test("the core decides legality — a filled column is no longer a legal target", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  for (let i = 0; i < 6; i += 1) {
    const legal = await page.evaluate(() => window.__drop4!.game.board().legal.includes(0));
    const over = await page.evaluate(() => window.__drop4!.game.board().result !== -1);
    if (!legal || over) break;
    await page.locator('.drop4-col[data-col="0"]').click();
    await waitHumanOrOver(page);
  }
  const col0Full = await page.evaluate(() => !window.__drop4!.game.board().legal.includes(0));
  if (col0Full) {
    await expect(page.locator('.drop4-col[data-col="0"]')).not.toHaveClass(/\blegal\b/);
    const before = await page.evaluate(() => window.__drop4!.game.currentHash());
    await page.locator('.drop4-col[data-col="0"]').click();
    const after = await page.evaluate(() => window.__drop4!.game.currentHash());
    expect(after, "a tap on a full column is a no-op").toBe(before);
  }
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator(".drop4-level").selectOption("Hard");
  const stored = await page.evaluate(() => localStorage.getItem("fun-drop4-level"));
  expect(stored).toBe("Hard");
});

test("choosing the ○ mark makes the player's discs ○", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator('.drop4-mark[data-mark="o"]').click();
  await expect(page.locator('.drop4-mark[data-mark="o"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('.drop4-col[data-col="3"]').click();
  // The human (Side A) now plays ○, so the first disc down is an ○ cell.
  await expect(page.locator(".drop4-cell.o").first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fun-drop4-mark"))).toBe("o");
});

test("a full game plays to a terminal result; the final board + winning line show; share re-verifies", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Play a real game through the UI: each turn tap the leftmost legal column and
  // wait for the engine's reply. The board holds 42 discs, so this terminates.
  for (let ply = 0; ply < 42; ply += 1) {
    const over = await page.evaluate(() => window.__drop4!.game.board().result !== -1);
    if (over) break;
    const col = await page.evaluate(() => window.__drop4!.game.board().legal[0]);
    await page.locator(`.drop4-col[data-col="${col}"]`).click();
    await waitHumanOrOver(page);
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  // The result screen shows the final position so the finish is visible.
  await expect(result.locator(".drop4-board.drop4-final")).toBeVisible();
  // A win highlights exactly the four-in-a-row (proves the win is a real four).
  const code = await page.evaluate(() => window.__drop4!.game.resultCode());
  if (code === 1 || code === 2) {
    await expect(result.locator(".drop4-cell.win")).toHaveCount(4);
  }

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".drop4-board.drop4-final")).toBeVisible();
  await shared.close();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board is centered in the play area", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  const board = await page.locator(".drop4-board").boundingBox();
  const area = await page.locator("#play-area").boundingBox();
  expect(board).not.toBeNull();
  expect(area).not.toBeNull();
  const boardCenter = board!.x + board!.width / 2;
  const areaCenter = area!.x + area!.width / 2;
  expect(Math.abs(boardCenter - areaCenter)).toBeLessThan(24);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/drop4/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
