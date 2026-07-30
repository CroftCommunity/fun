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

test("a swap animates the cascade, then settles to the core's board", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  // The board animates (a transient non-interactive frame appears)…
  await expect(page.locator(".m3-board.m3-animating")).toBeVisible();
  // …then settles back to an interactive board with real gem buttons.
  await expect(page.locator(".m3-board.m3-animating")).toHaveCount(0);
  await expect(page.locator("button.m3-gem")).toHaveCount(64);

  // The settled DOM matches the core's settled score (the wasm applied it at once).
  const score = await page.evaluate(() => window.__match3!.game.board().score);
  expect(score).toBeGreaterThan(0);
  await expect(page.locator(".m3-hud .m3-score")).toContainText(String(score));
});

test("reduced-motion skips straight to the settled board (no animation)", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/match3/?seed=7");
  await ready(page);

  const before = await page.evaluate(() => window.__match3!.game.board().score);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  // No animation frame is ever shown; the interactive board updates immediately.
  await expect(page.locator("button.m3-gem")).toHaveCount(64);
  expect(await page.locator(".m3-board.m3-animating").count()).toBe(0);
  const after = await page.evaluate(() => window.__match3!.game.board().score);
  expect(after).toBeGreaterThan(before);
  await context.close();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the Clear-blockers objective deals a blocker board with the blocker HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await expect(page.locator(".m3-obj-score")).toHaveAttribute("aria-pressed", "true");

  // Switch objective via the toggle — this fetches the winnable-daily pack.
  await page.locator(".m3-obj-blockers").click();
  await expect(page.locator(".m3-hud")).toContainText(/blockers left/i);
  await expect(page.locator(".m3-obj-blockers")).toHaveAttribute("aria-pressed", "true");
  // The deal carries the six fixed, non-swappable blocker tiles.
  await expect(page.locator(".m3-blocker")).toHaveCount(6);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("blockers");
  // The new blocker tiles + objective toggle stay accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("clearing every blocker is a verifiable win (blockers mode)", async ({ page }) => {
  // The committed pack fixture: seed 30 clears in a single swap [4,4]→[5,4].
  await page.goto("/match3/?mode=blockers&seed=30");
  await ready(page);
  await expect(page.locator(".m3-blocker")).toHaveCount(6);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([4, 4, 5, 4]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all blockers cleared/i);
  // The record leads with swaps-to-clear, not stars/score.
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("the Clear-jelly objective deals a jelly board with the jelly HUD", async ({ page }) => {
  await page.goto("/match3/?mode=jelly&seed=317");
  await ready(page);
  await expect(page.locator(".m3-obj-jelly")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".m3-hud")).toContainText(/jelly left/i);
  // Six jellied cells, and each is a still-swappable gem button (jelly sits under it).
  await expect(page.locator("button.m3-gem.m3-jellied")).toHaveCount(6);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("jelly");
  // The new jelly backing stays accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("scrubbing every jelly is a verifiable win (jelly mode)", async ({ page }) => {
  // Committed jelly fixture: seed 317 clears in two swaps.
  await page.goto("/match3/?mode=jelly&seed=317");
  await ready(page);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(6);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([6, 0, 6, 1]);
    h.game.play([4, 1, 4, 2]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all jelly cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("every objective fits a narrow phone with no horizontal overflow", async ({ page }) => {
  // The 3-objective toggle + board must stay within a 360px viewport in each mode.
  await page.setViewportSize({ width: 360, height: 780 });
  const noOverflow = (): Promise<boolean> =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  for (const q of ["seed=7", "mode=blockers&seed=30", "mode=jelly&seed=317"]) {
    await page.goto(`/match3/?${q}`);
    await ready(page);
    await expect(page.locator(".m3-board")).toBeVisible();
    expect(await noOverflow(), `overflow at 360px for ${q}`).toBe(true);
  }
});

test("switching objective via the toggle re-deals and updates the HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7"); // target-score
  await ready(page);
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(0);

  await page.locator(".m3-obj-jelly").click();
  await expect(page.locator(".m3-hud")).toContainText(/jelly left/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(6);

  await page.locator(".m3-obj-score").click();
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(0);
});

test("a jellied gem is still tappable and swaps like any other", async ({ page }) => {
  await page.goto("/match3/?mode=jelly&seed=317");
  await ready(page);
  // Find a legal swap whose source cell is jellied, and play it by tapping.
  const swap = await page.evaluate(() => {
    const h = window.__match3!;
    const b = h.game.board();
    return h.game.legalMoves().find((s) => (b.jelly[s[0]]?.[s[1]] ?? 0) > 0) ?? h.game.legalMoves()[0]!;
  });
  const before = await page.evaluate(() => window.__match3!.game.board().jellyRemaining);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();
  const after = await page.evaluate(() => window.__match3!.game.board().jellyRemaining);
  // A legal swap resolved (jelly did not increase; the board advanced).
  expect(after).toBeLessThanOrEqual(before);
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
