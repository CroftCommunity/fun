//! Bubble-shooter aim-and-shoot wiring test: the canvas board + launcher + aim
//! control render; aiming then firing spends a shot and lands **exactly where
//! the core resolves it** (the guardrail — the UI never invents physics); the
//! committed winnable fixture clears to a verifiable record and the share link
//! round-trips; keyboard aim/fire works; reduced-motion fires instantly. Axe +
//! narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bub-canvas")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__bubble));
}

const shotsLeft = (page: Page): Promise<number> =>
  page.evaluate(() => window.__bubble!.game.board().shotsLeft);

test("the board renders a canvas, a launcher chip, an aim control and the HUD", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await expect(page.locator(".bub-canvas")).toHaveAttribute("aria-label", /bubbles left/i);
  await expect(page.locator(".bub-loaded")).toBeVisible();
  await expect(page.locator(".bub-aim")).toBeVisible();
  await expect(page.locator(".bub-fire")).toBeVisible();
  // Score and shots are the frame's meters; the game's own control bar and
  // disclosures are gone. The launcher chip stays in the HUD beside the board.
  await expect(page.locator('.gf-stat[data-meter="score"]')).toContainText(/score/i);
  await expect(page.locator('.gf-stat[data-meter="stage"]')).toContainText(/shots left/i);
  await expect(page.locator(".sol-controls, .bub-variants, .sol-settings, .bub-aim-settings")).toHaveCount(0);
});

test("levels: the level, score and clock are meters; the clock is a fixed slot that reads — until the timer is on", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const clock = page.locator('.gf-stat[data-meter="clock"]');
  await expect(page.locator('.gf-stat[data-meter="stage"]')).toContainText(/level 1/i);
  await expect(page.locator('.gf-stat[data-meter="score"]')).toContainText(/score/i);
  await expect(clock).toContainText("—");
  // Progress toward the next level and the drop countdown stay with the board.
  await expect(page.locator(".bub-hud .bub-progress")).toBeVisible();
  await expect(page.locator(".bub-hud .bub-drop")).toContainText(/drops in/i);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="timer"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
  await expect(clock).toContainText(/\d:\d\d/);
});

test("the New game card chooses the variant and the board source", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/classic/i);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet.locator('[data-setting="variant"] .sheet-choice-opt')).toHaveText(["Levels", "Classic"]);
  await expect(sheet.locator('[data-setting="board"] .sheet-choice-opt')).toHaveText(["Daily challenge", "New board"]);
  await sheet.locator('[data-setting="variant"] input[value="levels"]').check();
  await sheet.locator(".gf-start").click();
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/levels/i);
  await expect(page.locator('.gf-stat[data-meter="stage"]')).toContainText(/level 1/i);
});

test("firing does not move the board, and neither does toggling the timer", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" }); // instant flight: the claim is about layout, not the animation
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__bubble!.game.levelBoard().shotsToInsert);
  const v = await boardTopStable(page, ".bub-canvas", async () => {
    await page.locator(".bub-fire").click();
    await page.waitForFunction((b) => window.__bubble!.game.levelBoard().shotsToInsert !== b, before);
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await page.locator('.gf-sheet [data-setting="timer"] .sheet-toggle-input').click({ force: true });
    await page.keyboard.press("Escape");
    await expect(page.locator('.gf-stat[data-meter="clock"]')).toContainText(/\d:\d\d/);
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("leaving mid-game and returning to the bare URL resumes the same board", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);
  await page.evaluate(() => window.__bubble!.setAim(90));
  await page.locator(".bub-fire").click();
  await page.waitForFunction((b) => window.__bubble!.game.board().shotsLeft === b - 1, before);
  const board = (): Promise<string> => page.evaluate(() => JSON.stringify(window.__bubble!.game.board()));
  const after = await board();
  await page.goto("/bubble/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toContainText(/classic/i);
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  expect(await board()).toBe(after);
});

test("previews the next colour, and firing promotes it to the launcher", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);

  // The on-deck chip is present and announces the next colour for a screen reader.
  await expect(page.locator(".bub-next")).toHaveAttribute("aria-label", /next up/i);

  // The previewed on-deck colour is exactly the colour the next shot will load:
  // fire once, and the new launcher colour equals the colour that was on deck.
  const onDeck = await page.evaluate(() => window.__bubble!.game.board().nextColor);
  await page.evaluate(async () => {
    const h = window.__bubble!;
    h.setAim(80);
    await h.fire();
  });
  await expect
    .poll(() => page.evaluate(() => window.__bubble!.game.board().currentColor))
    .toBe(onDeck);
});

