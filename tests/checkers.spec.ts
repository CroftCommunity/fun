//! Checkers wiring test: the 8×8 board (32 playable dark squares) + turn bar +
//! pickers render and play over the binding; a man glows only if the core says it
//! can move, tapping it glows its destinations, and tapping one commits the move;
//! the engine replies with a visible last-move ring; a capture removes the piece
//! the core says it takes; a full game plays to a terminal result whose
//! verification-forward end screen shows the final board and a re-verifying `?r=`
//! share; the difficulty picker persists. Axe + narrow-phone fit guard the
//! identity.
//!
//! Everything the UI knows about legality comes from `board().legal` — these
//! tests read the same list to decide what to click, so a UI that invented a move
//! would disagree with the core and fail here.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".checkers-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__checkers));
}

/** The human's side value (1 = A/Black, the opener, by default). */
const HUMAN = 1;

/** Pieces on the board (both sides). */
const pieces = (page: Page): Promise<number> =>
  page.evaluate(() =>
    window.__checkers!.game.board().cells.filter((v: number) => v !== 0).length,
  );

/** Wait until it is the human's turn to move, or the match is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction((human) => {
    const b = window.__checkers!.game.board();
    return b.result !== -1 || (b.toMove === human && b.legal.length > 0);
  }, HUMAN);

/** The core's legal moves right now — the tests click what the core allows. */
const legal = (page: Page): Promise<{ from: number; path: number[]; captures: number[] }[]> =>
  page.evaluate(() => window.__checkers!.game.board().legal);

/** Tap a move through the UI: the piece, then each landing in turn. */
async function tapMove(page: Page, mv: { from: number; path: number[] }): Promise<void> {
  await page.locator(`.checkers-square[data-sq="${mv.from}"]`).click();
  for (const landing of mv.path) {
    await page.locator(`.checkers-square[data-sq="${landing}"]`).click();
  }
}

test("the board, turn bar, and pickers render", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  // 64 squares, of which 32 are the playable dark ones; 12 men a side to start.
  await expect(page.locator(".checkers-square")).toHaveCount(64);
  await expect(page.locator(".checkers-square.dark")).toHaveCount(32);
  expect(await pieces(page)).toBe(24);
  // The opening has 7 legal moves, but they come from only 4 men (the front
  // rank) — so exactly 4 squares are offered, one per movable piece.
  expect((await legal(page)).length).toBe(7);
  await expect(page.locator(".checkers-square.selectable")).toHaveCount(4);
  await expect(page.locator(".checkers-banner")).toContainText(/capture/i);
  await expect(page.locator(".checkers-turnbar")).toContainText(/you/i);
  await expect(page.locator(".checkers-turnbar")).toContainText(/the engine/i);
  // Four levels, topped by Expert — checkers is unsolved, so no "Perfect".
  await expect(page.locator(".checkers-level option")).toHaveCount(4);
  await expect(page.locator(".checkers-level")).toContainText("Expert");
  await expect(page.locator(".checkers-level")).not.toContainText("Perfect");
});

test("tapping a man glows its destinations; tapping one moves it and the engine replies", async ({
  page,
}) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  const mv = (await legal(page))[0]!;
  await page.locator(`.checkers-square[data-sq="${mv.from}"]`).click();
  await expect(page.locator(".checkers-square.selected")).toHaveCount(1);
  const targets = await page.locator(".checkers-square.target").count();
  expect(targets).toBeGreaterThanOrEqual(1);

  await page.locator(`.checkers-square[data-sq="${mv.path[0]}"]`).click();
  await waitHumanOrOver(page);
  // The man left its square, and the engine has replied (a ring marks the move).
  expect(
    await page.evaluate((sq) => window.__checkers!.game.board().cells[sq], mv.from),
  ).toBe(0);
  expect(await pieces(page)).toBe(24); // a quiet move takes nothing
  await expect(page.locator(".checkers-square.just-played")).not.toHaveCount(0);
});

test("a capture removes exactly the pieces the core says it takes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/checkers/?seed=3");
  await ready(page);
  let captured = false;
  for (let ply = 0; ply < 60 && !captured; ply += 1) {
    await waitHumanOrOver(page);
    if (await page.evaluate(() => window.__checkers!.game.board().result !== -1)) break;
    const moves = await legal(page);
    const jump = moves.find((m) => m.captures.length > 0);
    const before = await pieces(page);
    await tapMove(page, jump ?? moves[0]!);
    if (jump) {
      await page.waitForFunction((n) => {
        return window.__checkers!.game.board().cells.filter((v: number) => v !== 0).length <= n;
      }, before - jump.captures.length);
      captured = true;
    }
  }
  expect(captured, "no capture reached in 60 plies").toBe(true);
});

