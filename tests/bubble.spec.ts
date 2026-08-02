//! Bubble-shooter aim-and-shoot wiring test: the canvas board + launcher + aim
//! control render; aiming then firing spends a shot and lands **exactly where
//! the core resolves it** (the guardrail — the UI never invents physics); the
//! committed winnable fixture clears to a verifiable record and the share link
//! round-trips; keyboard aim/fire works; reduced-motion fires instantly. Axe +
//! narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bub-canvas")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__bubble));
}

const shotsLeft = (page: Page): Promise<number> =>
  page.evaluate(() => window.__bubble!.game.board().shotsLeft);

test("the board renders a canvas, a launcher chip, an aim control and the HUD", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await expect(page.locator(".bub-canvas")).toHaveAttribute("aria-label", /bubbles left/i);
  await expect(page.locator(".bub-loaded")).toBeVisible();
  await expect(page.locator(".bub-aim")).toBeVisible();
  await expect(page.locator(".bub-fire")).toBeVisible();
  await expect(page.locator(".bub-hud")).toContainText(/score/i);
  await expect(page.locator(".bub-hud")).toContainText(/shots left/i);
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
  await page.locator(".sol-settings summary").click();
  const guide = page.locator(".bub-set-aimguide");
  await expect(guide).toBeChecked();
  await guide.uncheck();
  await page.reload();
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await expect(page.locator(".bub-set-aimguide")).not.toBeChecked();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/bubble/?variant=classic&seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
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
