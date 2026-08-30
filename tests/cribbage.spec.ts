//! Cribbage wiring test: the table, the peg board and the pickers render and
//! play over the binding; a throw is two selected cards and a confirm; pegging
//! is tap-to-play with the core deciding what plays; the show counts hands in
//! order and narrates the breakdown; a full game reaches a terminal whose
//! verification-forward end screen states the game's value and carries a
//! re-verifying `?r=` share. And the one property no other shelf game has to
//! prove through the UI: the engine's cards are never in the DOM.
//!
//! The tests that play many turns pass `?fast=1`, which collapses the engine's
//! beats to a frame: they assert rules and wiring, not pacing, and at full
//! pacing a game held a CI worker for over a minute per engine.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SKIN, familyMembers, familyOf } from "../src/skins.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".crib-table")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__cribbage));
}

const HUMAN = 1;

/** Wait until the human is to act (a legal move, nothing animating) or the game is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction(
    (human) => {
      const h = window.__cribbage!;
      if (h.busy()) return false;
      const v = h.game.view();
      if (v.result !== -1) return true;
      // With automatic counting the show is not the human's to act on.
      if (v.phase.startsWith("show")) return false;
      return v.toMove === human && v.legal.length > 0;
    },
    HUMAN,
    { timeout: 60_000 },
  );

/** Make one human move through the UI: a throw at the discard, a play or go while pegging. */
async function humanMove(page: Page): Promise<void> {
  const v = await page.evaluate(() => window.__cribbage!.game.view());
  if (v.phase === "discard") {
    // Select positions 0 and 1 idempotently: a tap toggles, so only tap what is
    // not already selected, and confirm each registers before the next.
    for (const [i, want] of [[0, 1], [1, 2]] as const) {
      const card = page.locator(".crib-hand .crib-card").nth(i);
      if (!((await card.getAttribute("class")) ?? "").includes("selected")) await card.click();
      await expect(page.locator(".crib-hand .crib-card.selected")).toHaveCount(want);
    }
    await page.locator(".crib-throw").click();
    await page.waitForFunction(() => window.__cribbage!.game.view().phase !== "discard" || window.__cribbage!.busy());
    return;
  }
  if (v.legal.length === 1 && v.legal[0] === 20) {
    await page.locator(".crib-go").click();
    return;
  }
  await page.locator(".crib-hand .crib-card.legal").first().click();
}

test("the table, the peg board and the pickers render", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  // At seed 7 the engine is the non-dealer and throws first, so by the time a
  // slow runner gets here it holds four, not six. The invariant is that the
  // backs on the table are the count the view reports — never the cards.
  await waitHumanOrOver(page);
  await expect(page.locator(".crib-hand .crib-card")).toHaveCount(6);
  const backs = await page.evaluate(() => window.__cribbage!.game.view().opponentCards);
  expect(backs).toBe(4);
  await expect(page.locator(".crib-opp .crib-card.back")).toHaveCount(backs);
  await expect(page.locator(".crib-board .crib-track")).toHaveCount(2);
  await expect(page.locator(".crib-board .crib-skunk")).toHaveCount(2);
  await expect(page.locator(".crib-turnbar")).toContainText(/you/i);
  await expect(page.locator(".crib-turnbar")).toContainText(/the engine/i);
  await expect(page.locator(".crib-turnbar")).toContainText(/crib/i);
  await expect(page.locator(".crib-level option")).toHaveCount(4);
  await expect(page.locator(".crib-level")).toContainText("Expert");
  await expect(page.locator(".crib-level")).not.toContainText("Perfect");
});

test("a throw is two selected cards and a confirm; the cut then turns", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  const throwBtn = page.locator(".crib-throw");
  await expect(throwBtn).toBeDisabled();
  const cards = page.locator(".crib-hand .crib-card");
  await cards.nth(0).click();
  await expect(page.locator(".crib-hand .crib-card.selected")).toHaveCount(1);
  await expect(throwBtn).toBeDisabled();
  await cards.nth(3).click();
  await expect(page.locator(".crib-hand .crib-card.selected")).toHaveCount(2);
  // a third tap replaces the oldest selection rather than selecting three
  await cards.nth(5).click();
  await expect(page.locator(".crib-hand .crib-card.selected")).toHaveCount(2);
  await expect(throwBtn).toBeEnabled();
  await throwBtn.click();
  await page.waitForFunction(() => {
    const v = window.__cribbage!.game.view();
    return v.phase !== "discard";
  });
  const v = await page.evaluate(() => window.__cribbage!.game.view());
  expect(v.hand.length).toBe(4);
  expect(v.cut).not.toBeNull();
  expect(v.cribCards).toBe(4);
  await expect(page.locator(".crib-card.cut")).toBeVisible();
});

