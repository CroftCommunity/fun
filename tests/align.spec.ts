//! Align wiring test: the board canvas + touch pad + HUD render and play over
//! the binding; a shift moves the active piece and the core decides legality (a
//! shift into the wall is a no-op); a full run tops out to a verifiable result
//! whose `?r=` share round-trips; hints-off "End run" ends. Axe + narrow-phone
//! fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".al-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__align));
}

const activeMinX = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const a = window.__align!.board().active!;
    return Math.min(...a.cells.map((c) => c[0]));
  });

test("the board, touch pad, and HUD render with an active piece", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await expect(page.locator(".al-board")).toBeVisible();
  await expect(page.locator(".al-touch")).toBeVisible();
  await expect(page.locator(".al-hud")).toContainText(/score/i);
  await expect(page.locator(".al-hud")).toContainText(/level/i);
  const hasActive = await page.evaluate(() => window.__align!.board().active !== null);
  expect(hasActive).toBe(true);
});

test("a shift moves the active piece one cell (the core decides)", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const before = await activeMinX(page);
  await page.evaluate(() => window.__align!.input("ShiftR"));
  const after = await activeMinX(page);
  expect(after).toBe(before + 1);
});

test("the core rejects an illegal shift into the wall (guardrail: no partial move)", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Shove the piece to the right wall, then one more shift must change nothing.
  // (Compare the piece's x, not the hash — live gravity advances y meanwhile.)
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.__align!.input("ShiftR");
  });
  const before = await activeMinX(page);
  await page.evaluate(() => window.__align!.input("ShiftR"));
  const after = await activeMinX(page);
  expect(after).toBe(before); // the wall is a no-op — no partial slide
});

test("rotation and hard drop change the board through the core", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const h0 = await page.evaluate(() => window.__align!.game.currentHash());
  await page.evaluate(() => window.__align!.input("RotCW"));
  const h1 = await page.evaluate(() => window.__align!.game.currentHash());
  // A hard drop locks the piece and spawns the next — the stack height grows.
  const linesBefore = await page.evaluate(() => window.__align!.board().rows.flat().filter((v) => v > 0).length);
  await page.evaluate(() => window.__align!.input("HardDrop"));
  const linesAfter = await page.evaluate(() => window.__align!.board().rows.flat().filter((v) => v > 0).length);
  expect(h1).not.toBe(h0); // rotation changed state (seed 7's first piece rotates)
  expect(linesAfter).toBeGreaterThan(linesBefore); // four locked cells added
});

test("a full run tops out to a verifiable result; the share round-trips", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Hard-drop pieces in place until the stack tops out (a real game-over path).
  await page.evaluate(() => {
    const h = window.__align!;
    for (let i = 0; i < 400 && !h.board().over; i++) {
      h.input("HardDrop");
      h.tick(1);
    }
  });
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("with hints off, 'End run' ends the round with a verifiable result", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/align/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
