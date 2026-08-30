//! Color Sort board wiring/E2E: the puzzle at its own URL. Asserts the core-driven
//! legal-target glow (the guardrail against rules leaking into the UI), the
//! illegal-tap no-op + undo, the verifiable win + share round-trip, skin
//! invariance, and mobile fit. Drives the binding through `window.__colorSort`.

import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".cs-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__colorSort));
}

test("daily board renders 12 tubes (10 colours + 2 empty)", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/color-sort/?play=1");
  await ready(page);
  await expect(page.locator(".cs-tube")).toHaveCount(12);
  const colors = await page.evaluate(() => window.__colorSort!.board().colors);
  expect(colors).toBe(10);
  // Moves and par are the frame's meters, the chip says Daily, and the game's own
  // bar, HUD line and settings disclosure are gone. Undo, Restart and Hint are dock verbs.
  await expect(page.locator('.gf-stat[data-meter="moves"]')).toContainText(/moves/i);
  await expect(page.locator('.gf-stat[data-meter="mark"]')).toContainText(/par/i);
  await expect(page.locator('.gf-stat[data-meter="best"]')).toContainText(/best/i);
  await expect(page.locator(".gf-mode")).toHaveText(/daily/i);
  await expect(page.locator(".sol-controls, .cs-hud, .sol-settings, .cs-banner")).toHaveCount(0);
  for (const verb of ["undo", "restart", "hint", "new"]) {
    await expect(page.locator(`.gf-verb[data-verb="${verb}"]`)).toHaveCount(1);
  }
});

test("selecting a source glows exactly the core's legal targets", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);

  // From the core: pick a source that has legal pours, and the exact targets it
  // should glow.
  const { from, expected } = await page.evaluate(() => {
    const b = window.__colorSort!.board();
    const src = b.moves[0]!.from;
    const targets = b.moves.filter((m) => m.from === src).map((m) => m.to);
    return { from: src, expected: [...new Set(targets)] };
  });
  expect(expected.length).toBeGreaterThan(0);

  await page.locator(`.cs-tube[data-tube="${from}"]`).click();
  await expect(page.locator(".cs-tube.legal")).toHaveCount(expected.length);

  const glowed = await page.evaluate(() =>
    [...document.querySelectorAll(".cs-tube.legal")].map((e) => Number((e as HTMLElement).dataset.tube)),
  );
  expect(new Set(glowed)).toEqual(new Set(expected));
});

test("a legal pour changes the board; an illegal tap leaves it unchanged; undo reverts", async ({
  page,
}) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);

  const { from, to, illegal } = await page.evaluate(() => {
    const b = window.__colorSort!.board();
    const mv = b.moves[0]!;
    // A tube that is NOT a legal target for `mv.from` and not the source itself.
    const targets = new Set(b.moves.filter((m) => m.from === mv.from).map((m) => m.to));
    let bad = -1;
    for (let t = 0; t < b.tubes.length; t++) {
      if (t !== mv.from && !targets.has(t) && !b.locked[t]) {
        bad = t;
        break;
      }
    }
    return { from: mv.from, to: mv.to, illegal: bad };
  });

  const hash0 = await page.evaluate(() => window.__colorSort!.game.currentHash());

  // Select the source, tap an illegal target → nothing changes, still selected.
  await page.locator(`.cs-tube[data-tube="${from}"]`).click();
  if (illegal >= 0) {
    await page.locator(`.cs-tube[data-tube="${illegal}"]`).click();
    expect(await page.evaluate(() => window.__colorSort!.game.currentHash())).toBe(hash0);
  }

  // Tap the legal target → the board changes.
  await page.locator(`.cs-tube[data-tube="${to}"].legal`).click();
  const hashMoved = await page.evaluate(() => window.__colorSort!.game.currentHash());
  expect(hashMoved).not.toBe(hash0);

  // Undo reverts to the pre-move state.
  await page.locator('.gf-verb[data-verb="undo"]').click();
  expect(await page.evaluate(() => window.__colorSort!.game.currentHash())).toBe(hash0);
});

test("win path: solve endless L1 → verifiable result + share link round-trips", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);

  const moveCount = await page.evaluate(() => {
    const h = window.__colorSort!;
    let n = 0;
    for (let i = 0; i < 300 && !h.game.isWon(); i++) {
      const mv = h.game.hint();
      if (!mv) break;
      h.game.pour(mv.from, mv.to);
      n++;
    }
    h.refresh();
    return n;
  });
  expect(moveCount).toBeGreaterThan(0);

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");

  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("toggling skin mid-game leaves the engine state bit-identical (§10.7)", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);

  // Make a move so there is real state, then record the hash.
  await page.evaluate(() => {
    const h = window.__colorSort!;
    const mv = h.game.hint();
    if (mv) h.game.pour(mv.from, mv.to);
    h.refresh();
  });
  const before = await page.evaluate(() => window.__colorSort!.game.currentHash());

  // Switch to the Ball skin via Settings.
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="skin"] input[value="ball"]').check();
  await expect(page.locator(".cs-board.cs-skin-ball")).toBeVisible();

  const after = await page.evaluate(() => window.__colorSort!.game.currentHash());
  expect(after).toBe(before);
});

test("Strict mode is a preference: it takes the Undo verb away and gives it back", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await expect(page.locator('.gf-verb[data-verb="undo"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const strict = page.locator('.gf-sheet [data-setting="strict"] .sheet-toggle-input');
  await strict.click({ force: true });
  await expect(page.locator('.gf-verb[data-verb="undo"]')).toHaveCount(0);
  await strict.click({ force: true });
  await expect(page.locator('.gf-verb[data-verb="undo"]')).toHaveCount(1);
});

test("the New game card picks Daily or Endless, and the chip says which", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/level 1/i);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet.locator('[data-setting="mode"] .sheet-choice-opt')).toHaveText(["Daily", "Endless"]);
  await sheet.locator('[data-setting="mode"] input[value="daily"]').check();
  await sheet.locator(".gf-sheet-start").click();
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/daily/i);
  await expect(page.locator(".cs-tube")).toHaveCount(12);
});

test("a pour does not move the board, and neither does the settings sheet", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/color-sort/?level=1");
  await ready(page);
  const mv = await page.evaluate(() => window.__colorSort!.game.hint());
  const v = await boardTopStable(page, ".cs-board", async () => {
    await page.locator(`.cs-tube[data-tube="${mv!.from}"]`).click();
    await page.locator(`.cs-tube[data-tube="${mv!.to}"].legal`).click();
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("leaving mid-game and returning to the bare URL resumes the same position", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await page.evaluate(() => {
    const h = window.__colorSort!;
    const mv = h.game.hint();
    if (mv) h.game.pour(mv.from, mv.to);
    h.refresh();
  });
  const hash = await page.evaluate(() => window.__colorSort!.game.currentHash());
  await page.goto("/color-sort/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toContainText(/level 1/i);
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  expect(await page.evaluate(() => window.__colorSort!.game.currentHash())).toBe(hash);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/color-sort/?play=1");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("the in-game 'How to play' link reaches the guide", async ({ page }) => {
  await page.goto("/color-sort/?play=1");
  await ready(page);
  await page.locator(".gf-more").click(); // the link lives in the game bar's ⋯ menu
  await page.getByRole("link", { name: /how to play/i }).click();
  await expect(page).toHaveURL(/\/how-to\/\?game=color-sort/);
  await expect(page.locator("h1")).toContainText(/how to play color sort/i);
});
