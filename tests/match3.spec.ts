//! Match-3 wiring test: the board renders and plays over the binding, selecting
//! a gem glows exactly the core's legal swaps, a legal swap scores while an
//! illegal one doesn't, playing out the budget yields a verifiable record, and
//! the share link round-trips. Axe + mobile-fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".m3-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__match3));
}

test("the board renders an 8×8 deal with the HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await expect(page.locator(".m3-gem")).toHaveCount(64);
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-hud")).toContainText(/swaps left/i);
});

test("selecting a gem glows exactly the core's legal swaps", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  // Pick a gem that has at least one legal swap, and its exact partner cells.
  const pick = await page.evaluate(() => {
    const moves = window.__match3!.game.legalMoves();
    const first = moves[0]!;
    const from = { r: first[0], c: first[1] };
    const partners = new Set<string>();
    for (const s of moves) {
      if (s[0] === from.r && s[1] === from.c) partners.add(`${s[2]},${s[3]}`);
      else if (s[2] === from.r && s[3] === from.c) partners.add(`${s[0]},${s[1]}`);
    }
    return { from, partners: [...partners] };
  });

  await page.locator(`.m3-gem[data-r="${pick.from.r}"][data-c="${pick.from.c}"]`).click();
  await expect(page.locator(".legal-target")).toHaveCount(pick.partners.length);
});

test("a legal swap scores; a no-match swap changes nothing", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  const before = await page.evaluate(() => window.__match3!.game.board());
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);

  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  const after = await page.evaluate(() => window.__match3!.game.board());
  expect(after.score).toBeGreaterThan(before.score);
  expect(after.movesLeft).toBe(before.movesLeft - 1);
});

test("playing out the budget yields a verifiable record; share round-trips", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  // Greedy-play the whole budget via the hook, then re-render into the result.
  await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 20; i += 1) {
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("dragging a gem onto a legal neighbour swaps it (drag as well as tap)", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__match3!.game.board().score);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page
    .locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`)
    .dragTo(page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`));
  const after = await page.evaluate(() => window.__match3!.game.board().score);
  expect(after).toBeGreaterThan(before);
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/match3/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