test("pegging lights the cards that play, and the count moves", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await humanMove(page); // the throw
  await waitHumanOrOver(page);
  const v = await page.evaluate(() => window.__cribbage!.game.view());
  test.skip(v.phase !== "peg", "the deal ended before the human pegged");
  const legal = await page.locator(".crib-hand .crib-card.legal").count();
  expect(legal).toBeGreaterThan(0);
  const before = v.count;
  await page.locator(".crib-hand .crib-card.legal").first().click();
  await page.waitForFunction((b) => window.__cribbage!.game.view().count !== b, before);
  await expect(page.locator(".crib-count")).toContainText(/Count \d+/);
});

test("the engine's cards are never in the DOM", async ({ page }) => {
  // Play a few turns and, at every stop, check that no face-up card on screen
  // outside the show is one the human could not know. Card backs carry no
  // rank/suit; the only face-up cards are the human's, the cut, and plays.
  await page.goto("/cribbage/?seed=11&fast=1");
  await ready(page);
  for (let turn = 0; turn < 6; turn += 1) {
    await waitHumanOrOver(page);
    const leak = await page.evaluate(() => {
      const v = window.__cribbage!.game.view();
      if (v.result !== -1) return 0;
      const known = new Set<number>([
        ...v.hand.map((c) => c.code),
        ...v.kept.map((c) => c.code),
        ...v.played.map(([, c]) => c.code),
        ...v.revealed.flatMap((r) => r.cards.map((c) => c.code)),
        ...(v.cut ? [v.cut.code] : []),
      ]);
      // every face-up card is labelled "<rank><suit>"; count those not known
      const faces = [...document.querySelectorAll(".crib-card:not(.back):not(.slot)")];
      const labels = faces.map((f) => f.getAttribute("aria-label") ?? "");
      const codeOf = (label: string): number | null => {
        const m = /^(?:Cut: )?(A|10|[2-9]|J|Q|K)([♣♦♥♠])/.exec(label);
        if (!m) return null;
        const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(m[1]!) + 1;
        const suit = ["♣", "♦", "♥", "♠"].indexOf(m[2]!);
        return suit * 13 + (rank - 1);
      };
      return labels.map(codeOf).filter((c): c is number => c !== null && !known.has(c)).length;
    });
    expect(leak).toBe(0);
    const over = await page.evaluate(() => window.__cribbage!.game.view().result !== -1);
    if (over) break;
    await humanMove(page);
  }
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await page.locator(".crib-level").selectOption("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-cribbage-level"))).toBe("Hard");
});

test("a full game plays to a result stating its value; the share re-verifies", { tag: "@long" }, async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  for (let turn = 0; turn < 400; turn += 1) {
    await waitHumanOrOver(page);
    const over = await page.evaluate(() => window.__cribbage!.game.view().result !== -1);
    if (over) break;
    await humanMove(page);
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/worth \d game/);
  await expect(result.locator(".crib-board")).toBeVisible();

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".sol-result")).toContainText(/worth \d game/);
  await shared.close();
});

test("the show counts hands in order and narrates the breakdown", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  // With automatic counting the show is on screen only while the engine's beat
  // runs, so watch for a graded hand between human stops rather than at them.
  const atShowOrHuman = () =>
    page.waitForFunction(
      () => {
        const h = window.__cribbage!;
        const v = h.game.view();
        const graded = document.querySelector(".crib-revealed.graded .crib-breakdown");
        if (v.revealed.some((r) => r.actual !== null) && graded) {
          return { first: v.revealed[0]!.step, text: graded.textContent ?? "" };
        }
        if (v.result !== -1) return { first: "over", text: "" };
        if (h.busy() || v.phase.startsWith("show")) return false;
        return v.toMove === 1 && v.legal.length > 0 ? { first: "", text: "" } : false;
      },
      undefined,
      { timeout: 60_000 },
    );
  let seen: { first: string; text: string } | null = null;
  for (let turn = 0; turn < 60; turn += 1) {
    const got = (await (await atShowOrHuman()).jsonValue()) as { first: string; text: string };
    if (got.first === "over") break;
    if (got.first !== "") {
      seen = got;
      break;
    }
    await humanMove(page);
  }
  expect(seen, "a graded hand appeared at the show").not.toBeNull();
  // The first hand on the table is always the non-dealer's, and its count is spelled out.
  expect(seen!.first).toBe("nonDealer");
  expect(seen!.text).toMatch(/\d/);
});

