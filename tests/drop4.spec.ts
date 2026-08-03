//! Drop 4 wiring test: the board + column taps render and play over the binding,
//! tapping a legal column drops the player's disc and the engine replies, the
//! core decides legality (a full column stops glowing and a tap is a no-op), a
//! full game plays to a terminal result whose verification-forward end screen
//! carries a re-verifying `?r=` share, hints-off "I'm done" ends. Axe + narrow-
//! phone fit + centred-board guard the identity.

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

/** Whether it is the human's turn again (Side A) or the match is over. */
const humanTurnOrOver = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const b = window.__drop4!.game.board();
    return b.toMove === 1 || b.result !== -1;
  });

test("the board and the columns render, all seven playable on a fresh board", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await expect(page.locator(".drop4-board")).toBeVisible();
  await expect(page.locator(".drop4-col")).toHaveCount(7);
  // A goal banner explains the game (drop discs, four in a row wins).
  await expect(page.locator(".drop4-banner")).toContainText(/four in a row/i);
  // Fresh board: empty, and every column is a legal (glowing) target.
  expect(await filled(page)).toBe(0);
  await expect(page.locator(".drop4-col.legal")).toHaveCount(7);
});

test("tapping a legal column drops a disc and the engine replies", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  expect(await filled(page)).toBe(0);
  await page.locator('.drop4-col[data-col="3"]').click();
  // The player's disc lands, then the engine replies — two discs on the board,
  // and it is the human's turn again.
  await page.waitForFunction(() => window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length === 2);
  expect(await humanTurnOrOver(page)).toBe(true);
});

test("the core decides legality — a filled column is no longer a legal target", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Fill a single column by tapping it repeatedly; the engine plays elsewhere.
  // Once column 0 has six discs it drops out of the legal set and a further tap
  // changes nothing (the core, not the UI, decides).
  for (let i = 0; i < 6; i += 1) {
    const legal = await page.evaluate(() => window.__drop4!.game.board().legal.includes(0));
    if (!legal || (await page.evaluate(() => window.__drop4!.game.board().result !== -1))) break;
    await page.locator('.drop4-col[data-col="0"]').click();
    await page.waitForFunction(() => {
      const b = window.__drop4!.game.board();
      return b.toMove === 1 || b.result !== -1;
    });
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

test("a full game plays to a terminal result with a verifiable, re-verifying share", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Play a real game through the UI: each turn tap the leftmost legal column and
  // wait for the engine's reply. The board holds 42 discs, so this terminates in
  // a win, loss, or draw well within the cap.
  for (let ply = 0; ply < 42; ply += 1) {
    const over = await page.evaluate(() => window.__drop4!.game.board().result !== -1);
    if (over) break;
    const col = await page.evaluate(() => window.__drop4!.game.board().legal[0]);
    await page.locator(`.drop4-col[data-col="${col}"]`).click();
    await page.waitForFunction(() => {
      const b = window.__drop4!.game.board();
      return b.toMove === 1 || b.result !== -1;
    });
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText(/result/i);

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
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
  // The board sits on the play area's centerline — not hugging the left edge.
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
