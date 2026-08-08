//! Dots and Boxes wiring test: the dot lattice + turn bar + pickers render and
//! play over the binding; legal edges glow (core-decided) and a tap draws one;
//! an already-drawn edge is inert (the guardrail against rules leaking into the
//! UI); closing a box scores it and says so, and the turn stays with the closer;
//! a full game reaches a terminal result whose verification-forward end screen
//! shows the final board and a re-verifying `?r=` share; the difficulty picker
//! persists.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".dots-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__dots));
}

/** The human's side value with the default seat (second = Side B). */
const HUMAN = 2;

/** How many edges are drawn on the live board. */
const drawnCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__dots!.game.board().drawn.filter(Boolean).length);

/** Wait until the human is to move with a legal edge, or the match is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction((human) => {
    const b = window.__dots!.game.board();
    return b.result !== -1 || (b.toMove === human && b.legal.length > 0);
  }, HUMAN);

test("the lattice, turn bar, and pickers render", async ({ page }) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  // 24 edges and 16 dots on a 3x3-box board; 9 boxes.
  await expect(page.locator(".dots-edge")).toHaveCount(24);
  await expect(page.locator(".dots-dot")).toHaveCount(16);
  await expect(page.locator(".dots-box")).toHaveCount(9);
  // The banner explains the rule that makes this game its own thing.
  await expect(page.locator(".dots-banner")).toContainText(/again/i);
  await expect(page.locator(".dots-turnbar")).toContainText(/you/i);
  await expect(page.locator(".dots-turnbar")).toContainText(/the engine/i);
  // The difficulty picker tops out at Perfect — 3x3 dots is solved.
  await expect(page.locator(".dots-level option")).toHaveCount(4);
  await expect(page.locator(".dots-level")).toContainText("Perfect");
});

test("tapping a legal edge draws it, and an already-drawn edge is inert", async ({ page }) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  const before = await drawnCount(page);
  await page.locator(".dots-edge.legal").first().click();
  await waitHumanOrOver(page);
  expect(await drawnCount(page)).toBeGreaterThan(before);
  // The last drawn edge is marked so the move (and the engine's reply) is visible.
  await expect(page.locator(".dots-edge.just-drawn")).toHaveCount(1);

  // An already-drawn edge is not a target: tapping it changes nothing.
  const settled = await drawnCount(page);
  await page.locator(".dots-edge.drawn").first().click({ force: true });
  await page.waitForTimeout(300);
  expect(await drawnCount(page)).toBe(settled);
});

test("closing a box scores it and keeps the turn with the closer", async ({ page }) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  // Drive the core to a position where the human can close a box, then tap it
  // through the UI and check the score, the ownership, and the retained turn.
  const target = await page.evaluate((human) => {
    const g = window.__dots!.game;
    for (let guard = 0; guard < 24; guard += 1) {
      const b = g.board();
      if (b.result !== -1) return null;
      const closer = b.legal.find((e: number) => g.closesCount(e) > 0);
      if (closer !== undefined && b.toMove === human) return closer;
      // Nobody can close yet (or it is not our turn): draw a quiet edge for
      // whoever is to move, straight through the core.
      const quiet = b.legal.find((e: number) => g.closesCount(e) === 0) ?? b.legal[0];
      if (quiet === undefined) return null;
      g.play(quiet);
    }
    return null;
  }, HUMAN);
  expect(target).not.toBeNull();
  await page.evaluate(() => window.__dots!.refresh());
  await page.locator(`.dots-edge[data-edge="${target}"]`).click();
  const after = await page.evaluate(() => window.__dots!.game.board());
  expect(after.keptTurn).toBe(true);
  expect(after.toMove).toBe(HUMAN);
  expect(after.boxesB).toBeGreaterThan(0);
  await expect(page.locator(".dots-box.b")).toHaveCount(after.boxesB);
  await expect(page.locator(".dots-status")).toContainText(/again/i);
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  await page.locator(".dots-level").selectOption("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-dots-level"))).toBe("Hard");
});

test("a full game plays to a result; the final board shows; the share re-verifies", async ({
  page,
}) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  for (let ply = 0; ply < 30; ply += 1) {
    await waitHumanOrOver(page);
    const over = await page.evaluate(() => window.__dots!.game.board().result !== -1);
    if (over) break;
    await page.locator(".dots-edge.legal").first().click();
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".dots-board.dots-final")).toBeVisible();

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".dots-board.dots-final")).toBeVisible();
  await shared.close();
});

// Identity + accessibility (Phase 7). The board is scenery plus 24 controls, so
// it is exactly the shape axe catches unlabelled targets in — and it must clear
// the bar in both themes, not just the one the author happens to run.
for (const theme of ["light", "dark"] as const) {
  test(`no axe violations on the board (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("fun-theme", t), theme);
    await page.goto("/dots/?seed=7");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const results = await new AxeBuilder({ page }).include(".dots-game").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("a claimed box carries a mark, so the sides differ by more than colour", async ({ page }) => {
  await page.goto("/dots/?seed=7");
  await ready(page);
  // Drive the core to a claimed box, then check the rendered box carries its
  // side's glyph and an accessible name — colour alone is not a signal.
  await page.evaluate(() => {
    const g = window.__dots!.game;
    for (const e of [0, 3, 12, 13]) g.play(e);
    window.__dots!.refresh();
  });
  const box = page.locator(".dots-box.a, .dots-box.b").first();
  await expect(box).toHaveCount(1);
  await expect(box.locator(".dots-mark")).toHaveText(/[▲●]/);
  await expect(box).toHaveAttribute("aria-label", /claimed by/i);
});

test("the board fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/dots/?seed=7");
  await ready(page);
  const fits = await page.evaluate(() => {
    const b = document.querySelector(".dots-board");
    return b ? b.getBoundingClientRect().width <= window.innerWidth : false;
  });
  expect(fits).toBe(true);
});

test("every edge target clears the 24px minimum touch size", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/dots/?seed=7");
  await ready(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll(".dots-edge")]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width < 24 || r.height < 24).length,
  );
  expect(small).toBe(0);
});
