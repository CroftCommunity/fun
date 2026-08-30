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

import { boardTopStable } from "./helpers/board-top.js";

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

test("the board, turn bar, and pickers render", { tag: "@smoke" }, async ({ page }) => {
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
  // The rules sentence is the opening toast (and the poster's pitch), not a banner in flow.
  await expect(page.locator(".gf-toast")).toContainText(/capture/i);
  await expect(page.locator(".checkers-banner, .checkers-turnbar, .checkers-controls")).toHaveCount(0);
  await expect(page.locator('.gf-seat[data-meter="you"]')).toContainText(/you/i);
  await expect(page.locator('.gf-seat[data-meter="you"] .gf-seat-score')).toHaveText("12");
  await expect(page.locator('.gf-seat[data-meter="engine"]')).toContainText(/the engine/i);
  // Four levels, topped by Expert — checkers is unsolved, so no "Perfect".
  await page.locator('.gf-verb[data-verb="new"]').click();
  const labels = await page.locator('.gf-sheet [data-setting="level"] .sheet-choice-opt').allTextContents();
  expect(labels).toEqual(["Easy", "Medium", "Hard", "Expert"]);
  await page.keyboard.press("Escape");
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
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="level"] input[value="Hard"]').check();
  await page.locator(".gf-sheet .gf-start").click();
  await expect(page.locator(".gf-mode")).toHaveText("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-checkers-level"))).toBe("Hard");
});

test("the side picker restarts the game with the engine opening", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="side"] input[value="white"]').check();
  await page.locator(".gf-sheet .gf-start").click();
  expect(await page.evaluate(() => localStorage.getItem("fun-checkers-side"))).toBe("white");
  // Playing White means the engine (Black) opens, so it moves without a tap.
  await page.waitForFunction(() => window.__checkers!.game.board().toMove === 2);
});

test("a full game plays to a terminal result; the final board shows; share re-verifies", { tag: "@long" }, async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/checkers/?seed=7&fast=1");
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
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="local-ai"]')).toHaveCount(0);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="local-ai"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator(".sheet-hint")).toContainText(/download|one[- ]time|GB|MB/i);
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

test("the settings sheet stays open when something re-renders the board", async ({ page }) => {
  // The sheet is the frame's, outside the game's replaceChildren — a re-render
  // (toggling the tutor re-renders the board) cannot close it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet).toBeVisible();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".checkers-tutor")).toBeVisible();
  await expect(sheet).toBeVisible();
});
test("the tutor's explained options survive a re-render on the same position", async ({ page }) => {
  // TODO/dots.md:81 — the reading used to live only in the DOM, so any render()
  // erased it. Hiding and re-showing the tutor is the board-neutral re-render
  // this game actually exposes: the panel is genuinely destroyed and rebuilt, and
  // the position has not changed, so the reading is still true and must come back.
  // The other half — that it CLEARS once a move is played, rather than describing
  // a position that no longer exists — is pinned in dots.spec.ts, where a legal
  // move is one click away.
  await page.addInitScript(() => localStorage.setItem("fun-checkers-tutor", "on"));
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".checkers-tutor-explain").click();
  const items = page.locator(".checkers-tutor-options li");
  await expect(items.first()).toBeVisible();
  const before = await items.count();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const tutor = page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input');
  await tutor.click({ force: true }); // hide  -> render()
  await expect(page.locator(".checkers-tutor")).toHaveCount(0);
  await tutor.click({ force: true }); // show  -> render()

  await expect(items).toHaveCount(before);
});

// --- the frame (plan Phase 12): the board does not move while the engine replies; resume ---

test("thinking is the engine's seat state and the board does not move across its reply", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await page.evaluate(() => {
    const el = document.querySelector('.gf-seat[data-meter="engine"]')!;
    const w = window as unknown as { __seen: boolean };
    w.__seen = false;
    new MutationObserver(() => {
      if (el.getAttribute("data-state") === "thinking") w.__seen = true;
    }).observe(el, { attributes: true });
  });
  const v = await boardTopStable(page, ".checkers-board", async () => {
    await tapMove(page, (await legal(page))[0]!);
    await page.waitForFunction(() => {
      const b = window.__checkers!.game.board();
      return b.result !== -1 || b.toMove === 1;
    });
  });
  expect(await page.evaluate(() => (window as unknown as { __seen: boolean }).__seen)).toBe(true);
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("leaving mid-game and returning to the bare URL resumes the same position", async ({ page }) => {
  await page.goto("/checkers/?seed=7");
  await ready(page);
  await tapMove(page, (await legal(page))[0]!);
  await page.waitForFunction(() => {
    const b = window.__checkers!.game.board();
    return b.result !== -1 || b.toMove === 1;
  });
  const hash = await page.evaluate(() => window.__checkers!.game.currentHash());
  await page.goto("/checkers/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  await page.waitForFunction(() => window.__checkers!.game.board().toMove === 1);
  expect(await page.evaluate(() => window.__checkers!.game.currentHash())).toBe(hash);
});
