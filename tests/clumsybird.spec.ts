//! Clumsy Bird input E2E. The wrap runs in an opaque-origin sandboxed iframe,
//! which never takes keyboard focus on its own — so before the focus fix, the
//! space bar (and every key) went to the parent document and the bird never
//! flapped, while mouse clicks worked because pointer events hit the canvas
//! regardless of focus. This spec drives the real entry point (`/clumsybird/`)
//! and proves both requested behaviours: the keyboard reaches the game without a
//! click first, and the Up arrow flaps exactly like the space bar. Keyboard tests
//! skip on touch (mobile-webkit) — there is no hardware keyboard there.

import { expect, test, type Frame } from "@playwright/test";

/** Resolve the loaded vendor frame once its canvas has been created. */
async function gameFrame(page: import("@playwright/test").Page): Promise<Frame> {
  await expect(page.locator("iframe.wrapped-game-frame")).toBeVisible();
  await expect(
    page.frameLocator("iframe.wrapped-game-frame").locator("canvas").first(),
  ).toBeAttached({ timeout: 15000 });
  const frame = page.frames().find((f) => f.url().includes("/clumsybird/vendor/index.html"));
  if (!frame) throw new Error("clumsybird vendor frame not found");
  return frame;
}

test("the space bar and up arrow reach the game without a click first", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "keyboard input needs a hardware keyboard");
  await page.goto("/clumsybird/");
  const frame = await gameFrame(page);

  // Record which keys actually arrive inside the frame's window.
  await frame.evaluate(() => {
    (window as unknown as { __keys: string[] }).__keys = [];
    window.addEventListener(
      "keydown",
      (e) => (window as unknown as { __keys: string[] }).__keys.push(e.code),
      true,
    );
  });

  // No click, no manual focus — just press, the way a player reaches for the game.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);

  const received = await frame.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
  expect(received).toContain("Space");
  expect(received).toContain("ArrowUp");
});

test("the up arrow is bound to the same action as the space bar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "keyboard input needs a hardware keyboard");
  await page.goto("/clumsybird/");
  const frame = await gameFrame(page);

  // MelonJS records keycode -> action in me.input._KeyBinding. Whatever the space
  // bar is bound to on the current screen (menu "enter" or play "fly"), the up
  // arrow must be bound to the same action, so it flaps exactly like space. Poll:
  // the screen binds its keys a beat after the canvas is created.
  const readBinding = () =>
    frame.evaluate(() => {
      const input = (window as unknown as { me?: { input?: Record<string, unknown> } }).me
        ?.input as
        | { KEY: { SPACE: number; UP: number }; _KeyBinding: Record<number, string | null> }
        | undefined;
      if (!input) return null;
      return {
        space: input._KeyBinding[input.KEY.SPACE] ?? null,
        up: input._KeyBinding[input.KEY.UP] ?? null,
      };
    });

  await expect
    .poll(async () => (await readBinding())?.space ?? null, {
      message: "space bar was never bound to an action",
    })
    .not.toBeNull();
  const binding = await readBinding();
  expect(binding!.up).toBe(binding!.space);
});
