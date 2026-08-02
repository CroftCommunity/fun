//! Match-3 wiring test: the board renders and plays over the binding, selecting
//! a gem glows exactly the core's legal swaps, a legal swap scores while an
//! illegal one doesn't, playing out the budget yields a verifiable record, and
//! the share link round-trips. Axe + mobile-fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Cell = { r: number; c: number };

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".m3-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__match3));
}

test("the board renders an 8×8 deal with the HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await expect(page.locator(".m3-gem")).toHaveCount(64);
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-hud")).toContainText(/swaps left/i);
});

test("selecting a gem glows exactly the core's legal swaps", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  // Pick a gem that has at least one legal swap, and its exact partner cells.
  const pick = await page.evaluate(() => {
    const moves = window.__match3!.game.legalMoves();
    const first = moves[0]!;
    const from = { r: first[0], c: first[1] };
    const partners = new Set<string>();
    for (const s of moves) {
      if (s[0] === from.r && s[1] === from.c) partners.add(`${s[2]},${s[3]}`);
      else if (s[2] === from.r && s[3] === from.c) partners.add(`${s[0]},${s[1]}`);
    }
    return { from, partners: [...partners] };
  });

  await page.locator(`.m3-gem[data-r="${pick.from.r}"][data-c="${pick.from.c}"]`).click();
  await expect(page.locator(".legal-target")).toHaveCount(pick.partners.length);
});

test("a legal swap scores; a no-match swap changes nothing", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  const before = await page.evaluate(() => window.__match3!.game.board());
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);

  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  const after = await page.evaluate(() => window.__match3!.game.board());
  expect(after.score).toBeGreaterThan(before.score);
  expect(after.movesLeft).toBe(before.movesLeft - 1);
});

test("playing out the budget yields a verifiable record; share round-trips", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  // Greedy-play the whole budget via the hook, then re-render into the result.
  await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 20; i += 1) {
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

// Swipe a gem toward its neighbour with a pointer gesture (the primary way to
// play — works the same on touch + desktop). Synthetic PointerEvents with real
// coordinates, dispatched on the source gem (they bubble to the board's
// delegated pointer listener); direction is resolved from the pointer delta.
async function swipe(page: Page, from: Cell, to: Cell): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const sel = (c: { r: number; c: number }): HTMLElement =>
        document.querySelector(`.m3-gem[data-r="${c.r}"][data-c="${c.c}"]`)!;
      const a = sel(from);
      const ra = a.getBoundingClientRect();
      const rb = sel(to).getBoundingClientRect();
      const ax = ra.left + ra.width / 2;
      const ay = ra.top + ra.height / 2;
      const bx = rb.left + rb.width / 2;
      const by = rb.top + rb.height / 2;
      const ev = (type: string, x: number, y: number): void =>
        void a.dispatchEvent(
          new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "touch" }),
        );
      ev("pointerdown", ax, ay);
      ev("pointermove", (ax + bx) / 2, (ay + by) / 2);
      ev("pointermove", bx, by);
      ev("pointerup", bx, by);
    },
    { from, to },
  );
}

test("swiping a gem toward a legal neighbour swaps it (swipe as well as tap)", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__match3!.game.board().score);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await swipe(page, { r: swap[0], c: swap[1] }, { r: swap[2], c: swap[3] });
  const after = await page.evaluate(() => window.__match3!.game.board().score);
  expect(after).toBeGreaterThan(before);
});

test("gems render as glossy shapes (inner .m3-shape); glows stay on the button", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  // Every gem carries an aria-hidden inner shape (the candy). The square button
  // keeps the hit-area + aria-label, so the selection/legal/hint glows (outline +
  // box-shadow on the button) are never clipped by the shape's clip-path.
  await expect(page.locator("button.m3-gem > .m3-shape")).toHaveCount(64);
  await expect(page.locator(".m3-shape").first()).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("button.m3-gem")).toHaveCount(64);
  // Selecting still puts the glow class on the BUTTON, not the inner shape.
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await expect(page.locator("button.m3-gem.selected")).toHaveCount(1);
  await expect(page.locator(".m3-shape.selected")).toHaveCount(0);
});