test("aiming then firing spends a shot and lands where the core resolves it", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);

  // Aim a fixed angle, then fire through the real UI path and wait for the shot
  // to apply. The resulting state hash must equal an independent control replay
  // of the same single angle from the same deal — proving the UI fires exactly
  // the core's resolved shot (no invented physics).
  const control = await page.evaluate((angle) => {
    const h = window.__bubble!;
    h.verifier.newGame(h.seed);
    h.verifier.shoot(angle);
    return h.verifier.currentHash();
  }, 80);

  await page.evaluate(async (angle) => {
    const h = window.__bubble!;
    h.setAim(angle);
    await h.fire();
  }, 80);

  await expect.poll(() => shotsLeft(page)).toBe(before - 1);
  const got = await page.evaluate(() => window.__bubble!.game.currentHash());
  expect(got).toBe(control);
});

test("the aim slider drives the angle and stays within the legal fan", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const { lo, hi } = await page.evaluate(() => ({
    lo: window.__bubble!.geom.fanLo,
    hi: window.__bubble!.geom.fanHi,
  }));
  const slider = page.locator(".bub-aim");
  await expect(slider).toHaveAttribute("min", String(lo));
  await expect(slider).toHaveAttribute("max", String(hi));
  await slider.fill(String(hi));
  expect(await page.evaluate(() => window.__bubble!.aim())).toBe(hi);
});

test("the Fire button spans the full aim-bar width, below the slider", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const bar = await page.locator(".bub-aimbar").boundingBox();
  const slider = await page.locator(".bub-aim").boundingBox();
  const fire = await page.locator(".bub-fire").boundingBox();
  expect(bar && slider && fire).toBeTruthy();
  // Full width: the Fire button is (near) as wide as the aim-bar itself.
  expect(fire!.width).toBeGreaterThanOrEqual(bar!.width * 0.95);
  // Below the slider: the button's top sits under the slider row.
  expect(fire!.y).toBeGreaterThan(slider!.y + slider!.height / 2);
});

test("the live aim readout shows the current angle in degrees", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.evaluate(() => window.__bubble!.setAim(115));
  await expect(page.locator(".bub-aim-readout")).toHaveText(/115/);
});

test("fire-on-release is off by default: releasing the slider does not fire", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);
  await page.locator(".bub-aim").dispatchEvent("pointerdown");
  await page.locator(".bub-aim").dispatchEvent("pointerup");
  // Give any (absent) settle timer time to elapse, then assert no shot spent.
  await page.waitForTimeout(400);
  expect(await shotsLeft(page)).toBe(before);
});

test("fire-on-release, when enabled, fires when the slider is released", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fun-bubble-fire-on-release", "on");
    localStorage.setItem("fun-bubble-aim-settle", "0");
  });
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);
  await page.locator(".bub-aim").dispatchEvent("pointerdown");
  await page.locator(".bub-aim").dispatchEvent("pointerup");
  await expect.poll(() => shotsLeft(page)).toBe(before - 1);
});

test("re-grabbing the slider cancels a pending fire-on-release", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fun-bubble-fire-on-release", "on");
    localStorage.setItem("fun-bubble-aim-settle", "300");
  });
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);
  await page.locator(".bub-aim").dispatchEvent("pointerup"); // starts the 300ms settle
  await page.locator(".bub-aim").dispatchEvent("pointerdown"); // re-grab cancels it
  await page.waitForTimeout(450);
  expect(await shotsLeft(page)).toBe(before);
});