test("with manual counting on, the show waits for your count and grades it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("fun-cribbage-manual-count", "on"));
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  // Play until it is the human's hand to count.
  for (let turn = 0; turn < 40; turn += 1) {
    await page.waitForFunction(() => {
      const h = window.__cribbage!;
      const v = h.game.view();
      return !h.busy() && (v.result !== -1 || (v.toMove === 1 && v.legal.length > 0));
    });
    const v = await page.evaluate(() => window.__cribbage!.game.view());
    if (v.result !== -1 || v.phase.startsWith("show")) break;
    await humanMove(page);
  }
  const input = page.locator(".crib-claim-input");
  await expect(input).toBeVisible();
  await input.fill("0");
  await input.press("Enter");
  await page.waitForFunction(() => window.__cribbage!.game.view().last?.kind === "claim");
  const last = await page.evaluate(() => window.__cribbage!.game.view().last);
  expect(last!.claimed).toBe(0);
  // Counting zero for a hand worth anything is muggins for the engine.
  if (last!.actual!.total > 0) {
    expect(last!.muggins).toBe(last!.actual!.total);
    await expect(page.locator(".crib-status")).toContainText(/muggins/i);
  }
});

test("a hint names cards, and says it counts as assistance", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".crib-hint").click();
  const status = page.locator(".crib-status");
  await expect(status).toContainText(/Hint: throw/);
  await expect(status).toContainText(/assistance/i);
});

test("with hints off the control ends the game and reports the deal in progress", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fun-hints", "off"));
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  await waitHumanOrOver(page);
  await expect(page.locator(".crib-hint")).toHaveCount(0);
  await page.locator(".crib-stuck").click();
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(/ended early/i);
  await expect(result).toContainText(/deal \d+ was in progress/i);
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
});

test("the tutor panel is off by default, appears when enabled, and is exact for a throw", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await expect(page.locator(".crib-tutor")).toHaveCount(0);
  // Open the panel while the engine may still be moving: its resting render
  // must not snap the panel shut (the Dots hang; `src/ui-state.ts`).
  await page.locator(".crib-settings summary").click();
  await page.locator(".crib-set-tutor").check();
  await expect(page.locator(".crib-tutor-explain")).toBeVisible();
  await waitHumanOrOver(page);
  await page.locator(".crib-tutor-explain").click();
  await expect(page.locator(".crib-tutor-note")).toContainText(/Exact/);
  await expect(page.locator(".crib-tutor-options li").first()).toContainText(/throw .* — \d+\.\d/);
});

test("the table reads engine, board, middle, your hand — and the seats can be swapped", async ({ page }) => {
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  const order = () =>
    page.evaluate(() =>
      [...document.querySelector(".crib-table")!.children].map((c) => (c.getAttribute("class") ?? "").split(" ")[0]),
    );
  const initial = await order();
  expect(initial.indexOf("crib-opp")).toBeLessThan(initial.indexOf("crib-board"));
  expect(initial.indexOf("crib-board")).toBeLessThan(initial.indexOf("crib-hand"));
  await expect(page.locator(".crib-board .crib-track")).toHaveCount(2);
  await expect(page.locator(".crib-board .crib-peg-front")).toHaveCount(2);
  await page.locator(".crib-settings summary").click();
  await page.locator(".crib-set-seats").check();
  const flipped = await order();
  expect(flipped.indexOf("crib-hand")).toBeLessThan(flipped.indexOf("crib-board"));
  expect(flipped.indexOf("crib-board")).toBeLessThan(flipped.indexOf("crib-opp"));
  expect(await page.evaluate(() => localStorage.getItem("fun-cribbage-seats-flipped"))).toBe("on");
});