test("no axe violations on the board", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  const results = await new AxeBuilder({ page }).include(".checkers-game").analyze();
  expect(results.violations).toEqual([]);
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator(".checkers-level").selectOption("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-checkers-level"))).toBe("Hard");
});

test("the side picker restarts the game with the engine opening", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator(".checkers-side-pick").selectOption("white");
  expect(await page.evaluate(() => localStorage.getItem("fun-checkers-side"))).toBe("white");
  // Playing White means the engine (Black) opens, so it moves without a tap.
  await page.waitForFunction(() => window.__checkers!.game.board().toMove === 2);
});

test("a full game plays to a terminal result; the final board shows; share re-verifies", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/checkers/?seed=7");
  await ready(page);
  for (let ply = 0; ply < 140; ply += 1) {
    await waitHumanOrOver(page);
    if (await page.evaluate(() => window.__checkers!.game.board().result !== -1)) break;
    const moves = await legal(page);
    await tapMove(page, moves[0]!);
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".checkers-board.checkers-final")).toBeVisible();

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".checkers-board.checkers-final")).toBeVisible();
  await shared.close();
});

test("the board fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/checkers/?seed=7");
  await ready(page);
  const fits = await page.evaluate(() => {
    const b = document.querySelector(".checkers-board");
    return b ? b.getBoundingClientRect().width <= window.innerWidth : false;
  });
  expect(fits).toBe(true);
});

// ---------- Phase 14: the tutor panel + the experimental hybrid opponent ----------

// The tutor panel is opt-in (off by default); enable it via its setting.
async function enableTutor(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("fun-checkers-tutor", "on"));
}

test("the tutor panel is off by default and appears when enabled in settings", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await expect(page.locator(".checkers-tutor")).toHaveCount(0);
  await page.locator(".checkers-settings summary").click();
  await page.locator(".checkers-set-tutor").check();
  await expect(page.locator(".checkers-tutor-explain")).toBeVisible();
});

test("'Explain my options' lists band moves, each naming a move and an idea", async ({ page }) => {
  await enableTutor(page);
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator(".checkers-tutor-explain").click();
  const items = page.locator(".checkers-tutor-options li");
  // The panel searches deeper than any move-time search and defers past the
  // paint so the button does not look dead, so the list arrives a frame later —
  // wait for it rather than reading a count that is 0 by construction. (The
  // transient "Reading ahead…" state is deliberately not asserted: whether it is
  // still on screen when the assertion polls is a race with the search itself.)
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  // A checkers move is a path, so the label names both ends.
  await expect(items.first()).toContainText(/row \d, column \d to row \d, column \d/i);
  // The opening is not proven, and the panel says so rather than implying certainty.
  await expect(page.locator(".checkers-tutor-note")).toContainText(/not yet certain/i);
});

test("the experimental local-AI opponent is hidden with no real WebGPU adapter", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
  });
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator(".checkers-settings summary").click();
  await expect(page.locator(".checkers-ai-toggle-input")).toHaveCount(0);
});

test("the experimental local-AI toggle appears with a real adapter and discloses the download", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator(".checkers-settings summary").click();
  const toggle = page.locator(".checkers-ai-toggle-input");
  await expect(toggle).toHaveCount(1);
  await toggle.check();
  await expect(page.locator(".checkers-ai-disclosure")).toContainText(/download|one[- ]time|GB|MB/i);
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await enableTutor(page);
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => localStorage.setItem("fun-theme", t), theme);
    await page.goto("/checkers/?seed=7");
    await ready(page);
    const results = await new AxeBuilder({ page }).include(".checkers-game").analyze();
    expect(results.violations, `axe violations in ${theme}`).toEqual([]);
  }
});

test("the settings panel stays open when something re-renders the board", async ({ page }) => {
  // Same defect as dots': render() is container.replaceChildren, so a re-render
  // rebuilt the panel the player had opened. This game re-renders on its own when
  // the WebGPU probe resolves, at a moment nothing in the UI predicts — toggling a
  // setting fires the same render(), which makes the race a deterministic click.
  await page.goto("/checkers/?seed=7");
  await ready(page);
  const panel = page.locator(".checkers-settings");
  await page.locator(".checkers-settings summary").click();
  await expect(panel).toHaveAttribute("open", "");

  await page.locator(".checkers-set-tutor").click();

  await expect(panel).toHaveAttribute("open", "");
});
