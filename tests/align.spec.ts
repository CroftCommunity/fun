//! Align wiring test: the board canvas + touch pad + HUD render and play over
//! the binding; a shift moves the active piece and the core decides legality (a
//! shift into the wall is a no-op); a full run tops out to a verifiable result
//! whose `?r=` share round-trips; hints-off "End run" ends. Axe + narrow-phone
//! fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".al-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__align));
}

const activeMinX = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const a = window.__align!.board().active!;
    return Math.min(...a.cells.map((c) => c[0]));
  });

test("the board, touch pad, and HUD render with an active piece", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await expect(page.locator(".al-board")).toBeVisible();
  await expect(page.locator(".al-touch")).toBeVisible();
  // Score, level and lines are the frame's meters; the side panels keep Hold and Next.
  await expect(page.locator('.gf-stat[data-meter="score"]')).toContainText(/score/i);
  await expect(page.locator('.gf-stat[data-meter="level"]')).toContainText(/level/i);
  await expect(page.locator('.gf-stat[data-meter="lines"]')).toContainText(/lines/i);
  await expect(page.locator(".al-hud, .sol-controls, .sol-settings")).toHaveCount(0);
  await expect(page.locator(".gf-mode")).toHaveText(/marathon/i);
  const hasActive = await page.evaluate(() => window.__align!.board().active !== null);
  expect(hasActive).toBe(true);
});

test("the touch pad is the three-row layout: move · rotate · drop+hold", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Row 1: two wide movement buttons (left, right).
  await expect(page.locator(".al-touch-move button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /move left/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /move right/i })).toBeVisible();
  // Row 2: both rotate directions, one under each arrow.
  await expect(page.locator(".al-touch-rot button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /rotate counter-clockwise/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /rotate clockwise/i })).toBeVisible();
  // Row 3: soft drop, hard drop, hold.
  await expect(page.locator(".al-touch-drop button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /soft drop/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /hard drop/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^hold/i })).toBeVisible();
});

test("tapping the on-screen move buttons shifts the piece through the core", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const before = await activeMinX(page);
  await page.getByRole("button", { name: /move right/i }).click();
  expect(await activeMinX(page)).toBe(before + 1);
  await page.getByRole("button", { name: /move left/i }).click();
  expect(await activeMinX(page)).toBe(before);
});

test("tapping the on-screen hard-drop button locks the piece through the core", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const locked = (): Promise<number> =>
    page.evaluate(() => window.__align!.board().rows.flat().filter((v) => v > 0).length);
  const before = await locked();
  await page.getByRole("button", { name: /hard drop/i }).click();
  expect(await locked()).toBeGreaterThan(before);
});

// Record vibration calls in every page (survives reloads) so haptics can be
// asserted without a real motor.
async function stubVibrate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __vibes: unknown[] }).__vibes = [];
    try {
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value: (arg: unknown) => {
          (window as unknown as { __vibes: unknown[] }).__vibes.push(arg);
          return true;
        },
      });
    } catch {
      /* leave the real API in place */
    }
  });
}
const vibeCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __vibes: unknown[] }).__vibes.length);

test("haptics are on by default — a move tap buzzes", async ({ page }) => {
  await stubVibrate(page);
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.getByRole("button", { name: /move left/i }).click();
  expect(await vibeCount(page)).toBeGreaterThan(0);
});

test("turning haptics off stops the buzz", async ({ page }) => {
  await stubVibrate(page);
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="haptics"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as unknown as { __vibes: unknown[] }).__vibes.length = 0;
  });
  await page.getByRole("button", { name: /move right/i }).click();
  expect(await vibeCount(page)).toBe(0);
});

test("the left/right speed slider persists across a reload", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="speed"] .sheet-range').fill("1");
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="speed"] .sheet-range')).toHaveValue("1");
});