test("the pegs walk to the score, and the board's score ticks with them", async ({ page }) => {
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  // Play until somebody has scored, then the front pegs must come to rest on the scores.
  for (let turn = 0; turn < 40; turn += 1) {
    await waitHumanOrOver(page);
    const v = await page.evaluate(() => window.__cribbage!.game.view());
    if (v.result !== -1 || v.scores[0] + v.scores[1] > 0) break;
    await humanMove(page);
  }
  await page.waitForFunction(() => {
    const v = window.__cribbage!.game.view();
    const at = (seat: number) => Number(document.querySelector(`.crib-peg-front[data-seat="${seat}"]`)?.getAttribute("data-hole"));
    return at(1) === Math.min(v.scores[0], 121) && at(2) === Math.min(v.scores[1], 121);
  });
  const v = await page.evaluate(() => window.__cribbage!.game.view());
  expect(v.scores[0] + v.scores[1]).toBeGreaterThan(0);
  await expect(page.locator('.crib-board-score[data-seat="1"]')).toHaveText(String(v.scores[0]));
  await expect(page.locator('.crib-board-score[data-seat="2"]')).toHaveText(String(v.scores[1]));
  // The back peg trails the front one: it is where the score last was.
  const back = await page.locator('.crib-peg-back[data-seat="1"]').getAttribute("data-hole");
  expect(Number(back)).toBeLessThanOrEqual(v.scores[0]);
});

test("the board can be two compact bars instead", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fun-cribbage-board", "bars"));
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  await expect(page.locator(".crib-board")).toHaveCount(0);
  await expect(page.locator(".crib-bars .crib-track")).toHaveCount(2);
  await expect(page.locator(".crib-bars .crib-skunk")).toHaveCount(2);
  await expect(page.locator(".crib-bars .crib-bar-peg")).toHaveCount(2);
  await expect(page.locator(".crib-board-mode")).toHaveValue("bars");
});

test("in recap mode the board is absent during the deal and replays the pegging when the deal ends", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("fun-cribbage-board", "recap"));
  await page.goto("/cribbage/?seed=7&fast=1");
  await ready(page);
  await expect(page.locator(".crib-board")).toHaveCount(0);
  await expect(page.locator(".crib-bars")).toHaveCount(0);
  // Under ?fast=1 the recap stays up for 60ms — two assertion round-trips lose that
  // race on a slow runner (it did, on every CI run, while passing locally). Observe
  // it from inside the page instead: record what the recap said, and whether it
  // held a board, the moment it appeared.
  await page.evaluate(() => {
    const w = window as unknown as { __recap: { text: string; board: boolean } | null };
    w.__recap = null;
    new MutationObserver(() => {
      if (w.__recap) return;
      const el = document.querySelector(".crib-recap");
      if (el) w.__recap = { text: el.textContent ?? "", board: el.querySelector(".crib-board") !== null };
    }).observe(document.querySelector("#play-area")!, { childList: true, subtree: true });
  });
  const seen = (): Promise<{ text: string; board: boolean } | null> =>
    page.evaluate(() => (window as unknown as { __recap: { text: string; board: boolean } | null }).__recap);
  // Play through the first deal; the recap appears once deal 2 begins.
  for (let turn = 0; turn < 60; turn += 1) {
    if (await seen()) break;
    await waitHumanOrOver(page);
    if (await seen()) break;
    const v = await page.evaluate(() => window.__cribbage!.game.view());
    if (v.result !== -1) break;
    await humanMove(page);
  }
  await page.waitForFunction(() => (window as unknown as { __recap: unknown }).__recap !== null);
  const recap = (await seen())!;
  expect(recap.text).toMatch(/deal 1/i);
  expect(recap.board).toBe(true);
});


for (const skin of familyMembers(familyOf(DEFAULT_SKIN))) {
  test(`no axe violations on the table (${skin})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("fun-skin", t), skin);
    await page.goto("/cribbage/?seed=7");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
    const results = await new AxeBuilder({ page }).include(".crib-game").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the table fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  const overflow = await page.evaluate(() => {
    const table = document.querySelector(".crib-table")!;
    const right = Math.max(...[...table.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right));
    return {
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      contentRight: right,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(overflow.pageScrolls).toBe(false);
  expect(overflow.contentRight).toBeLessThanOrEqual(overflow.viewport);
});

test("every card in hand clears the 44px tap floor", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/cribbage/?seed=7");
  await ready(page);
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll(".crib-hand .crib-card")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width < 40 || r.height < 44).length,
  );
  expect(small).toBe(0);
});