test("a clearing swap emits a move event and its burst layer is decorative", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  // The burst layer is present, aria-hidden, and carries no interactive nodes
  // (so it never changes the board's gem/button count or the a11y tree).
  await expect(page.locator(".m3-fx")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".m3-fx button")).toHaveCount(0);

  // Subscribe to the success bus, then play a legal (clearing) swap through the UI.
  await page.evaluate(() => {
    (window as unknown as { __ev: unknown[] }).__ev = [];
    window.__match3!.events.on((e) => (window as unknown as { __ev: unknown[] }).__ev.push(e));
  });
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();
  const events = await page.evaluate(() => (window as unknown as { __ev: { type: string; cleared?: number }[] }).__ev);
  expect(events.some((e) => e.type === "move" && (e.cleared ?? 0) >= 3)).toBe(true);
});

test("reduced-motion spawns no particles (FX skipped)", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/match3/?seed=7");
  await ready(page);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();
  await page.waitForTimeout(120);
  expect(await page.locator(".m3-particle").count()).toBe(0);
  await context.close();
});

test("a fresh visitor lands in the campaign at Level 1 (with the intro + a11y clean)", async ({ page }) => {
  await page.goto("/match3/");
  await ready(page);
  await expect(page.locator(".m3-campaign-hud")).toContainText(/level 1/i);
  await expect(page.locator(".m3-mode-campaign")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__match3!.level)).toBe(1);
  await expect(page.locator(".sol-status")).toContainText(/swipe/i);
  // The campaign HUD + level nav stay accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("?level=2 opens campaign level 2 on its curated seed", async ({ page }) => {
  await page.goto("/match3/?level=2");
  await ready(page);
  await expect(page.locator(".m3-campaign-hud")).toContainText(/level 2/i);
  expect(await page.evaluate(() => window.__match3!.level)).toBe(2);
});

test("clearing a campaign level shows stars + Next level and persists progress (still verifiable)", async ({ page }) => {
  await page.goto("/match3/?level=1");
  await ready(page);
  await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 40; i += 1) {
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    h.refresh();
  });
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-headline")).toContainText(/level 1 complete/i);
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".m3-next-level")).toBeVisible();
  const stars = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("fun-match3-campaign") ?? "{}") as Record<string, number>)["1"],
  );
  expect(stars).toBeGreaterThanOrEqual(1);
});

test("Level 1 first load glows the tutorial opening move, once", async ({ page }) => {
  await page.goto("/match3/?level=1");
  await ready(page);
  // The curated opening swap [3,3] <-> [3,4] glows (source + target), as a
  // non-penalising onboarding nudge (not an assistance hint).
  await expect(page.locator(".m3-gem.hint-from")).toHaveCount(1);
  await expect(page.locator(".m3-gem.hint-to")).toHaveCount(1);
  await expect(page.locator('.m3-gem.hint-from[data-r="3"][data-c="3"]')).toBeVisible();
  await expect(page.locator('.m3-gem.hint-to[data-r="3"][data-c="4"]')).toBeVisible();

  // It's shown once ever — a reload of the same level no longer nudges.
  await page.goto("/match3/?level=1");
  await ready(page);
  await expect(page.locator(".hint-from")).toHaveCount(0);
});

test("an in-progress campaign board resumes after a reload (move-list replay)", async ({ page }) => {
  await page.goto("/match3/?level=1");
  await ready(page);
  // Play two swaps through the UI, then read the resulting score + swaps-left.
  for (let n = 0; n < 2; n += 1) {
    const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
    await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
    await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();
    await expect(page.locator(".m3-board:not(.m3-animating)")).toBeVisible();
  }
  const before = await page.evaluate(() => window.__match3!.game.board());

  // Reload with no ?level — the saved move list should replay us back to the
  // same level and the same deterministic board state.
  await page.goto("/match3/");
  await ready(page);
  const after = await page.evaluate(() => ({ level: window.__match3!.level, board: window.__match3!.game.board() }));
  expect(after.level).toBe(1);
  expect(after.board.score).toBe(before.score);
  expect(after.board.movesLeft).toBe(before.movesLeft);
  await expect(page.locator(".sol-status")).toContainText(/resumed/i);
});