test("the snap step rounds the aim to the chosen increment", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fun-bubble-aim-snap", "3"));
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  // 94 snaps to 93 (a multiple of 3 anchored on 90); 91 snaps back to 90.
  await page.evaluate(() => window.__bubble!.setAim(94));
  expect(await page.evaluate(() => window.__bubble!.aim())).toBe(93);
  await page.evaluate(() => window.__bubble!.setAim(91));
  expect(await page.evaluate(() => window.__bubble!.aim())).toBe(90);
});

test("keyboard: arrows re-aim and Space fires a shot", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.locator(".bub-canvas").focus();
  const start = await page.evaluate(() => window.__bubble!.aim());
  await page.locator(".bub-canvas").press("ArrowLeft");
  expect(await page.evaluate(() => window.__bubble!.aim())).toBeGreaterThan(start);
  const before = await shotsLeft(page);
  await page.locator(".bub-canvas").press(" ");
  await expect.poll(() => shotsLeft(page)).toBe(before - 1);
});

test("clearing the board with the committed fixture is a verifiable win; share round-trips", async ({
  page,
}) => {
  // The winnable-daily pack's fixture: a seed + an angle line that clears the
  // board (fetched baseURL-relative).
  const res = await page.request.get("/bubble-daily-pack.json");
  const env = (await res.json()) as {
    payload: { fixture: { seed: number; moves: number[] } };
  };
  const fixture = env.payload.fixture;
  await page.goto(`/bubble/?variant=classic&seed=${fixture.seed}`);
  await ready(page);

  await page.evaluate((moves) => {
    const h = window.__bubble!;
    for (const angle of moves) h.game.shoot(angle);
    h.refresh();
  }, fixture.moves);

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/board cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("reduced-motion fires instantly (no flight animation)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const before = await shotsLeft(page);
  // No waiting on a rAF flight — the shot applies synchronously within fire().
  await page.evaluate(async () => {
    window.__bubble!.setAim(90);
    await window.__bubble!.fire();
  });
  expect(await shotsLeft(page)).toBe(before - 1);
});

test("the aim guide is on by default and can be turned off (persists)", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const guide = page.locator('.gf-sheet [data-setting="aim-guide"] .sheet-toggle-input');
  await expect(guide).toBeChecked();
  await guide.click({ force: true });
  await page.reload();
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="aim-guide"] .sheet-toggle-input')).not.toBeChecked();
});

test("Settings lists the four aim tunables, each with a live demo", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".sheet-demo")).toHaveCount(4);
  for (const id of ["fire-on-release", "snap", "gain", "settle"]) {
    await expect(sheet.locator(`[data-setting="${id}"]`)).toBeVisible();
  }
});

test("toggling fire-on-release in the menu persists across a reload", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const toggle = page.locator('.gf-sheet [data-setting="fire-on-release"] input[type="checkbox"]');
  await expect(toggle).not.toBeChecked();
  // The checkbox is a visually-hidden switch; click its label to flip it.
  await page.locator('.gf-sheet [data-setting="fire-on-release"] .sheet-toggle').click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="fire-on-release"] input[type="checkbox"]')).toBeChecked();
});

test("changing the snap step in the menu re-snaps the live aim immediately", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.evaluate(() => window.__bubble!.setAim(97)); // step 1 → stays 97
  expect(await page.evaluate(() => window.__bubble!.aim())).toBe(97);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  // Set the snap range to 5; the live aim re-snaps to 95 (a mult of 5 from 90).
  await page.locator('.gf-sheet [data-setting="snap"] .sheet-range').fill("5");
  expect(await page.evaluate(() => window.__bubble!.aim())).toBe(95);
});

test("the settings sheet with the aim demos has no axe violations when open", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="snap"] .sheet-demo')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="hints"] .sheet-toggle-input').click({ force: true });
  await page.keyboard.press("Escape");
  await page.locator('.gf-verb[data-verb="done"]').click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
