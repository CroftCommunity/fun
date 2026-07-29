//! Phase D wiring test (front-plan Phase 4): the solitaire board at its own URL.
//! Mechanics assertions are deal-agnostic + one hook-informed real move; the
//! win path replays the Phase S fixture (`daily-pack.json` `payload[0]`) via the
//! `window.__solitaire` test hook so the E2E drives the binding rather than 500
//! literal taps, then round-trips the share link.

import { expect, test, type Page } from "@playwright/test";

/** Wait until the board and the test hook are live. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator(".sol-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__solitaire));
}

test("board renders the seed-0 deal: 7 piles sized 1..7, hidden cards have no card", async ({
  page,
}) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  await expect(page.locator(".sol-pile")).toHaveCount(7);
  const shape = await page.evaluate(() => {
    const board = window.__solitaire!.game.board();
    return {
      sizes: board.tableau.map((pile) => pile.length),
      hiddenPerPile: board.tableau.map((pile) => pile.filter((s) => !s.card).length),
      hiddenHaveNoCard: board.tableau.every((pile) => pile.every((s) => s.faceUp || s.card === undefined)),
    };
  });
  expect(shape.sizes).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(shape.hiddenPerPile).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(shape.hiddenHaveNoCard).toBe(true);
});

test("tapping the stock draws a card to the waste", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  const before = await page.evaluate(() => window.__solitaire!.game.board().wasteCount);
  await page.locator(".sol-stock").click();
  const after = await page.evaluate(() => window.__solitaire!.game.board().wasteCount);
  expect(after).toBe(before + 1);
});

test("selecting a source glows exactly the core's legal targets", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  // Draw once so the waste has a top card, then compute — from the core — the
  // exact targets selecting the waste should glow.
  await page.locator(".sol-stock").click();
  const expected = await page.evaluate(() => {
    const h = window.__solitaire!;
    const board = h.game.board();
    const targets = new Set<string>();
    for (const m of h.game.legalMoves()) {
      if (m === "WasteToFoundation" && board.wasteTop) targets.add(`f${board.wasteTop.suit}`);
      else if (typeof m === "object" && "WasteToTableau" in m) targets.add(`p${m.WasteToTableau.pile}`);
    }
    return [...targets];
  });
  expect(expected.length, "seed 0 after one draw should offer a waste move").toBeGreaterThan(0);

  await page.locator('[data-el="waste"]').click();
  await expect(page.locator(".legal-target")).toHaveCount(expected.length);

  const glowed = await page.evaluate(() =>
    [...document.querySelectorAll(".legal-target")].map((e) => {
      const el = e as HTMLElement;
      return el.dataset.el === "foundation" ? `f${el.dataset.suit}` : `p${el.dataset.pile}`;
    }),
  );
  expect(new Set(glowed)).toEqual(new Set(expected));
});

test("a legal move changes the board; an illegal tap leaves it unchanged; undo reverts", async ({
  page,
}) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  // Draw once — seed 0's waste top is then the Ace of Hearts, a legal
  // waste→foundation move (its suit foundation glows, no others).
  await page.locator(".sol-stock").click();
  const wasteSuit = await page.evaluate(() => window.__solitaire!.game.board().wasteTop!.suit);
  const hash0 = await page.evaluate(() => window.__solitaire!.game.currentHash());

  // Illegal: select the waste, click a foundation that is NOT its suit (not glowed).
  const otherSuit = (wasteSuit + 1) % 4;
  await page.locator('[data-el="waste"]').click();
  await page.locator(`.sol-foundation[data-suit="${otherSuit}"]`).click();
  const hashIllegal = await page.evaluate(() => window.__solitaire!.game.currentHash());
  expect(hashIllegal).toBe(hash0);

  // Legal: select the waste, click the glowed suit foundation.
  await page.locator('[data-el="waste"]').click();
  await page.locator(`.sol-foundation[data-suit="${wasteSuit}"].legal-target`).click();
  const hashMoved = await page.evaluate(() => window.__solitaire!.game.currentHash());
  expect(hashMoved).not.toBe(hash0);

  // Undo reverts to the pre-move state.
  await page.locator(".sol-undo").click();
  const hashUndone = await page.evaluate(() => window.__solitaire!.game.currentHash());
  expect(hashUndone).toBe(hash0);
});

test("win path: replay the fixture → verifiable clean-clear + share link round-trips", async ({
  page,
}) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  // Drive the binding with the win fixture (pack[0]), then re-render.
  await page.evaluate(async () => {
    const pack = await (await fetch("/daily-pack.json")).json();
    const h = window.__solitaire!;
    for (const move of pack.payload[0].moves) h.game.play(move);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-headline")).toContainText(/clean/i);
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText("500");

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");

  // Open the share link in a fresh page — it must re-verify before display.
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".sol-record")).toContainText("500");
  await shared.close();
});

test("New deal deals a different game (the up-turned cards change)", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  const before = await page.evaluate(() => window.__solitaire!.game.currentHash());
  await page.locator(".sol-new").click();
  await page.waitForFunction((h) => window.__solitaire!.game.currentHash() !== h, before);
  const after = await page.evaluate(() => window.__solitaire!.game.currentHash());
  expect(after).not.toBe(before);
});

test("Hint points at a legal move and marks the game assisted", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  await page.locator(".sol-hint").click();
  // A hint highlights exactly one target to move toward…
  await expect(page.locator(".hint-to")).toHaveCount(1);
  await expect(page.locator(".sol-status")).toContainText(/hint/i);
  // …and using a hint counts as assistance in the outcome record.
  const assisted = await page.evaluate(
    () => (window.__solitaire!.game.outcome("abandoned", true) as { payload: { assistance: boolean | null } }).payload.assistance,
  );
  expect(assisted).toBe(true);
});

test("with hints off, 'I'm stuck' ends the game and reports whether a move existed", async ({
  page,
}) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  // Disable hints in settings — the control flips to "I'm stuck".
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  const stuck = page.locator(".sol-stuck");
  await expect(stuck).toBeVisible();
  await stuck.click();

  // The game ends as a Stuck outcome, and honestly notes a move was available
  // (seed 0's opening always has at least a draw).
  await expect(page.locator(".sol-result")).toBeVisible();
  await expect(page.locator(".sol-record")).toContainText("Stuck");
  await expect(page.locator(".sol-note")).toContainText(/move was still available/i);
});

test("full-screen keeps the board mounted and playable", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await ready(page);

  await page.getByRole("button", { name: /toggle full screen/i }).click();
  await expect(page.locator("body")).toHaveClass(/fullscreen/);
  await expect(page.locator(".sol-board")).toBeVisible();

  // Still playable: the stock still draws in full-screen.
  const before = await page.evaluate(() => window.__solitaire!.game.board().wasteCount);
  await page.locator(".sol-stock").click();
  const after = await page.evaluate(() => window.__solitaire!.game.board().wasteCount);
  expect(after).toBe(before + 1);
});
