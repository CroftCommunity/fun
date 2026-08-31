//! Chess wiring test: the 8×8 board + seats render and play over the binding; a
//! piece glows only if the core says it can move, tapping it glows its
//! destinations, and tapping one commits the move; the engine replies with a
//! visible last-move ring; castling is the king's two-square tap; en passant is
//! offered; a promotion goes through the picker; Undo takes back a pair; a full
//! game plays to a terminal result whose verification-forward end screen shows
//! the final board and a re-verifying `?r=` share; the pickers persist. Axe +
//! narrow-phone fit + the frame's stability rule guard the identity.
//!
//! Everything the UI knows about legality comes from `board().legal` — these
//! tests read the same list to decide what to click, so a UI that invented a
//! move would disagree with the core and fail here. Positions that would take
//! many moves to reach are set up by playing BOTH sides through the hook.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".chess-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__chess));
}

/** The human's side value (1 = White, the opener, by default). */
const HUMAN = 1;

/** Wait until it is the human's turn to move, or the game is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction((human) => {
    const b = window.__chess!.game.board();
    return b.result !== -1 || (b.toMove === human && b.legal.length > 0);
  }, HUMAN);

/** The core's legal moves right now — the tests click what the core allows. */
const legal = (page: Page): Promise<{ code: number; from: number; to: number; promo: number }[]> =>
  page.evaluate(() => window.__chess!.game.board().legal);

const hash = (page: Page): Promise<string> =>
  page.evaluate(() => window.__chess!.game.currentHash());

/** Play a UCI sequence for BOTH sides through the hook (no engine reply), then re-render. */
async function script(page: Page, moves: string[]): Promise<void> {
  await page.evaluate((list) => {
    const g = window.__chess!.game;
    const sq = (s: string): number => "abcdefgh".indexOf(s[0]!) + (Number(s[1]) - 1) * 8;
    for (const uci of list) {
      const from = sq(uci.slice(0, 2));
      const to = sq(uci.slice(2, 4));
      const promo = { n: 1, b: 2, r: 3, q: 4 }[uci[4] ?? ""] ?? 0;
      const mv = g.board().legal.find((m) => m.from === from && m.to === to && m.promo === promo);
      if (!mv) throw new Error(`scripted move ${uci} is not legal here`);
      if (g.play(mv.code) !== "applied") throw new Error(`scripted move ${uci} refused`);
    }
    window.__chess!.refresh();
  }, moves);
}

const cell = (page: Page, sq: number) => page.locator(`.chess-square[data-sq="${sq}"]`);
const sqOf = (name: string): number => "abcdefgh".indexOf(name[0]!) + (Number(name[1]) - 1) * 8;

test("the board, seats, and pickers render", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  await expect(page.locator(".chess-square")).toHaveCount(64);
  // Twenty legal moves from ten pieces: exactly those ten are offered.
  expect((await legal(page)).length).toBe(20);
  await expect(page.locator(".chess-square.selectable")).toHaveCount(10);
  // White at the bottom: a1 is the bottom-left cell (view 0).
  await expect(page.locator('.chess-square[data-view="0"]')).toHaveAttribute("data-sq", "0");
  await expect(page.locator(".gf-toast")).toContainText(/legal moves/i);
  await expect(page.locator('.gf-seat[data-meter="you"]')).toContainText(/you/i);
  await expect(page.locator('.gf-seat[data-meter="you"] .gf-seat-score')).toHaveText("0");
  await expect(page.locator('.gf-seat[data-meter="engine"]')).toContainText(/the engine/i);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const labels = await page.locator('.gf-sheet [data-setting="level"] .sheet-choice-opt').allTextContents();
  expect(labels).toEqual(["Easy", "Medium", "Hard", "Expert"]);
  await page.keyboard.press("Escape");
});

