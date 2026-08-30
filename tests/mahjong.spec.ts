//! Mahjong wiring test: the game mounts at `/mahjong/`, play goes through the real
//! core — a blocked tile and a non-matching pair change nothing (the core decides
//! legality), a hinted pair takes two tiles, a full clear reaches a verification-
//! forward win whose `?r=` share re-verifies — the board never moves while you
//! play, and the page is axe-clean and fits a phone.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__mahjong));
  await expect(page.locator(".mj-board")).toBeVisible();
}
const board = (page: Page): Promise<{ slots: { present: boolean; free: boolean; face: number }[]; remaining: number; pairs: number }> =>
  page.evaluate(() => {
    const b = window.__mahjong!.board();
    return { slots: b.slots.map((s) => ({ present: s.present, free: s.free, face: s.face })), remaining: b.remaining, pairs: b.pairs };
  });

test("level 1 renders 36 tile buttons on the game frame", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/mahjong/?level=1");
  await ready(page);
  await expect(page.locator(".mj-tile")).toHaveCount(36);
  await expect(page.locator(".gf-title")).toHaveText("Mahjong");
  await expect(page.locator(".gf-mode")).toContainText(/level 1/i);
  await expect(page.locator('.gf-stat[data-meter="left"]')).toContainText("36");
  await expect(page.locator('.gf-stat[data-meter="pairs"]')).toContainText(/matches/i);
  await expect(page.locator('.gf-stat[data-meter="moves"]')).toContainText("0");
  for (const verb of ["undo", "hint", "new", "shuffle", "settings"]) {
    await expect(page.locator(`.gf-verb[data-verb="${verb}"]`)).toHaveCount(1);
  }
  await expect(page.locator(".gf-toast")).toContainText(/free tile/i);
  // Every tile speaks its face and whether it is free.
  await expect(page.locator(".mj-tile").first()).toHaveAttribute("aria-label", /, (free|blocked)$/);
});

test("the core decides legality: a blocked tile and a non-matching pair change nothing; a hinted pair takes two", async ({ page }) => {
  await page.goto("/mahjong/?level=1");
  await ready(page);
  const b0 = await board(page);
  const blocked = b0.slots.findIndex((s) => s.present && !s.free);
  expect(blocked).toBeGreaterThanOrEqual(0);
  await page.locator(`.mj-tile[data-slot="${blocked}"]`).click({ force: true });
  expect((await board(page)).remaining).toBe(36);
  await expect(page.locator(".mj-tile.selected")).toHaveCount(0);

  // A free tile lifts; a free tile of a different face is refused.
  const free = b0.slots.map((s, i) => ({ s, i })).filter((x) => x.s.present && x.s.free);
  const a = free[0]!;
  const other = free.find((x) => x.i !== a.i && x.s.face !== a.s.face && !(a.s.face >= 34 && x.s.face >= 34));
  await page.evaluate((i) => window.__mahjong!.tap(i), a.i);
  await expect(page.locator(".mj-tile.selected")).toHaveCount(1);
  if (other) {
    await page.evaluate((i) => window.__mahjong!.tap(i), other.i);
    expect((await board(page)).remaining).toBe(36);
    await expect(page.locator(".mj-tile.selected")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".mj-tile.selected")).toHaveCount(0);

  // A hint is a legal pair: the match glows, and taking it removes two tiles.
  const h = await page.evaluate(() => window.__mahjong!.hint());
  expect(h).not.toBeNull();
  await expect(page.locator(".mj-tile.hint")).toHaveCount(2);
  await expect(page.locator(".mj-status")).toContainText(/hint/i);
  await page.evaluate(({ a, b }) => {
    window.__mahjong!.tap(a);
    window.__mahjong!.tap(b);
  }, h!);
  expect((await board(page)).remaining).toBe(34);
  await expect(page.locator('.gf-stat[data-meter="moves"]')).toContainText("1");
  await page.evaluate(() => window.__mahjong!.undo());
  expect((await board(page)).remaining).toBe(36);
});

test("clearing the board reaches a verified win, and its share re-verifies", async ({ page }) => {
  await page.goto("/mahjong/?level=1");
  await ready(page);
  await page.evaluate(() => {
    const h = window.__mahjong!;
    for (let guard = 0; guard < 40; guard++) {
      const hint = h.hint();
      if (!hint) break;
      h.tap(hint.a);
      h.tap(hint.b);
    }
  });
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 8000 });
  await expect(result.locator(".sol-headline")).toContainText(/cleared/i);
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".mj-shared .sol-verify-badge.ok")).toBeVisible({ timeout: 8000 });
  await shared.close();
});

test("a bare land is the poster with the mode card", async ({ page }) => {
  await page.goto("/mahjong/");
  await expect(page.locator(".gf-poster")).toBeVisible();
  await expect(page.locator('.gf-poster [data-setting="mode"]')).toBeVisible();
  await expect(page.locator(".mj-board")).toHaveCount(0);
});

test("a tap does not move the board, and neither does the settings sheet", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mahjong/?level=1");
  await ready(page);
  const v = await boardTopStable(page, ".mj-board", async () => {
    await page.evaluate(() => {
      const h = window.__mahjong!;
      const hint = h.hint();
      if (hint) {
        h.tap(hint.a);
        h.tap(hint.b);
      }
    });
    await page.waitForTimeout(250);
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("no axe violations in light and dark, and no horizontal overflow at 360px on the Turtle", async ({ page }) => {
  await page.goto("/mahjong/?level=1");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => window.__mahjong!.startLevel(26)); // the Turtle
  await expect(page.locator(".mj-tile")).toHaveCount(144);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, "no horizontal overflow at 360px").toBe(false);
});
