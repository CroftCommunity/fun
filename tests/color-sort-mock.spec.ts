//! Color Sort ↔ mock E parity (mocks/e-color-sort.claims.json). One test per claim,
//! titled exactly as the claim names it — tests/mock-parity.test.ts requires the
//! title once the claim's phase is COMPLETE in the plan. Each test proves the
//! claim the way its `kind` says: structure by DOM, measure by rects, behaviour by
//! driving the core and reading animations, look by computed style.

import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".cs-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__colorSort));
}

/** A deterministic random walk in the page until the core reports deadlock. */
async function driveToDeadlock(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = window.__colorSort!;
    let s = 0x9e3779b9;
    const rnd = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let attempt = 0; attempt < 400; attempt++) {
      h.game.restart();
      for (let i = 0; i < 80; i++) {
        const b = h.board();
        if (b.deadlocked || b.won) break;
        const mv = b.moves[Math.floor(rnd() * b.moves.length)]!;
        h.game.pour(mv.from, mv.to);
      }
      if (h.board().deadlocked) {
        h.refresh();
        return true;
      }
    }
    return false;
  });
}

test("mock E1.1: a bare land opens the poster, not a board", async ({ page }) => {
  await page.goto("/color-sort/");
  const poster = page.locator(".gf-start.gf-poster");
  await expect(poster).toBeVisible();
  await expect(poster.locator(".gf-start-title")).toHaveText("Color Sort");
  await expect(poster.locator(".gf-start-pitch")).not.toBeEmpty();
  await expect(poster.locator('.gf-start-setup [data-setting="mode"]')).toHaveCount(1);
  await expect(poster.locator(".gf-play")).toBeVisible();
  await expect(page.locator(".cs-board")).toHaveCount(0);
});

test("mock E2.1: meters and verbs are the frame's, in the mock's order", async ({ page }) => {
  await page.goto("/color-sort/?level=3");
  await ready(page);
  // Three stats, always: moves · level (or par, on a daily) · best.
  const meters = await page.locator(".gf-meters .gf-stat").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.meter),
  );
  expect(meters).toEqual(["moves", "mark", "best"]);
  await expect(page.locator('.gf-stat[data-meter="mark"] .gf-stat-label')).toHaveText(/level/i);
  // The dock, left to right: Undo · Hint · New game · Restart · Settings (the frame's).
  const verbs = await page.locator(".gf-dock .gf-verb").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.verb),
  );
  expect(verbs).toEqual(["undo", "hint", "new", "restart", "settings"]);
});