test("tapping a piece glows its destinations; tapping one moves it and the engine replies", async ({
  page,
}) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  const before = await hash(page);
  const e2 = sqOf("e2");
  const dests = (await legal(page)).filter((m) => m.from === e2).map((m) => m.to);
  expect(dests.sort()).toEqual([sqOf("e3"), sqOf("e4")].sort());
  await cell(page, e2).click();
  await expect(page.locator(".chess-square.target")).toHaveCount(2);
  // An illegal tap changes nothing: a square nobody can reach.
  await cell(page, sqOf("a5")).click();
  expect(await hash(page)).toBe(before);
  await cell(page, e2).click();
  await cell(page, sqOf("e4")).click();
  await expect(cell(page, sqOf("e4")).locator(".chess-piece")).toHaveCount(1);
  await waitHumanOrOver(page);
  // The engine's reply is ringed and the seat shows the human is on again.
  await expect(page.locator(".chess-square.just-played")).toHaveCount(2);
  await expect(page.locator('.gf-seat[data-meter="you"]')).toHaveAttribute("data-state", "active");
  expect(await hash(page)).not.toBe(before);
});

test("castling is the king's two-square tap", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await script(page, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"]);
  await cell(page, sqOf("e1")).click();
  await expect(cell(page, sqOf("g1"))).toHaveClass(/target/);
  await cell(page, sqOf("g1")).click();
  const cells = await page.evaluate(() => window.__chess!.game.board().cells);
  expect(cells[sqOf("g1")]).toBe(6); // white king
  expect(cells[sqOf("f1")]).toBe(4); // white rook crossed
  expect(cells[sqOf("h1")]).toBe(0);
});

test("en passant is offered where it is legal, and takes the pawn beside", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await script(page, ["e2e4", "a7a6", "e4e5", "d7d5"]);
  const ep = (await legal(page)).find((m) => m.from === sqOf("e5") && m.to === sqOf("d6"));
  expect(ep, "the core offers exd6 e.p.").toBeTruthy();
  await cell(page, sqOf("e5")).click();
  await cell(page, sqOf("d6")).click();
  const cells = await page.evaluate(() => window.__chess!.game.board().cells);
  expect(cells[sqOf("d5")]).toBe(0);
  expect(cells[sqOf("d6")]).toBe(1);
});

test("a promotion goes through the picker; Escape cancels it", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await script(page, ["a2a4", "h7h5", "a4a5", "h5h4", "a5a6", "h4h3", "a6b7", "h3g2"]);
  const promos = (await legal(page)).filter((m) => m.from === sqOf("b7") && m.to === sqOf("a8"));
  expect(promos.map((m) => m.promo).sort()).toEqual([1, 2, 3, 4]);
  const before = await hash(page);
  await cell(page, sqOf("b7")).click();
  await cell(page, sqOf("a8")).click();
  await expect(page.locator(".chess-picker")).toBeVisible();
  await expect(page.locator(".chess-picker-card button")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.locator(".chess-picker")).toHaveCount(0);
  expect(await hash(page)).toBe(before);
  // Then choose the rook.
  await cell(page, sqOf("b7")).click();
  await cell(page, sqOf("a8")).click();
  await page.locator('.chess-picker-card button[data-promo="3"]').click();
  const b = await page.evaluate(() => window.__chess!.game.board());
  expect(b.cells[sqOf("a8")]).toBe(4);
  expect(b.lastSan).toBe("bxa8=R");
});

test("the checked king is marked when in check and not otherwise", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await expect(page.locator(".chess-square.check")).toHaveCount(0);
  await script(page, ["f2f4", "e7e5", "f4e5", "d8h4"]);
  await expect(page.locator(".chess-square.check")).toHaveCount(1);
  await expect(cell(page, sqOf("e1"))).toHaveClass(/check/);
});

test("Undo is a no-op at move 0, and takes back a pair after the engine's reply", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  const start = await hash(page);
  await expect(page.locator('.gf-verb[data-verb="undo"]')).toBeDisabled();
  await cell(page, sqOf("d2")).click();
  await cell(page, sqOf("d4")).click();
  await waitHumanOrOver(page);
  expect(await hash(page)).not.toBe(start);
  await expect(page.locator('.gf-verb[data-verb="undo"]')).toBeEnabled();
  await page.locator('.gf-verb[data-verb="undo"]').click();
  expect(await hash(page)).toBe(start);
});

test("no axe violations on the board", async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/chess/?seed=7");
    await ready(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, scheme).toEqual([]);
  }
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="level"] input[value="Hard"]').check();
  await page.keyboard.press("Escape");
  await page.reload();
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText("Hard");
});

