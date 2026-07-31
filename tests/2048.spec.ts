//! 2048 wiring test: the grid + arrow pad + HUD render and play over the
//! binding, an arrow slides tiles and spawns a new one, an illegal direction is
//! a core-decided no-op, the committed fixture line replays to a verifiable
//! result whose `?r=` share round-trips, hints-off "I'm done" ends. Axe +
//! narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".t48-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__t2048));
}

const filled = (page: Page): Promise<number> =>
  page.evaluate(() =>
    window.__t2048!.game.board().cells.flat().filter((v: number) => v !== 0).length,
  );

test("the board, arrow pad, and HUD render", async ({ page }) => {
  await page.goto("/2048/?seed=7");
  await ready(page);
  await expect(page.locator(".t48-board")).toBeVisible();
  await expect(page.locator(".t48-pad")).toBeVisible();
  await expect(page.locator(".t48-hud")).toContainText(/score/i);
  await expect(page.locator(".t48-hud")).toContainText(/best tile/i);
  // A goal banner explains the game (matching numbers combine to reach 2048).
  await expect(page.locator(".t48-banner")).toContainText(/combine.*2048/i);
  // A fresh board has exactly two spawned tiles.
  expect(await filled(page)).toBe(2);
});

test("an arrow move slides and spawns a tile", async ({ page }) => {
  await page.goto("/2048/?seed=7");
  await ready(page);
  const before = await filled(page);
  // Use the core's hint to pick a guaranteed-legal direction, then tap that arrow.
  const dir = await page.evaluate(() => window.__t2048!.game.hint());
  await page.locator(`.t48-arrow[data-dir="${dir}"]`).click();
  const after = await filled(page);
  expect(after).toBe(before + 1); // a legal move spawns one new tile
});

test("the core decides legality — no partial moves (spawn only on a real slide)", async ({ page }) => {
  // For each direction on a fresh board: a tap either changes the board AND
  // spawns exactly one tile (legal), or leaves the hash exactly unchanged
  // (illegal no-op). Never a partial application. This is the guardrail.
  for (const d of ["Up", "Down", "Left", "Right"] as const) {
    await page.goto("/2048/?seed=7");
    await ready(page);
    const before = await page.evaluate(() => ({
      hash: window.__t2048!.game.currentHash(),
      n: window.__t2048!.game.board().cells.flat().filter((v: number) => v !== 0).length,
    }));
    await page.locator(`.t48-arrow[data-dir="${d}"]`).click();
    const after = await page.evaluate(() => ({
      hash: window.__t2048!.game.currentHash(),
      n: window.__t2048!.game.board().cells.flat().filter((v: number) => v !== 0).length,
    }));
    if (after.hash === before.hash) {
      expect(after.n, `illegal ${d} spawned nothing`).toBe(before.n);
    } else {
      // A legal move may merge (fewer tiles) then spawns exactly one, so the
      // count can drop but never exceeds before + 1 (no double / partial spawn).
      expect(after.n, `legal ${d} spawns at most one tile`).toBeLessThanOrEqual(before.n + 1);
      expect(after.n).toBeGreaterThan(0);
    }
  }
});

test("the fixture line replays to a verifiable result; share round-trips", async ({ page }) => {
  const res = await page.request.get("/2048-daily-pack.json");
  const env = (await res.json()) as {
    payload: { fixture: { seed: number; moves: string[] } };
  };
  const fixture = env.payload.fixture;
  await page.goto(`/2048/?seed=${fixture.seed}`);
  await ready(page);
  await page.evaluate((moves) => {
    for (const m of moves) window.__t2048!.playDir(m as "Up" | "Down" | "Left" | "Right");
    // Force the result screen (the fixture line is short, not a full win/stuck).
    window.__t2048!.refresh();
  }, fixture.moves);
  // Not necessarily over — end via "I'm done" if still playing.
  if (!(await page.locator(".sol-result").isVisible())) {
    const settings = page.locator(".sol-settings summary");
    await settings.click();
    await page.locator(".sol-set-hints").uncheck();
    await page.locator(".sol-stuck").click();
  }
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

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/2048/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/2048/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/2048/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