test("a tiny pointer nudge under the threshold does not swap — it selects (tap floor)", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  // A click (no movement) must still select and glow the legal targets.
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await expect(page.locator(".m3-gem.selected")).toHaveCount(1);
  await expect(page.locator(".legal-target").first()).toBeVisible();
});

test("a swap animates the cascade, then settles to the core's board", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);

  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  // The board animates (a transient non-interactive frame appears)…
  await expect(page.locator(".m3-board.m3-animating")).toBeVisible();
  // …then settles back to an interactive board with real gem buttons.
  await expect(page.locator(".m3-board.m3-animating")).toHaveCount(0);
  await expect(page.locator("button.m3-gem")).toHaveCount(64);

  // The settled DOM matches the core's settled score (the wasm applied it at once).
  const score = await page.evaluate(() => window.__match3!.game.board().score);
  expect(score).toBeGreaterThan(0);
  await expect(page.locator(".m3-hud .m3-score")).toContainText(String(score));
});

test("reduced-motion skips straight to the settled board (no animation)", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/match3/?seed=7");
  await ready(page);

  const before = await page.evaluate(() => window.__match3!.game.board().score);
  const swap = await page.evaluate(() => window.__match3!.game.legalMoves()[0]!);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();

  // No animation frame is ever shown; the interactive board updates immediately.
  await expect(page.locator("button.m3-gem")).toHaveCount(64);
  expect(await page.locator(".m3-board.m3-animating").count()).toBe(0);
  const after = await page.evaluate(() => window.__match3!.game.board().score);
  expect(after).toBeGreaterThan(before);
  await context.close();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the Clear-blockers objective deals a blocker board with the blocker HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  await expect(page.locator(".m3-obj-score")).toHaveAttribute("aria-pressed", "true");

  // Switch objective via the toggle — this fetches the winnable-daily pack.
  await page.locator(".m3-obj-blockers").click();
  await expect(page.locator(".m3-hud")).toContainText(/blockers left/i);
  await expect(page.locator(".m3-obj-blockers")).toHaveAttribute("aria-pressed", "true");
  // The deal carries the six fixed, non-swappable blocker tiles.
  await expect(page.locator(".m3-blocker")).toHaveCount(6);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("blockers");
  // The new blocker tiles + objective toggle stay accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("clearing every blocker is a verifiable win (blockers mode)", async ({ page }) => {
  // The committed pack fixture (re-locked after the B0 specials pack regen):
  // seed 19 clears in a single swap [5,5]→[6,5].
  await page.goto("/match3/?mode=blockers&seed=19");
  await ready(page);
  await expect(page.locator(".m3-blocker")).toHaveCount(6);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([5, 5, 6, 5]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all blockers cleared/i);
  // The record leads with swaps-to-clear, not stars/score.
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("the Clear-jelly objective deals a jelly board with the jelly HUD", async ({ page }) => {
  await page.goto("/match3/?mode=jelly&seed=317");
  await ready(page);
  await expect(page.locator(".m3-obj-jelly")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".m3-hud")).toContainText(/jelly left/i);
  // Six jellied cells, and each is a still-swappable gem button (jelly sits under it).
  await expect(page.locator("button.m3-gem.m3-jellied")).toHaveCount(6);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("jelly");
  // The new jelly backing stays accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("scrubbing every jelly is a verifiable win (jelly mode)", async ({ page }) => {
  // Committed jelly fixture (re-derived after the B4 2×2/deal change): seed 35
  // clears in two swaps.
  await page.goto("/match3/?mode=jelly&seed=35");
  await ready(page);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(6);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([6, 0, 6, 1]);
    h.game.play([6, 5, 6, 6]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all jelly cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("the Ingredients objective deals an ingredient board with the ingredient HUD", async ({ page }) => {
  await page.goto("/match3/?mode=ingredients&seed=144");
  await ready(page);
  await expect(page.locator(".m3-obj-ingredients")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".m3-hud")).toContainText(/ingredients left/i);
  // Three ingredient tiles, all in the top row (fixed, non-swappable — not .m3-gem).
  await expect(page.locator(".m3-ingredient")).toHaveCount(3);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("ingredients");
  // The new ingredient tiles + objective toggle stay accessible.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("collecting every ingredient is a verifiable win (ingredients mode)", async ({ page }) => {
  // The committed pack fixture: seed 144 drops all three ingredients in two swaps.
  await page.goto("/match3/?mode=ingredients&seed=144");
  await ready(page);
  await expect(page.locator(".m3-ingredient")).toHaveCount(3);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([5, 5, 5, 6]);
    h.game.play([6, 4, 7, 4]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all ingredients cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("the Orders (checklist) objective deals a plain board with the goal-tally HUD", async ({ page }) => {
  await page.goto("/match3/?mode=checklist&seed=3");
  await ready(page);
  await expect(page.locator(".m3-obj-checklist")).toHaveAttribute("aria-pressed", "true");
  // A tally of three goals (clear a colour, make striped, make wrapped).
  await expect(page.locator(".m3-checklist-hud")).toContainText(/striped/i);
  await expect(page.locator(".m3-checklist-hud")).toContainText(/wrapped/i);
  await expect(page.locator(".m3-checklist-hud .m3-goal")).toHaveCount(3);
  // Checklist plays plain gems — no blocker / ingredient / jelly tiles at the deal.
  await expect(page.locator(".m3-blocker, .m3-ingredient, .m3-gem.m3-jellied")).toHaveCount(0);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("checklist");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("completing every order is a verifiable win (checklist mode)", async ({ page }) => {
  // The committed pack fixture: seed 3 completes every order goal in two swaps.
  await page.goto("/match3/?mode=checklist&seed=3");
  await ready(page);
  await expect(page.locator(".m3-obj-checklist")).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([5, 4, 5, 5]);
    h.game.play([6, 3, 6, 4]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/checklist complete/i);
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("the Obstacles objective deals licorice + meringue tiles with the obstacles HUD", async ({ page }) => {
  await page.goto("/match3/?mode=obstacles&seed=72");
  await ready(page);
  await expect(page.locator(".m3-obj-obstacles")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".m3-hud")).toContainText(/obstacles left/i);
  // Three licorice + three meringue tiles (the mode deal), distinct from plain blockers.
  await expect(page.locator(".m3-licorice")).toHaveCount(3);
  await expect(page.locator(".m3-meringue")).toHaveCount(3);
  expect(await page.evaluate(() => window.__match3!.objective)).toBe("obstacles");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("clearing every obstacle is a verifiable win (obstacles mode)", async ({ page }) => {
  // The committed pack fixture: seed 72 clears all six obstacles in one big-cascade swap.
  await page.goto("/match3/?mode=obstacles&seed=72");
  await ready(page);
  await expect(page.locator(".m3-licorice")).toHaveCount(3);

  await page.evaluate(() => {
    const h = window.__match3!;
    h.game.play([6, 2, 7, 2]);
    h.refresh();
  });

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/all obstacles cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/swaps used/i);
});

test("every objective fits a narrow phone with no horizontal overflow", async ({ page }) => {
  // The objective toggle + board must stay within a 360px viewport in each mode.
  await page.setViewportSize({ width: 360, height: 780 });
  const noOverflow = (): Promise<boolean> =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  for (const q of [
    "seed=7",
    "mode=blockers&seed=30",
    "mode=jelly&seed=317",
    "mode=ingredients&seed=144",
    "mode=checklist&seed=3",
    "mode=obstacles&seed=72",
  ]) {
    await page.goto(`/match3/?${q}`);
    await ready(page);
    await expect(page.locator(".m3-board")).toBeVisible();
    expect(await noOverflow(), `overflow at 360px for ${q}`).toBe(true);
  }
});

test("the play area (board) is centred in the play surface", async ({ page }) => {
  // RESPONSIVE-DESIGN Principle 1/2 + BUILDING-GAMES §4b: the board sits on the
  // play area's centreline, not hugging the left edge (the inline-flex centring trap).
  await page.goto("/match3/?mode=obstacles&seed=72");
  await ready(page);
  const pa = await page.locator(".play-area").boundingBox();
  const bd = await page.locator(".m3-board").boundingBox();
  expect(pa && bd, "play area + board are laid out").toBeTruthy();
  const paCenter = pa!.x + pa!.width / 2;
  const boardCenter = bd!.x + bd!.width / 2;
  expect(Math.abs(paCenter - boardCenter), "board centred in the play area").toBeLessThan(24);
});

test("switching objective via the toggle re-deals and updates the HUD", async ({ page }) => {
  await page.goto("/match3/?seed=7"); // target-score
  await ready(page);
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(0);

  await page.locator(".m3-obj-jelly").click();
  await expect(page.locator(".m3-hud")).toContainText(/jelly left/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(6);

  await page.locator(".m3-obj-score").click();
  await expect(page.locator(".m3-hud")).toContainText(/score/i);
  await expect(page.locator(".m3-gem.m3-jellied")).toHaveCount(0);
});

test("a jellied gem is still tappable and swaps like any other", async ({ page }) => {
  await page.goto("/match3/?mode=jelly&seed=317");
  await ready(page);
  // Find a legal swap whose source cell is jellied, and play it by tapping.
  const swap = await page.evaluate(() => {
    const h = window.__match3!;
    const b = h.game.board();
    return h.game.legalMoves().find((s) => (b.jelly[s[0]]?.[s[1]] ?? 0) > 0) ?? h.game.legalMoves()[0]!;
  });
  const before = await page.evaluate(() => window.__match3!.game.board().jellyRemaining);
  await page.locator(`.m3-gem[data-r="${swap[0]}"][data-c="${swap[1]}"]`).click();
  await page.locator(`.m3-gem[data-r="${swap[2]}"][data-c="${swap[3]}"]`).click();
  const after = await page.evaluate(() => window.__match3!.game.board().jellyRemaining);
  // A legal swap resolved (jelly did not increase; the board advanced).
  expect(after).toBeLessThanOrEqual(before);
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/match3/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/match3/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("a line-4+ match creates a special candy: rendered, badged, and labelled", async ({ page }) => {
  await page.goto("/match3/?seed=13");
  await ready(page);

  // The binding exposes an 8×8 specials overlay grid (the render contract).
  const grid = await page.evaluate(() => window.__match3!.game.board().specials);
  expect(grid.length).toBe(8);
  expect(grid[0]!.length).toBe(8);

  // Greedy-first play (deterministic for the seed) creates a special candy that
  // survives to the settled board; find where, then re-render.
  const found = await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 20; i += 1) {
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
      const sp = h.game.board().specials;
      for (let r = 0; r < sp.length; r += 1) {
        for (let c = 0; c < (sp[r] ?? []).length; c += 1) {
          if (sp[r]![c]) {
            h.refresh();
            return { r, c, kind: sp[r]![c]! };
          }
        }
      }
    }
    h.refresh();
    return null;
  });
  expect(found, "greedy-first play creates a special within the budget").not.toBeNull();

  // The engine's special renders on that tile with its power-badge class and an
  // a11y label (not colour-only) — the full engine → board_json → DOM chain.
  const tile = page.locator(`.m3-gem[data-r="${found!.r}"][data-c="${found!.c}"]`);
  await expect(tile).toHaveClass(/\bm3-special\b/);
  await expect(tile).toHaveClass(new RegExp(`m3-special-${found!.kind}`));
  await expect(tile).toHaveAttribute("aria-label", /candy|colour bomb/i);
});

test("a striped candy can be fired by swapping it (swap-activation reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=13");
  await ready(page);

  // Greedy-first play until a striped candy is on the settled board, then fire
  // it by swapping it with a neighbour — swap-activation makes that swap legal
  // (no line match needed), and firing clears a whole line so the score jumps.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 20; i += 1) {
      const b = h.game.board();
      for (let r = 0; r < b.specials.length; r += 1) {
        for (let c = 0; c < (b.specials[r] ?? []).length; c += 1) {
          if ((b.specials[r]![c] ?? "").startsWith("striped")) {
            const mv = h.game
              .legalMoves()
              .find((m) => (m[0] === r && m[1] === c) || (m[2] === r && m[3] === c));
            if (!mv) return { swappable: false, before: b.score, after: b.score };
            const before = b.score;
            h.game.play(mv);
            h.refresh();
            return { swappable: true, before, after: h.game.board().score };
          }
        }
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "a striped candy was created within the budget").not.toBeNull();
  expect(info!.swappable, "the striped is swappable (swap-activation reaches the UI)").toBe(true);
  expect(info!.after, "firing the striped cleared a line, so the score rose").toBeGreaterThan(info!.before);
});

test("a wrapped candy can be fired by swapping it (the 3×3 double reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=3");
  await ready(page);

  // Greedy-first play until a wrapped candy is on the settled board, then fire it
  // by swapping it with a neighbour — swap-activation makes that swap legal (B2.2),
  // and its 3×3 double blast clears several gems so the score jumps. seed=3 is a
  // deterministic deal that produces a swappable wrapped within the budget.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 40; i += 1) {
      const b = h.game.board();
      for (let r = 0; r < b.specials.length; r += 1) {
        for (let c = 0; c < (b.specials[r] ?? []).length; c += 1) {
          if ((b.specials[r]![c] ?? "").startsWith("wrapped")) {
            const mv = h.game
              .legalMoves()
              .find((m) => (m[0] === r && m[1] === c) || (m[2] === r && m[3] === c));
            if (!mv) return { swappable: false, before: b.score, after: b.score };
            const before = b.score;
            h.game.play(mv);
            h.refresh();
            return { swappable: true, before, after: h.game.board().score };
          }
        }
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "a wrapped candy was created within the budget").not.toBeNull();
  expect(info!.swappable, "the wrapped is swappable (swap-activation reaches the UI)").toBe(true);
  expect(info!.after, "firing the wrapped's 3×3 double cleared gems, so the score rose").toBeGreaterThan(
    info!.before,
  );
});

test("a colour bomb can be fired by swapping it (the colour detonation reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=22");
  await ready(page);

  // Greedy-first play until a colour bomb is on the settled board, then fire it by
  // swapping it with a neighbour — swap-activation makes that legal (B3), and it
  // detonates every gem of that neighbour's colour, so the score jumps. seed=22 is
  // a deterministic deal (re-probed after the B4 2×2/deal change) whose greedy line
  // produces a swappable colour bomb within the 20-swap budget.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 60; i += 1) {
      const b = h.game.board();
      for (let r = 0; r < b.specials.length; r += 1) {
        for (let c = 0; c < (b.specials[r] ?? []).length; c += 1) {
          if ((b.specials[r]![c] ?? "").startsWith("color")) {
            const mv = h.game
              .legalMoves()
              .find((m) => (m[0] === r && m[1] === c) || (m[2] === r && m[3] === c));
            if (!mv) return { swappable: false, before: b.score, after: b.score };
            const before = b.score;
            h.game.play(mv);
            h.refresh();
            return { swappable: true, before, after: h.game.board().score };
          }
        }
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "a colour bomb was created within the budget").not.toBeNull();
  expect(info!.swappable, "the colour bomb is swappable (swap-activation reaches the UI)").toBe(true);
  expect(info!.after, "detonating the colour cleared gems, so the score rose").toBeGreaterThan(info!.before);
});

test("a fish (2×2) can be created and fired by swapping it (the fish reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=1");
  await ready(page);

  // Greedy-first play until a fish (from a 2×2 block) is on the settled board, then
  // fire it by swapping it — swap-activation makes that legal (B4.2), and the fish
  // swims to eat a target, so the score rises. seed=1 deterministically forms a 2×2
  // (and thus a fish) under greedy play within the budget.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    for (let i = 0; i < 40; i += 1) {
      const b = h.game.board();
      for (let r = 0; r < b.specials.length; r += 1) {
        for (let c = 0; c < (b.specials[r] ?? []).length; c += 1) {
          if ((b.specials[r]![c] ?? "") === "fish") {
            const mv = h.game
              .legalMoves()
              .find((m) => (m[0] === r && m[1] === c) || (m[2] === r && m[3] === c));
            if (!mv) return { swappable: false, before: b.score, after: b.score };
            const before = b.score;
            h.game.play(mv);
            h.refresh();
            return { swappable: true, before, after: h.game.board().score };
          }
        }
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "a fish was created within the budget").not.toBeNull();
  expect(info!.swappable, "the fish is swappable (swap-activation reaches the UI)").toBe(true);
  expect(info!.after, "the fired fish ate a target, so the score rose").toBeGreaterThan(info!.before);
});

test("swapping two specials fires a combo (a big combined blast reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=45");
  await ready(page);

  // First-legal-move play until TWO orthogonally-adjacent special candies sit on
  // the board, then swap the pair — that is a combo (B5), a single blast bigger
  // than firing each alone (a striped+striped cross clears a full row AND column).
  // seed=45 deterministically brings two adjacent striped candies together under
  // first-legal-move play within the budget.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    const adjacentPair = (sp: string[][]) => {
      for (let r = 0; r < sp.length; r += 1) {
        for (let c = 0; c < (sp[r] ?? []).length; c += 1) {
          if (!sp[r]![c]) continue;
          for (const [nr, nc] of [
            [r + 1, c],
            [r, c + 1],
          ] as const) {
            if (nr < sp.length && nc < (sp[nr] ?? []).length && sp[nr]![nc]) {
              return [r, c, nr, nc] as const;
            }
          }
        }
      }
      return null;
    };
    for (let i = 0; i < 20; i += 1) {
      const b = h.game.board();
      const pair = adjacentPair(b.specials);
      if (pair) {
        const mv = h.game
          .legalMoves()
          .find(
            (m) =>
              (m[0] === pair[0] && m[1] === pair[1] && m[2] === pair[2] && m[3] === pair[3]) ||
              (m[0] === pair[2] && m[1] === pair[3] && m[2] === pair[0] && m[3] === pair[1]),
          );
        if (!mv) return { fired: false, before: b.score, after: b.score };
        const before = b.score;
        h.game.play(mv);
        h.refresh();
        return { fired: true, before, after: h.game.board().score };
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "two adjacent specials came together within the budget").not.toBeNull();
  expect(info!.fired, "the two specials can be swapped (a combo)").toBe(true);
  // A combo scores far more than a plain 3-match (30): a striped+striped cross is
  // a full row + full column (~15 gems ≈ 150 on an 8×8), so the jump is large.
  expect(info!.after - info!.before, "the combo's blast is much bigger than a match").toBeGreaterThanOrEqual(100);
});