test("mock E2.2: the board does not move on pour, deadlock, hint or undo", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?level=25"); // nine colours: a random walk dead-ends readily
  await ready(page);
  const v = await boardTopStable(page, ".cs-board", async () => {
    const mv = await page.evaluate(() => window.__colorSort!.game.hint());
    await page.locator(`.cs-tube[data-tube="${mv!.from}"]`).click();
    await page.locator(`.cs-tube[data-tube="${mv!.to}"].legal`).click();
    await page.locator('.gf-verb[data-verb="hint"]').click();
    await page.locator('.gf-verb[data-verb="undo"]').click();
    await page.locator('.gf-verb[data-verb="undo"]').click();
    expect(await driveToDeadlock(page)).toBe(true);
    await expect(page.locator(".gf-toast")).toContainText(/no moves left/i);
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("mock E2.3: tubes clear the 44px tap floor at 390", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?play=1"); // the daily: twelve tubes, the tightest fit
  await ready(page);
  const boxes = await page.locator(".cs-tube").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  );
  expect(boxes).toHaveLength(12);
  for (const b of boxes) {
    expect(b.w, `tube width ${b.w}`).toBeGreaterThanOrEqual(44);
    expect(b.h, `tube height ${b.h}`).toBeGreaterThanOrEqual(44);
  }
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("mock E2.4: deadlock is a stage toast, not a banner", async ({ page }) => {
  await page.goto("/color-sort/?level=25");
  await ready(page);
  expect(await driveToDeadlock(page)).toBe(true);
  const toast = page.locator(".gf-stage .gf-toast");
  await expect(toast).toContainText(/no moves left/i);
  expect(await toast.evaluate((e) => getComputedStyle(e).position)).toBe("absolute");
  await expect(page.locator(".cs-banner")).toHaveCount(0);
});

test("mock E7.1: the desktop rail carries meters, verbs, This game and settings", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/color-sort/?level=2");
  await ready(page);
  await expect(page.locator("[data-gf-shape]")).toHaveAttribute("data-gf-shape", "rail");
  const rail = page.locator(".gf-extra");
  await expect(page.locator(".gf-meters .gf-stat")).toHaveCount(3);
  for (const verb of ["undo", "hint", "new", "restart"]) {
    await expect(page.locator(`.gf-dock .gf-verb[data-verb="${verb}"]`)).toHaveCount(1);
  }
  await expect(rail.locator(".gf-readonly")).toContainText(/mode/i);
  for (const setting of ["skin", "icons", "strict"]) {
    await expect(rail.locator(`[data-setting="${setting}"]`)).toHaveCount(1);
  }
});

// ---------- phase B: the pour (mock E3–E5, E8) ----------

/** Pour the core's hint move through the UI (tap source, tap target) and return it. */
async function pourOnce(page: Page): Promise<{ from: number; to: number }> {
  const mv = await page.evaluate(() => window.__colorSort!.game.hint());
  await page.locator(`.cs-tube[data-tube="${mv!.from}"]`).click();
  await page.locator(`.cs-tube[data-tube="${mv!.to}"].legal`).click();
  return mv!;
}

async function setSkin(page: Page, skin: "water" | "ball" | "bolt"): Promise<void> {
  await page.evaluate((s) => localStorage.setItem("fun-color-sort-skin", s), skin);
}

test("mock E3.1: the water pour runs lift 120 / travel 200 / 160 per unit / return 200 at Normal", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await pourOnce(page);
  const plan = await page.evaluate(() => window.__colorSort!.lastPour);
  expect(plan).not.toBeNull();
  expect(plan!.skin).toBe("water");
  expect(plan!.speed).toBe("normal");
  const byId = Object.fromEntries(plan!.steps.map((s) => [s.id, s.ms]));
  expect(byId["lift"]).toBe(120);
  expect(byId["travel"]).toBe(200);
  expect(byId["unit-0"]).toBe(160);
  expect(byId["return"]).toBe(200);
  expect(plan!.steps.filter((s) => s.id.startsWith("unit-"))).toHaveLength(plan!.units);
  // And it is live: the tube's Web Animation exists, with the plan's duration.
  const live = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.id.startsWith("cs-pour-")).map((a) => ({ id: a.id, ms: Number(a.effect!.getTiming().duration) })),
  );
  expect(live.length).toBeGreaterThan(0);
  expect(live.every((a) => a.ms > 0)).toBe(true);
});

test("mock E3.2: the source rotates about its lip and docks over the target mouth", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  const mv = await pourOnce(page);
  const g = await page.evaluate((m) => {
    const src = document.querySelector<HTMLElement>(`.cs-tube[data-tube="${m.from}"]`)!;
    const dst = document.querySelector<HTMLElement>(`.cs-tube[data-tube="${m.to}"]`)!;
    return { origin: getComputedStyle(src).transformOrigin, plan: window.__colorSort!.lastPour!.geometry!, src: src.getBoundingClientRect().toJSON(), dst: dst.getBoundingClientRect().toJSON() };
  }, mv);
  // The lip corner: the top edge, on the side facing the target.
  const pouringRight = g.src.left < g.dst.left;
  expect(g.origin.endsWith(" 0px")).toBe(true);
  expect(Math.round(parseFloat(g.origin))).toBe(pouringRight ? Math.round(g.src.width) : 0);
  expect(Math.abs(g.plan.tilt)).toBeGreaterThan(90);
  // Docked, the spout sits inside the target's mouth, above its top.
  const spoutX = pouringRight ? g.src.right + g.plan.dx : g.src.left + g.plan.dx;
  expect(spoutX).toBeGreaterThan(g.dst.left);
  expect(spoutX).toBeLessThan(g.dst.right);
  expect(g.src.top + g.plan.dy).toBeLessThan(g.dst.top);
});

