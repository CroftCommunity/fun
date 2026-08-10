//! Furrow wiring test: the two rows, both stores and the pickers render and play
//! over the binding; tapping a legal pit moves seeds and the sow animates from
//! the core's own preview; tapping an **empty** pit is inert (the guardrail
//! against rules leaking into the UI); landing in your own store keeps the turn
//! and says so; a full game reaches a terminal whose verification-forward end
//! screen shows the final board and a re-verifying `?r=` share.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".furrow-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__furrow));
}

/** The human's side value: the human opens, so Side A. */
const HUMAN = 1;

/** Wait until the human is to move with a legal pit and no sow animating, or the
 *  match is over. Driven off the core's own state, never off a timer. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction(
    (human) => {
      const h = window.__furrow!;
      if (h.busy()) return false;
      const b = h.game.board();
      return b.result !== -1 || (b.toMove === human && b.legal.length > 0);
    },
    HUMAN,
    { timeout: 30_000 },
  );

const cells = (page: Page): Promise<number[]> =>
  page.evaluate(() => window.__furrow!.game.board().cells);

test("the two rows, both stores and the pickers render", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await expect(page.locator(".furrow-pit")).toHaveCount(12);
  await expect(page.locator(".furrow-store")).toHaveCount(2);
  // The banner explains the two rules that make this game its own thing.
  await expect(page.locator(".furrow-banner")).toContainText(/go again/i);
  await expect(page.locator(".furrow-banner")).toContainText(/capture/i);
  await expect(page.locator(".furrow-turnbar")).toContainText(/you/i);
  await expect(page.locator(".furrow-turnbar")).toContainText(/the engine/i);
  // The difficulty picker tops out at Expert — the opening does not solve, so
  // "Perfect" would be a claim the engine cannot make.
  await expect(page.locator(".furrow-level option")).toHaveCount(4);
  await expect(page.locator(".furrow-level")).toContainText("Expert");
  await expect(page.locator(".furrow-level")).not.toContainText("Perfect");
});

test("tapping a legal pit sows it, and an empty pit is inert", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  const before = await cells(page);
  await page.locator(".furrow-pit.mine.legal").first().click();
  await waitHumanOrOver(page);
  const after = await cells(page);
  expect(after).not.toEqual(before);
  // One move writes to several cells -- the property that makes this game its
  // own shape, asserted through the UI rather than only in the core.
  const changed = after.filter((v, i) => v !== before[i]).length;
  expect(changed).toBeGreaterThanOrEqual(3);

  // An empty pit is not a move. The button is still tappable on purpose: the
  // CORE refuses it, the UI does not gate it, and this asserts that split.
  const emptied = await page.evaluate(() => {
    const b = window.__furrow!.game.board();
    return b.cells.findIndex((c: number, i: number) => c === 0 && i < b.pits);
  });
  test.skip(emptied < 0, "no empty pit on our side yet at this seed");
  const settled = await cells(page);
  await page.locator(`.furrow-pit[data-pit="${emptied}"]`).click({ force: true });
  await page.waitForTimeout(400);
  expect(await cells(page)).toEqual(settled);
});

test("landing in your own store keeps the turn and the board says why", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  // Pit 2 holds four seeds and sits four cells from the store, so the classic
  // opening banks one and moves again.
  await page.locator('.furrow-pit[data-pit="2"]').click();
  await waitHumanOrOver(page);
  const board = await page.evaluate(() => window.__furrow!.game.board());
  expect(board.keptTurn).toBe(true);
  expect(board.toMove).toBe(HUMAN);
  expect(board.storeA).toBe(1);
  await expect(page.locator(".furrow-turnline")).toContainText(/go again/i);
});

test("the tappable ring never marks the opponent's pits", async ({ page }) => {
  // `board.legal` is the *mover's* legal set, so during the engine's turn it
  // holds the engine's pits. Ringing those would confuse the player and quietly
  // hand them the opponent's options -- assistance nobody asked for, and a bug a
  // screenshot caught after the whole suite went green.
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  // On your turn: every ring is on one of your pits, and there is at least one.
  const yours = await page.locator(".furrow-pit.legal").count();
  expect(yours).toBeGreaterThan(0);
  expect(await page.locator(".furrow-pit.legal.theirs").count()).toBe(0);

  // Hand the turn over and watch while the engine has it.
  await page.locator(".furrow-pit.mine.legal").first().click();
  await page.waitForFunction(() => {
    const b = window.__furrow!.game.board();
    return b.result !== -1 || b.toMove === 2;
  });
  const duringTheirTurn = await page.evaluate(() => ({
    theirs: document.querySelectorAll(".furrow-pit.legal.theirs").length,
    any: document.querySelectorAll(".furrow-pit.legal").length,
  }));
  expect(duringTheirTurn.theirs).toBe(0);
  expect(duringTheirTurn.any).toBe(0);
});

test("an empty pit is not dimmed, because the numeral is the information", async ({ page }) => {
  // Measured: at the 0.45 opacity this used to carry, the "0" composited to
  // 2.71:1 against the well in light mode -- below even the 3:1 UI floor, for
  // the one piece of information a pit carries. axe cannot see it, because it
  // cannot evaluate opacity-composited text.
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator('.furrow-pit[data-pit="0"]').click();
  await waitHumanOrOver(page);
  const dim = await page.evaluate(() => {
    const empty = document.querySelector(".furrow-pit.empty .furrow-count");
    return empty ? Number(getComputedStyle(empty).opacity) : 1;
  });
  expect(dim).toBe(1);
  // Emptiness is signalled by the border style instead, which carries no contrast
  // debt.
  const dashed = await page.evaluate(() => {
    const empty = document.querySelector(".furrow-pit.empty");
    return empty ? getComputedStyle(empty).borderStyle : "";
  });
  expect(dashed).toBe("dashed");
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await page.locator(".furrow-level").selectOption("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-furrow-level"))).toBe("Hard");
});

test("a full game plays to a result; the final board shows; the share re-verifies", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/furrow/?seed=7");
  await ready(page);
  for (let turn = 0; turn < 120; turn += 1) {
    await waitHumanOrOver(page);
    const over = await page.evaluate(() => window.__furrow!.game.board().result !== -1);
    if (over) break;
    await page.locator(".furrow-pit.mine.legal").first().click();
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".furrow-board")).toBeVisible();

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".furrow-board")).toBeVisible();
  await shared.close();
});

test("a finished game holds every seed in the two stores", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/furrow/?seed=3");
  await ready(page);
  for (let turn = 0; turn < 120; turn += 1) {
    await waitHumanOrOver(page);
    const over = await page.evaluate(() => window.__furrow!.game.board().result !== -1);
    if (over) break;
    await page.locator(".furrow-pit.mine.legal").first().click();
  }
  // The sweep is what makes the final score not the accumulated one, and it is
  // the shelf's first end-of-game transformation -- so it is asserted through
  // the UI, not only in the core.
  const board = await page.evaluate(() => window.__furrow!.game.board());
  expect(board.inPlay).toBe(0);
  expect(board.storeA + board.storeB).toBe(48);
});

// Identity + accessibility. The board is scenery plus twelve controls and two
// readouts, so it is exactly the shape axe catches unlabelled targets in — and it
// must clear the bar in both themes, not just the one the author happens to run.
for (const theme of ["light", "dark"] as const) {
  test(`no axe violations on the board (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("fun-theme", t), theme);
    await page.goto("/furrow/?seed=7");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const results = await new AxeBuilder({ page }).include(".furrow-game").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the board fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/furrow/?seed=7");
  await ready(page);
  // Measure the CONTENT, not the box. The first version of this test compared
  // `.furrow-board`'s bounding rect to the viewport and passed while the far
  // store was visibly clipped, because `max-width: 100%` clamps the box and lets
  // the contents overflow it. A screenshot caught what the assertion could not.
  const overflow = await page.evaluate(() => {
    const wrap = document.querySelector(".furrow-boardwrap");
    const board = document.querySelector(".furrow-board");
    return {
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      boardWidth: board ? board.scrollWidth : 0,
      wrapWidth: wrap ? wrap.clientWidth : 0,
    };
  });
  expect(overflow.pageScrolls).toBe(false);
  expect(overflow.boardWidth).toBeLessThanOrEqual(overflow.wrapWidth);
});

test("every pit target clears the 24px minimum touch size", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/furrow/?seed=7");
  await ready(page);
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll(".furrow-pit")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width < 24 || r.height < 24).length,
  );
  expect(small).toBe(0);
});
