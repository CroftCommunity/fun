//! The puzzles collection, end-to-end (the real-browser proof). The load-bearing
//! claim is that a Tatham WASM puzzle runs inside our opaque-origin sandbox
//! (`allow-scripts`, no `allow-same-origin`) with NO runtime wasm fetch — because
//! net.wasm is base64-inlined into `Module.wasmBinary` before net.js loads. If
//! that inlining failed, net.js could not fetch net.wasm from a null origin on
//! static hosting, #puzzle would stay hidden, and the canvas would never size.
//! (Sandbox flags + same-origin egress + axe are asserted by the parameterized
//! tier2-containment.spec.ts, which auto-enrolls this game from its meta.)

import { expect, test } from "@playwright/test";

test.describe("Puzzles collection — Net renders contained", () => {
  test("Net's canvas renders inside the sandbox (inline-wasm ran under allow-scripts)", async ({
    page,
  }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/puzzles/");

    const frame = page.locator("iframe.wrapped-game-frame");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");

    // net.html ships #puzzle hidden (style="display:none"); net.js only reveals it
    // once the WASM engine has initialised. So a non-"none" display is a direct
    // proof the inlined wasm instantiated inside the opaque-origin frame.
    await expect(page.frameLocator("iframe.wrapped-game-frame").locator("#puzzlecanvas")).toBeAttached(
      { timeout: 30000 },
    );
    const net = page.frames().find((f) => f.url().includes("/puzzles/vendor/net.html"));
    if (!net) throw new Error("net vendor frame not found");

    await expect
      .poll(
        () =>
          net.evaluate(() => {
            const puzzle = document.getElementById("puzzle");
            return puzzle ? getComputedStyle(puzzle).display : "missing";
          }),
        {
          timeout: 30000,
          message: "net.js never revealed #puzzle — the inlined WASM did not instantiate",
        },
      )
      .not.toBe("none");

    // The puzzle actually drew: its canvas has a real rendered size.
    const size = await net.evaluate(() => {
      const c = document.getElementById("puzzlecanvas") as HTMLCanvasElement | null;
      return { w: c?.clientWidth ?? 0, h: c?.clientHeight ?? 0 };
    });
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);

    // A CORS/wasm load failure would surface as an uncaught error.
    expect(crashes).toEqual([]);
  });

  test("shows the picker control for Net and the honest-representation banner", async ({ page }) => {
    await page.goto("/puzzles/");
    await expect(page.locator(".wrapped-banner")).toContainText(/no verifiable record/i);
    const netBtn = page.locator('button[data-puzzle="net"]');
    await expect(netBtn).toBeVisible();
    await expect(netBtn).toHaveAttribute("aria-pressed", "true");
  });
});