test("playing Black flips the board and the engine opens", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await page.locator('.gf-sheet [data-setting="side"] input[value="black"]').check();
  await page.locator(".gf-sheet .gf-sheet-start").click();
  expect(await page.evaluate(() => localStorage.getItem("fun-chess-side"))).toBe("black");
  await page.waitForFunction(() => {
    const b = window.__chess!.game.board();
    return b.toMove === 2 && b.lastMove !== null;
  });
  // Black at the bottom: view 0 shows h8 (63).
  await expect(page.locator('.chess-square[data-view="0"]')).toHaveAttribute("data-sq", "63");
});

test("a full game plays to a terminal result; the final board shows; share re-verifies", { tag: "@long" }, async ({
  page,
}) => {
  await page.goto("/chess/?seed=3&fast=1");
  await ready(page);
  for (let ply = 0; ply < 400; ply++) {
    await waitHumanOrOver(page);
    const b = await page.evaluate(() => window.__chess!.game.board());
    if (b.result !== -1) break;
    // The first legal move — through the UI, promotions via the picker.
    const mv = b.legal[0]!;
    await cell(page, mv.from).click();
    await cell(page, mv.to).click();
    if (b.legal.filter((m) => m.from === mv.from && m.to === mv.to).length > 1) {
      await page.locator('.chess-picker-card button[data-promo="4"]').click();
    }
  }
  await expect(page.locator(".sol-result")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(page.locator(".chess-board.chess-final")).toBeVisible();
  const share = await page.locator(".sol-share").getAttribute("data-share");
  expect(share).toContain("?r=");
  await page.goto(share!);
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("the board fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chess/?seed=7");
  await ready(page);
  const box = await page.locator(".chess-board").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  const square = await page.locator('.chess-square[data-view="0"]').boundingBox();
  expect(square!.width).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("thinking is the engine's seat state and the board does not move across its reply", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  const verdict = await boardTopStable(page, ".chess-board", async () => {
    await cell(page, sqOf("e2")).click();
    await cell(page, sqOf("e4")).click();
    await expect(page.locator('.gf-seat[data-meter="engine"]')).toHaveAttribute("data-state", "thinking");
    await waitHumanOrOver(page);
  });
  expect(verdict.frames).toBeGreaterThan(5);
  expect(verdict.stable, `the board moved ${verdict.delta}px across the engine's reply`).toBe(true);
});

test("leaving mid-game and returning to the bare URL resumes the same position", async ({ page }) => {
  await page.goto("/chess/?seed=7&fast=1");
  await ready(page);
  await cell(page, sqOf("e2")).click();
  await cell(page, sqOf("e4")).click();
  await waitHumanOrOver(page);
  const h = await hash(page);
  await page.goto("/chess/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  expect(await hash(page)).toBe(h);
});

/** Enable the tutor the way a player does: the settings sheet's toggle (a sheet on a phone). */
async function enableTutor(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
}

test("the tutor panel is off by default and appears when enabled in settings", async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  await expect(page.locator(".chess-tutor")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".chess-tutor-explain")).toBeVisible();
});

test("'Explain my options' lists moves in SAN, each with an idea, and hedges the opening", async ({ page }) => {
  await page.goto("/chess/?seed=7");
  await ready(page);
  await enableTutor(page);
  await page.locator(".chess-tutor-explain").click();
  const items = page.locator(".chess-tutor-options li");
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const lines = await items.allTextContents();
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) expect(line).toMatch(/^[a-hNBRQKO][^—]* — .+/);
  await expect(page.locator(".chess-tutor-note")).toContainText(/not yet certain/i);
});

test("the experimental local-AI opponent is hidden with no real WebGPU adapter", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
  });
  await page.goto("/chess/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="tutor"]')).toHaveCount(1);
  await expect(page.locator('.gf-sheet [data-setting="local-ai"]')).toHaveCount(0);
});

test("the experimental local-AI toggle appears with a real adapter and discloses the download", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.goto("/chess/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="local-ai"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator(".sheet-hint")).toContainText(/download|one[- ]time/i);
});
