//! The game contract's naming rule.
//!
//! A game may carry an optional `subtitle`. It exists because Trio Tumble's full
//! name — "Trio Tumble: Jewel Drop" — is 23 characters against a shelf whose
//! longest title is "Dots and Boxes" at 14, in a `.home-tile-title` with no
//! truncation, on a 360px floor. So the tile and the drawer show the short
//! title, and only surfaces with room compose the whole name.
//!
//! The rule is a pure function so both surfaces compose the name the same way
//! and neither can drift into its own string concatenation.

import { describe, expect, it } from "vitest";

import { displayName } from "../src/contract.js";
import { REGISTRY } from "../src/registry.js";
import type { GameEntry } from "../src/contract.js";

const entry = (over: Partial<GameEntry>): GameEntry =>
  ({
    id: "x",
    title: "Short",
    emoji: "🎲",
    status: "playable",
    ...over,
  }) as GameEntry;

describe("displayName", () => {
  it("composes title and subtitle with a colon when a subtitle is present", () => {
    expect(displayName(entry({ title: "Trio Tumble", subtitle: "Jewel Drop" }))).toBe(
      "Trio Tumble: Jewel Drop",
    );
  });

  it("is just the title when there is no subtitle", () => {
    expect(displayName(entry({ title: "Furrow" }))).toBe("Furrow");
  });

  it("ignores a subtitle that is empty or only whitespace, rather than trailing a bare colon", () => {
    expect(displayName(entry({ title: "Furrow", subtitle: "" }))).toBe("Furrow");
    expect(displayName(entry({ title: "Furrow", subtitle: "   " }))).toBe("Furrow");
  });
});

describe("the registry's use of subtitle", () => {
  it("gives Trio Tumble its full name", () => {
    const tt = REGISTRY.find((g) => g.id === "trio-tumble");
    expect(tt).toBeTruthy();
    expect(tt!.title).toBe("Trio Tumble");
    expect(displayName(tt!)).toBe("Trio Tumble: Jewel Drop");
  });

  it("leaves every other game without one — the field is an exception, not a habit", () => {
    const withSubtitle = REGISTRY.filter((g) => g.subtitle !== undefined).map((g) => g.id);
    expect(withSubtitle).toEqual(["trio-tumble"]);
  });

  it("keeps every tile title inside the width the shelf has actually rendered", () => {
    // "Dots and Boxes" (14) is the longest the shelf has shipped. The tile has no
    // clamp CSS, so a longer title wraps on a 360px phone — which is what the
    // subtitle field exists to avoid.
    for (const g of REGISTRY) expect(g.title.length).toBeLessThanOrEqual(14);
  });
});

describe("the progress members of the contract", () => {
  it("the placeholder's snapshot() round-trips through the store's resolver, and resume() restores it", async () => {
    const { placeholderModule } = await import("../src/games/placeholder.js");
    const { resolveProgress } = await import("../src/progress.js");
    const host = document.createElement("div");
    const game = placeholderModule();
    game.mount(host, { mode: "standalone" });
    host.querySelector<HTMLButtonElement>('.gf-verb[data-verb="poke"]')!.click();
    host.querySelector<HTMLButtonElement>('.gf-verb[data-verb="poke"]')!.click();
    const snap = game.snapshot!();
    expect(snap.summary.line).toBe("2 pokes");
    const r = resolveProgress(JSON.stringify(snap), new Date());
    expect(r.ok).toBe(true);

    const again = placeholderModule();
    const host2 = document.createElement("div");
    again.mount(host2, { mode: "standalone" });
    again.resume!(snap);
    expect(host2.querySelector(".gf-stat-value")?.textContent).toBe("2");
    expect(again.snapshot!().summary.line).toBe("2 pokes");
  });
});