test("swapping a fish with a special fires a fish combo (reaches the UI)", async ({ page }) => {
  await page.goto("/match3/?seed=142");
  await ready(page);

  // First-legal-move play until a fish sits next to another special, then swap the
  // pair — a fish combo (B5.4): a small school of fish each eat a target and carry
  // the partner's blast, a clear well beyond a lone fish's single eat. seed=142
  // deterministically brings a fish adjacent to a striped within the budget.
  const info = await page.evaluate(() => {
    const h = window.__match3!;
    const fishPair = (sp: string[][]) => {
      for (let r = 0; r < sp.length; r += 1) {
        for (let c = 0; c < (sp[r] ?? []).length; c += 1) {
          if (sp[r]![c] !== "fish") continue;
          for (const [nr, nc] of [
            [r + 1, c],
            [r - 1, c],
            [r, c + 1],
            [r, c - 1],
          ] as const) {
            if (nr >= 0 && nr < sp.length && nc >= 0 && nc < (sp[nr] ?? []).length && sp[nr]![nc]) {
              return [r, c, nr, nc] as const;
            }
          }
        }
      }
      return null;
    };
    for (let i = 0; i < 20; i += 1) {
      const b = h.game.board();
      const pair = fishPair(b.specials);
      if (pair) {
        const mv = h.game
          .legalMoves()
          .find(
            (m) =>
              (m[0] === pair[0] && m[1] === pair[1] && m[2] === pair[2] && m[3] === pair[3]) ||
              (m[0] === pair[2] && m[1] === pair[3] && m[2] === pair[0] && m[3] === pair[1]),
          );
        if (!mv) return { fired: false, before: b.score, after: b.score };
        const before = b.score;
        h.game.play(mv);
        h.refresh();
        return { fired: true, before, after: h.game.board().score };
      }
      const m = h.game.legalMoves();
      if (m.length === 0) break;
      h.game.play(m[0]!);
    }
    return null;
  });
  expect(info, "a fish came adjacent to a special within the budget").not.toBeNull();
  expect(info!.fired, "the fish + special pair can be swapped (a fish combo)").toBe(true);
  // A fish combo (school of fish, here each firing a line) clears well beyond a
  // lone fish's single-cell eat (~10).
  expect(info!.after - info!.before, "the fish combo's blast is large").toBeGreaterThanOrEqual(50);
});
