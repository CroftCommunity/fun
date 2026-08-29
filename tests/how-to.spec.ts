//! Phase-E-adjacent wiring test: the shared "How to play" page renders a game's
//! guide, every screenshot actually loads, and the in-game link reaches it.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the how-to page renders the solitaire guide with all screenshots loading", async ({
  page,
}) => {
  await page.goto("/how-to/?game=solitaire");
  await expect(page.locator("h1")).toContainText(/how to play solitaire/i);

  // Table of contents has one link per section (intro panel + N entries).
  const entries = await page.locator(".guide-entry").count();
  expect(entries).toBeGreaterThan(0);
  await expect(page.locator(".guide-toc a")).toHaveCount(entries);

  // Every referenced screenshot actually loaded (no broken/missing shots). Poll
  // rather than sample once — images may still be decoding right after navigation.
  const shots = page.locator(".guide-shot img");
  const n = await shots.count();
  expect(n).toBeGreaterThan(0);
  await expect
    .poll(async () =>
      shots.evaluateAll((imgs) =>
        imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);

  // The interaction model is spelled out (the thing players ask first).
  await expect(page.locator("#howto-move")).toContainText(/tap a source, then tap a destination/i);
});

test("the in-game 'How to play' link reaches the guide", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await expect(page.locator(".sol-board")).toBeVisible();
  await page.getByRole("link", { name: /how to play/i }).click();
  await expect(page).toHaveURL(/\/how-to\/\?game=solitaire/);
  await expect(page.locator("h1")).toContainText(/how to play solitaire/i);
});

test("an unknown game shows a graceful message, not a blank page", async ({ page }) => {
  await page.goto("/how-to/?game=nope");
  await expect(page.locator(".welcome")).toContainText(/no how-to-play guide/i);
});

test("the how-to page has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/how-to/?game=solitaire");
  await expect(page.locator("h1")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a game with a subtitle shows its whole name, and one without shows no empty slot", async ({
  page,
}) => {
  // Trio Tumble's tile and drawer entry stay "Trio Tumble" (11 chars, inside the
  // width the shelf has actually rendered). This page has room, so it is where
  // the full name appears — in the tab title and as an eyebrow above the guide.
  await page.goto("/how-to/?game=trio-tumble");
  await expect(page.locator(".how-to-fullname")).toHaveText("Trio Tumble: Jewel Drop");
  await expect(page).toHaveTitle(/Trio Tumble: Jewel Drop/);

  // Solitaire has no subtitle: the element must be absent, not present-and-blank.
  await page.goto("/how-to/?game=solitaire");
  await expect(page.locator(".how-to-fullname")).toHaveCount(0);
  await expect(page).toHaveTitle(/Solitaire/);
});