test("the speed setting drives the hold-repeat interval (slow is a longer gap than fast)", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const speed = page.locator('.gf-sheet [data-setting="speed"] .sheet-range');
  await speed.fill("1"); // slowest
  const slow = await page.evaluate(() => window.__align!.moveRepeatMs());
  await speed.fill("10"); // fastest
  const fast = await page.evaluate(() => window.__align!.moveRepeatMs());
  expect(slow).toBe(250);
  expect(fast).toBe(50);
});

test("holding a move button auto-repeats after the initial delay", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Shove to the right wall, then hold Left long enough for several repeats.
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.__align!.input("ShiftR");
  });
  const before = await activeMinX(page);
  const left = page.getByRole("button", { name: /move left/i });
  await left.dispatchEvent("pointerdown");
  await page.waitForTimeout(650);
  await left.dispatchEvent("pointerup");
  // The initial press is one cell; the repeat must add at least one more.
  expect(await activeMinX(page)).toBeLessThanOrEqual(before - 2);
});

test("a shift moves the active piece one cell (the core decides)", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const before = await activeMinX(page);
  await page.evaluate(() => window.__align!.input("ShiftR"));
  const after = await activeMinX(page);
  expect(after).toBe(before + 1);
});

test("the core rejects an illegal shift into the wall (guardrail: no partial move)", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Shove the piece to the right wall, then one more shift must change nothing.
  // (Compare the piece's x, not the hash — live gravity advances y meanwhile.)
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.__align!.input("ShiftR");
  });
  const before = await activeMinX(page);
  await page.evaluate(() => window.__align!.input("ShiftR"));
  const after = await activeMinX(page);
  expect(after).toBe(before); // the wall is a no-op — no partial slide
});

test("rotation and hard drop change the board through the core", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  const h0 = await page.evaluate(() => window.__align!.game.currentHash());
  await page.evaluate(() => window.__align!.input("RotCW"));
  const h1 = await page.evaluate(() => window.__align!.game.currentHash());
  // A hard drop locks the piece and spawns the next — the stack height grows.
  const linesBefore = await page.evaluate(() => window.__align!.board().rows.flat().filter((v) => v > 0).length);
  await page.evaluate(() => window.__align!.input("HardDrop"));
  const linesAfter = await page.evaluate(() => window.__align!.board().rows.flat().filter((v) => v > 0).length);
  expect(h1).not.toBe(h0); // rotation changed state (seed 7's first piece rotates)
  expect(linesAfter).toBeGreaterThan(linesBefore); // four locked cells added
});

test("a full run tops out to a verifiable result; the share round-trips", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  // Hard-drop pieces in place until the stack tops out (a real game-over path).
  await page.evaluate(() => {
    const h = window.__align!;
    for (let i = 0; i < 400 && !h.board().over; i++) {
      h.input("HardDrop");
      h.tick(1);
    }
  });
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("with hints off, 'End run' ends the round with a verifiable result", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="hints"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.locator('.gf-verb[data-verb="hint"]')).toHaveCount(0);
  await page.locator('.gf-verb[data-verb="done"]').click();
  await expect(page.locator(".sol-result")).toBeVisible();
  await expect(page.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("the New game card picks Marathon or Sprint, and the chip says which", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet.locator('[data-setting="mode"] .sheet-choice-opt')).toHaveText(["Marathon (daily)", "New Marathon", "Sprint 40"]);
  await sheet.locator('[data-setting="mode"] input[value="sprint"]').check();
  await sheet.locator(".gf-sheet-start").click();
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/sprint/i);
  await expect(page.locator('.gf-stat[data-meter="lines"]')).toContainText(/\/ ?40/);
});

test("a drop does not move the board, and neither does the settings sheet", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/align/?seed=7");
  await ready(page);
  const v = await boardTopStable(page, ".al-board", async () => {
    await page.getByRole("button", { name: /move left/i }).click();
    await page.getByRole("button", { name: /hard drop/i }).click();
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/align/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/align/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
