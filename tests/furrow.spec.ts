//! Furrow wiring test: the two rows, both stores and the pickers render and play
//! over the binding; tapping a legal pit moves seeds and the sow animates from
//! the core's own preview; tapping an **empty** pit is inert (the guardrail
//! against rules leaking into the UI); landing in your own store keeps the turn
//! and says so; a full game reaches a terminal whose verification-forward end
//! screen shows the final board and a re-verifying `?r=` share.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SKIN, familyMembers, familyOf } from "../src/skins.js";

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
for (const skin of familyMembers(familyOf(DEFAULT_SKIN))) {
  test(`no axe violations on the board (${skin})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("fun-skin", t), skin);
    await page.goto("/furrow/?seed=7");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
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

// Assistance + the tutor (Phase 8). Hints are on by default and cost the record's
// "unassisted" claim; the tutor panel is opt-in and may never word a depth-capped
// verdict as a proof — which here is about 70% of a game, not a rare corner.

test("a hint names a pit, explains it, and says it counts as assistance", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".furrow-hint").click();
  const status = page.locator(".furrow-status");
  await expect(status).toContainText(/Hint: your pit \d/);
  await expect(status).toContainText(/assistance/i);
  // And it carries the engine's own reason, not a generic one.
  await expect(status).toContainText(/—/);
});

test("with hints off the control ends the game and reports what was left", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fun-hints", "off"));
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await expect(page.locator(".furrow-hint")).toHaveCount(0);
  await page.locator(".furrow-stuck").click();
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(/ended early/i);
  await expect(result).toContainText(/seeds were still on the board/i);
  // An abandoned record is still a verifiable one — it just claims less.
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("the tutor panel is off by default and appears when enabled in settings", async ({ page }) => {
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await expect(page.locator(".furrow-tutor")).toHaveCount(0);
  await page.locator(".furrow-settings summary").click();
  await page.locator(".furrow-set-tutor").check();
  await expect(page.locator(".furrow-tutor-explain")).toBeVisible();
});

test("'Explain my options' lists band pits with the engine's own reason, and hedges", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("fun-furrow-tutor", "on"));
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".furrow-tutor-explain").click();
  const items = page.locator(".furrow-tutor-options li");
  await expect(items.first()).toContainText(/(your|their) pit \d — /);
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  // The opening is far above the exact threshold, so the panel must say it is
  // reading rather than claiming a solve. This is the honesty gate, on the
  // surface that is the only one allowed to claim a proof at all.
  await expect(page.locator(".furrow-tutor-note")).toContainText(/not yet certain/i);
});

test("the panel paints its reading state before the search blocks the thread", async ({ page }) => {
  // The checkers lesson: the panel's search runs on the main thread, so without
  // painting first the button looks dead for as long as it runs.
  await page.addInitScript(() => localStorage.setItem("fun-furrow-tutor", "on"));
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".furrow-tutor-explain").click();
  await expect(page.locator(".furrow-tutor-note")).not.toBeEmpty();
});

test("the tutor's reading survives the re-render that lands after a turn settles", async ({
  page,
}) => {
  // The shared defect `TODO/dots.md` files against othello, checkers and dots:
  // a re-render arrives shortly after every turn settles and wipes the panel, so
  // the options a player just asked for vanish under them. Furrow holds the
  // reading in module state instead — and drops it when the position changes,
  // because a stale reading is worse than none.
  await page.addInitScript(() => localStorage.setItem("fun-furrow-tutor", "on"));
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".furrow-tutor-explain").click();
  await expect(page.locator(".furrow-tutor-options li").first()).toBeVisible();
  const before = await page.locator(".furrow-tutor-options li").count();

  // Force a re-render without changing the position: toggling a setting does it.
  await page.locator(".furrow-settings summary").click();
  await page.locator(".furrow-set-assist").click();
  expect(await page.locator(".furrow-tutor-options li").count()).toBe(before);

  // But a move DOES change the position, and the stale reading must go.
  await page.locator(".furrow-pit.mine.legal").first().click();
  await waitHumanOrOver(page);
  expect(await page.locator(".furrow-tutor-options li").count()).toBe(0);
});

// The experimental local-AI opponent (Phase 11). The engine stays the default and
// the toggle appears only behind a real, non-fallback WebGPU adapter.

test("the experimental local-AI opponent is hidden with no real WebGPU adapter", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
  });
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await page.locator(".furrow-settings summary").click();
  await expect(page.locator(".furrow-ai-toggle-input")).toHaveCount(0);
});

test("a fallback adapter does not count as WebGPU", async ({ page }) => {
  // A software adapter would run the model on the CPU, which is not the offer.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: true }) },
    });
  });
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await page.locator(".furrow-settings summary").click();
  await expect(page.locator(".furrow-ai-toggle-input")).toHaveCount(0);
});

test("the toggle appears with a real adapter and discloses the cost and the guarantee", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.goto("/furrow/?seed=7");
  await ready(page);
  await page.locator(".furrow-settings summary").click();
  const toggle = page.locator(".furrow-ai-toggle-input");
  await expect(toggle).toHaveCount(1);
  await toggle.check();
  const disclosure = page.locator(".furrow-ai-disclosure");
  // The cost, with the size — a player deciding whether to tap this deserves the
  // number, not "a download".
  await expect(disclosure).toContainText(/one[- ]time/i);
  await expect(disclosure).toContainText(/MB/);
  // And the latency, which is the other half of the cost. Measured median is
  // ~235 ms a move against the engine's 7.8 ms — a player deciding whether to tap
  // this deserves the number in the same sentence as the download size.
  await expect(disclosure).toContainText(/quarter-second a move/i);
  // And the honest limit, which is the part that was wrong until the live trial
  // was actually run: outside the endgame the band is the engine's judgement, not
  // a proof, and the model measurably plays weaker than the engine it stands in
  // for. The copy must say so rather than claiming a guarantee it does not have.
  await expect(disclosure).toContainText(/plays weaker/i);
  await expect(disclosure).not.toContainText(/never plays a losing move/i);
  // The turn bar switches to the persona, so a player knows who they are facing.
  await expect(page.locator(".furrow-seat.them")).toContainText("Millet");
});
