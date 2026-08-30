//! Drop 4 wiring test: the board + turn bar + options render and play over the
//! binding; the whole column is a drop target with a core-driven legal glow; a
//! tap drops the player's disc and the engine replies with a visible last-move
//! ring; a full game plays to a terminal result whose verification-forward end
//! screen shows the final board (winning four highlighted) and a re-verifying
//! `?r=` share; the difficulty picker and the mark chooser take effect; hints-off
//! "I'm done" ends. Axe + narrow-phone fit + centred-board guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".drop4-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__drop4));
}

/** Number of discs on the board (both sides). */
const filled = (page: Page): Promise<number> =>
  page.evaluate(() =>
    window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length,
  );

/** Wait until it is the human's turn again (Side A) or the match is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => {
    const b = window.__drop4!.game.board();
    return b.toMove === 1 || b.result !== -1;
  });

test("the board, columns, turn bar, and options render", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await expect(page.locator(".drop4-board")).toBeVisible();
  await expect(page.locator(".drop4-col")).toHaveCount(7);
  // A goal banner explains the game (four in a row).
  // The goal sentence is the opening toast (and the poster's pitch), not a banner in flow.
  await expect(page.locator(".gf-toast")).toContainText(/four in a row/i);
  await expect(page.locator(".drop4-banner")).toHaveCount(0);
  // The opponent has an identity: the turn bar names You and The Engine.
  await expect(page.locator('.gf-seat[data-meter="you"]')).toContainText(/you/i);
  await expect(page.locator('.gf-seat[data-meter="engine"]')).toContainText(/the engine/i);
  await expect(page.locator(".drop4-turnbar")).toHaveCount(0);
  // The difficulty picker offers the four levels, with the top one labelled
  // "Expert" (not "Perfect").
  await page.locator('.gf-verb[data-verb="new"]').click();
  const labels = await page.locator('.gf-sheet [data-setting="level"] .sheet-choice-opt').allTextContents();
  expect(labels).toEqual(["Easy", "Medium", "Hard", "Expert"]);
  await page.keyboard.press("Escape");
  // Fresh board: empty, and every column glows as a legal target.
  expect(await filled(page)).toBe(0);
  await expect(page.locator(".drop4-col.legal")).toHaveCount(7);
  // Columns are numbered 1–7 so the tutor/hint "column N" references are legible.
  await expect(page.locator(".drop4-colnum")).toHaveCount(7);
  await expect(page.locator('.drop4-col[data-col="0"] .drop4-colnum')).toHaveText("1");
  await expect(page.locator('.drop4-col[data-col="6"] .drop4-colnum')).toHaveText("7");
});

test("tapping a column drops a disc and the engine replies with a visible last move", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  expect(await filled(page)).toBe(0);
  await page.locator('.drop4-col[data-col="3"]').click();
  // The player's disc lands, then the engine replies — two discs on the board.
  await page.waitForFunction(
    () => window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length === 2,
  );
  // The engine's move is highlighted so the player can see where it went.
  await expect(page.locator(".drop4-cell.just-played")).toHaveCount(1);
});

test("the core decides legality — a filled column is no longer a legal target", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  for (let i = 0; i < 6; i += 1) {
    const legal = await page.evaluate(() => window.__drop4!.game.board().legal.includes(0));
    const over = await page.evaluate(() => window.__drop4!.game.board().result !== -1);
    if (!legal || over) break;
    await page.locator('.drop4-col[data-col="0"]').click();
    await waitHumanOrOver(page);
  }
  const col0Full = await page.evaluate(() => !window.__drop4!.game.board().legal.includes(0));
  if (col0Full) {
    await expect(page.locator('.drop4-col[data-col="0"]')).not.toHaveClass(/\blegal\b/);
    const before = await page.evaluate(() => window.__drop4!.game.currentHash());
    await page.locator('.drop4-col[data-col="0"]').click();
    const after = await page.evaluate(() => window.__drop4!.game.currentHash());
    expect(after, "a tap on a full column is a no-op").toBe(before);
  }
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="level"] input[value="Hard"]').check();
  await page.locator(".gf-sheet .gf-start").click();
  await expect(page.locator(".gf-mode")).toHaveText("Hard");
  const stored = await page.evaluate(() => localStorage.getItem("fun-drop4-level"));
  expect(stored).toBe("Hard");
});

test("a full game plays to a terminal result; the final board + winning line show; share re-verifies", { tag: "@long" }, async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Play a real game through the UI: each turn tap the leftmost legal column and
  // wait for the engine's reply. The board holds 42 discs, so this terminates.
  for (let ply = 0; ply < 42; ply += 1) {
    const over = await page.evaluate(() => window.__drop4!.game.board().result !== -1);
    if (over) break;
    const col = await page.evaluate(() => window.__drop4!.game.board().legal[0]);
    await page.locator(`.drop4-col[data-col="${col}"]`).click();
    await waitHumanOrOver(page);
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  // The result screen shows the final position so the finish is visible.
  await expect(result.locator(".drop4-board.drop4-final")).toBeVisible();
  // A win highlights exactly the four-in-a-row (proves the win is a real four).
  const code = await page.evaluate(() => window.__drop4!.game.resultCode());
  if (code === 1 || code === 2) {
    await expect(result.locator(".drop4-cell.win")).toHaveCount(4);
  }

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".drop4-board.drop4-final")).toBeVisible();
  await shared.close();
});

// The tutor panel is opt-in (off by default); enable it via its setting.
async function enableTutor(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("fun-drop4-tutor", "on"));
}

test("the tutor panel is off by default and appears when enabled in settings", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Default: no tutor panel (the game plays clean without coaching).
  await expect(page.locator(".drop4-tutor")).toHaveCount(0);
  // Enable the "Show tutor" setting → the panel appears.
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".drop4-tutor-explain")).toBeVisible();
});

test("the tutor flags a blunder end-to-end with an honest explanation", async ({ page }) => {
  await enableTutor(page);
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Set up a position where the human (Side A) has an immediate win in col 0 but
  // B has a standing threat in col 1: after [0,1,0,1,0,1], A to move. Playing
  // col 1 (index 1) gives up the win — a class-dropping blunder the early
  // (capped) search reports as "risky" (it cannot *prove* the class drop yet).
  await page.evaluate(() => {
    const g = window.__drop4!.game;
    for (const c of [0, 1, 0, 1, 0, 1]) g.play(c);
    window.__drop4!.refresh();
  });
  await page.locator('.drop4-col[data-col="1"]').click();
  await waitHumanOrOver(page);
  const coach = page.locator(".drop4-tutor-coach");
  await expect(coach).toBeVisible();
  // Honest wording: capped facts soften to "looks risky" (never the confident
  // "threw the game" reserved for provably-exact endgame facts), and it names
  // the column that held the line (col 0 → "column 1").
  await expect(coach).toContainText(/looks risky/i);
  await expect(coach).not.toContainText(/threw the game/i);
  await expect(coach).toContainText(/column 1\b/);
});

test("'Explain my options' lists at least two band moves with an idea each", async ({ page }) => {
  await enableTutor(page);
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator(".drop4-tutor-explain").click();
  const items = page.locator(".drop4-tutor-options li");
  // A fresh position has several class-preserving moves — the tutor lists them.
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  // Each option names a column and an idea (why it is reasonable).
  await expect(items.first()).toContainText(/column \d/i);
});

test("the why-hint names a column and a reason", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  // Hints are on by default; the upgraded hint says *why*, not just "column N".
  await page.locator('.gf-verb[data-verb="hint"]').click();
  const status = page.locator(".sol-status");
  await expect(status).toContainText(/column \d/i);
  await expect(status).toContainText(/strongest|stays safe|blocks|wins now/i);
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="hints"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
  await page.locator('.gf-verb[data-verb="done"]').click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the experimental local-AI opponent is hidden with no real WebGPU adapter", async ({ page }) => {
  // The gate: no adapter (or only a software/fallback one) → classic picker only,
  // difficulty select untouched. Faked so it is deterministic across browsers.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
  });
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="local-ai"]')).toHaveCount(0);
});

test("the experimental local-AI toggle appears with a real adapter and discloses the download", async ({ page }) => {
  // Fake a real (non-fallback) WebGPU adapter so the probe passes — exercises the
  // toggle + disclosure UI on CI without a real GPU or a model download.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="local-ai"]');
  await expect(row).toHaveCount(1);
  // The one-time, multi-hundred-MB model download is disclosed up front, on the row.
  await expect(row.locator(".sheet-hint")).toContainText(/download|one[- ]time|GB|MB/i);
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board is centered in the play area", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  const board = await page.locator(".drop4-board").boundingBox();
  const area = await page.locator(".gf-stage").boundingBox();
  expect(board).not.toBeNull();
  expect(area).not.toBeNull();
  const boardCenter = board!.x + board!.width / 2;
  const areaCenter = area!.x + area!.width / 2;
  expect(Math.abs(boardCenter - areaCenter)).toBeLessThan(24);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/drop4/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

// --- the frame (plan Phase 11): seats, verbs, the mark as setup, and a board that does not move ---

test("the mark is setup: choosing ○ on the New game sheet makes the player's discs ○", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="mark"] input[value="o"]').check();
  await page.locator(".gf-sheet .gf-start").click();
  await expect(page.locator('.gf-seat[data-meter="you"] .gf-seat-glyph')).toHaveText("○");
  expect(await page.evaluate(() => localStorage.getItem("fun-drop4-mark"))).toBe("o");
});

test("thinking is the engine's seat state, and the board does not move while it replies", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.evaluate(() => {
    const el = document.querySelector('.gf-seat[data-meter="engine"]')!;
    const w = window as unknown as { __seen: boolean };
    w.__seen = false;
    new MutationObserver(() => {
      if (el.getAttribute("data-state") === "thinking") w.__seen = true;
    }).observe(el, { attributes: true });
  });
  const v = await boardTopStable(page, ".drop4-board", async () => {
    await page.locator('.drop4-col[data-col="3"]').click();
    await page.waitForFunction(
      () => window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length === 2,
    );
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(await page.evaluate(() => (window as unknown as { __seen: boolean }).__seen)).toBe(true);
  await expect(page.locator(".drop4-thinking")).toHaveCount(0);
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("leaving mid-game and returning to the bare URL resumes the same position", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await ready(page);
  await page.locator('.drop4-col[data-col="3"]').click();
  await page.waitForFunction(
    () => window.__drop4!.game.board().cells.flat().filter((v: number) => v !== 0).length === 2,
  );
  const hash = await page.evaluate(() => window.__drop4!.game.currentHash());
  await page.goto("/drop4/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toContainText(/move/i);
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  await page.waitForFunction(() => window.__drop4!.game.board().toMove === 1);
  expect(await page.evaluate(() => window.__drop4!.game.currentHash())).toBe(hash);
});