test("mock E3.3: a tap during the return is accepted against the true state", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await pourOnce(page);
  // Immediately — the first pour is still animating — make the next legal pour.
  const running = await page.evaluate(() => document.getAnimations().some((a) => a.id.startsWith("cs-pour-")));
  expect(running).toBe(true);
  const hashBefore = await page.evaluate(() => window.__colorSort!.game.currentHash());
  const second = await pourOnce(page);
  const hashAfter = await page.evaluate(() => window.__colorSort!.game.currentHash());
  expect(hashAfter).not.toBe(hashBefore);
  expect(await page.evaluate(() => window.__colorSort!.lastPour!.from)).toBe(second.from);
});

test("mock E3.4: the ball skin hops balls one at a time, no tilt", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await setSkin(page, "ball");
  await page.reload();
  await ready(page);
  await expect(page.locator(".cs-board.cs-skin-ball")).toBeVisible();
  await pourOnce(page);
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.skin).toBe("ball");
  expect(plan.tilts).toBe(false);
  expect(plan.steps.filter((s) => s.id.startsWith("hop-"))).toHaveLength(plan.units);
  expect(plan.steps.find((s) => s.id === "hop-0")!.ms).toBe(140);
  // The hop starts after the lift (120ms): wait for it, then read what is live.
  await page.waitForFunction(() => document.getAnimations().some((a) => a.id.startsWith("cs-pour-hop")));
  const live = await page.evaluate(() => document.getAnimations().map((a) => a.id));
  expect(live.some((id) => id.startsWith("cs-pour-hop"))).toBe(true);
  expect(live.some((id) => id === "cs-pour-travel")).toBe(false);
});

test("mock E3.5: the bolt skin unscrews, carries, and screws down", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await setSkin(page, "bolt");
  await page.reload();
  await ready(page);
  await pourOnce(page);
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.skin).toBe("bolt");
  expect(plan.tilts).toBe(false);
  expect(plan.steps.slice(0, 3).map((s) => s.id)).toEqual(["unscrew-0", "carry-0", "screw-0"]);
  const live = await page.evaluate(() => document.getAnimations().map((a) => a.id));
  expect(live.some((id) => id.startsWith("cs-pour-nut"))).toBe(true);
});

test("mock E3.6: a partial pour animates only the units that moved", async ({ page }) => {
  await page.goto("/color-sort/?level=25");
  await ready(page);
  // Find, from the core, a pour whose source run is longer than the target's room.
  const found = await page.evaluate(() => {
    const h = window.__colorSort!;
    for (let attempt = 0; attempt < 300; attempt++) {
      const b = h.board();
      for (const m of b.moves) {
        const src = b.tubes[m.from]!;
        const top = src[src.length - 1];
        let run = 0;
        for (let i = src.length - 1; i >= 0 && src[i] === top; i--) run++;
        const room = b.cap - b.tubes[m.to]!.length;
        if (run > room && room > 0) {
          h.refresh();
          return { from: m.from, to: m.to, expect: room };
        }
      }
      const mv = b.moves[attempt % b.moves.length]!;
      h.game.pour(mv.from, mv.to);
      if (h.board().won || h.board().deadlocked) h.game.restart();
    }
    return null;
  });
  expect(found, "no partial pour reachable — pick another level").not.toBeNull();
  await page.locator(`.cs-tube[data-tube="${found!.from}"]`).click();
  await page.locator(`.cs-tube[data-tube="${found!.to}"].legal`).click();
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.units).toBe(found!.expect);
  expect(plan.steps.filter((s) => s.id.startsWith("unit-"))).toHaveLength(found!.expect);
});

test("mock E3.7: ?fast=1 collapses the pour to a frame", async ({ page }) => {
  await page.goto("/color-sort/?level=1&fast=1");
  await ready(page);
  await pourOnce(page);
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.speed).toBe("off");
  expect(plan.total).toBeLessThanOrEqual(150);
  const transforms = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.id.startsWith("cs-pour-") && a.id !== "cs-pour-fade").length,
  );
  expect(transforms).toBe(0);
});

