//! Color Sort board wiring/E2E: the puzzle at its own URL. Asserts the core-driven
//! legal-target glow (the guardrail against rules leaking into the UI), the
//! illegal-tap no-op + undo, the verifiable win + share round-trip, skin
//! invariance, and mobile fit. Drives the binding through `window.__colorSort`.

import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".cs-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__colorSort));
}

test("daily board renders 12 tubes (10 colours + 2 empty)", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/color-sort/");
  await ready(page);
  await expect(page.locator(".cs-tube")).toHaveCount(12);
  const colors = await page.evaluate(() => window.__colorSort!.board().colors);
  expect(colors).toBe(10);
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
  await page.locator(".cs-undo").first().click();
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
  await page.locator(".sol-settings summary").click();
  await page.locator(".cs-skin-btn.cs-skin-ball").click();
  await expect(page.locator(".cs-board.cs-skin-ball")).toBeVisible();

  const after = await page.evaluate(() => window.__colorSort!.game.currentHash());
  expect(after).toBe(before);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/color-sort/");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("the in-game 'How to play' link reaches the guide", async ({ page }) => {
  await page.goto("/color-sort/");
  await ready(page);
  await page.getByRole("link", { name: /how to play/i }).click();
  await expect(page).toHaveURL(/\/how-to\/\?game=color-sort/);
  await expect(page.locator("h1")).toContainText(/how to play color sort/i);
});