test("mock E4.1: a completed tube plays its cap and cue once", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  // Walk the solver's line through the UI until a tube locks.
  let completed: number | null = null;
  for (let i = 0; i < 60 && completed === null; i++) {
    const before = await page.evaluate(() => window.__colorSort!.board().locked.filter(Boolean).length);
    const mv = await pourOnce(page);
    const after = await page.evaluate(() => window.__colorSort!.board().locked.filter(Boolean).length);
    if (after > before) completed = mv.to;
  }
  expect(completed).not.toBeNull();
  const tube = page.locator(`.cs-tube[data-tube="${completed}"]`);
  await expect(tube).toHaveClass(/locked/);
  await expect(tube).toHaveClass(/cs-complete/);
  const cues = await page.evaluate(() => window.__colorSort!.sound.log.filter((c) => c.kind === "complete").length);
  expect(cues).toBe(1);
  // Another pour elsewhere does not celebrate that tube again.
  await pourOnce(page);
  expect(await page.evaluate(() => window.__colorSort!.sound.log.filter((c) => c.kind === "complete").length)).toBe(1);
});

test("mock E4.2: undo reverses the pour animation", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await ready(page);
  const mv = await pourOnce(page);
  await page.locator('.gf-verb[data-verb="undo"]').click();
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.reverse).toBe(true);
  expect(plan.from).toBe(mv.to);
  expect(plan.to).toBe(mv.from);
  expect(plan.total).toBeLessThan(pourTotalNormal(plan.units));
  const live = await page.evaluate(() => document.getAnimations().some((a) => a.id.startsWith("cs-pour-")));
  expect(live).toBe(true);
});
function pourTotalNormal(units: number): number {
  return 120 + 200 + 160 * units + 200;
}

test("mock E5.1: the settings sheet carries Look, Pour speed, Fruit icons, Strict", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const sheet = page.locator(".gf-sheet");
  const ids = await sheet.locator("[data-setting]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.setting));
  const mine = ids.filter((id) => ["skin", "pour-speed", "icons", "strict"].includes(id!));
  expect(mine).toEqual(["skin", "pour-speed", "icons", "strict"]);
  await expect(sheet.locator('[data-setting="pour-speed"] .sheet-choice-opt')).toHaveText(["Slow", "Normal", "Fast", "Off"]);
});

test("mock E5.2: Off and reduced motion cross-fade and announce the pour", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/color-sort/?level=1");
  await ready(page);
  const mv = await pourOnce(page);
  const plan = await page.evaluate(() => window.__colorSort!.lastPour!);
  expect(plan.speed).toBe("off");
  const ids = await page.evaluate(() => document.getAnimations().map((a) => a.id).filter((id) => id.startsWith("cs-pour-")));
  expect(ids.every((id) => id === "cs-pour-fade")).toBe(true);
  await expect(page.locator(".sol-status")).toContainText(new RegExp(`poured ${plan.units} .* into tube ${mv.to + 1}`, "i"));
});

test("mock E5.3: reduced motion is the default speed, not a lock", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(PHONE);
  await page.goto("/color-sort/?level=1");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="pour-speed"]');
  await expect(row.locator('input[value="off"]')).toBeChecked();
  await row.locator('input[value="fast"]').check();
  await page.keyboard.press("Escape");
  await pourOnce(page);
  expect(await page.evaluate(() => window.__colorSort!.lastPour!.speed)).toBe("fast");
  await page.reload();
  await ready(page);
  await pourOnce(page);
  expect(await page.evaluate(() => window.__colorSort!.lastPour!.speed)).toBe("fast");
});

test("mock E8.1: sound follows the Sound row and differs per skin", async ({ page }) => {
  await page.goto("/color-sort/?level=1");
  await page.evaluate(() => localStorage.setItem("fun-music", "off"));
  await page.reload();
  await ready(page);
  await pourOnce(page);
  let log = await page.evaluate(() => window.__colorSort!.sound.log);
  expect(log.at(-1)).toMatchObject({ kind: "pour", skin: "water", played: false });
  await page.evaluate(() => localStorage.setItem("fun-music", "on"));
  await setSkin(page, "bolt");
  await page.reload();
  await ready(page);
  await pourOnce(page);
  log = await page.evaluate(() => window.__colorSort!.sound.log);
  expect(log.at(-1)).toMatchObject({ kind: "pour", skin: "bolt", played: true });
  const water = await page.evaluate(() => window.__colorSort!.sound.cue("water", "pour"));
  const bolt = await page.evaluate(() => window.__colorSort!.sound.cue("bolt", "pour"));
  expect(water).not.toEqual(bolt);
});
