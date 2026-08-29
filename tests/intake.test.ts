//! The art drop-off's filename parser.
//!
//! The drop-off exists so art can arrive named the way a person names things —
//! `blockdoku_icon.png`, `Drop4Splash.jpeg`, `dots_and_boxes_icon.png` all
//! arrived that way and the tool used to reject every one of them. So the parser
//! is the part worth pinning: it is pure, it is where the forgiveness lives, and
//! a regression there is invisible until someone's drop is silently skipped.
//!
//! Two things this covers that the tool could not do before:
//!   - a shape word ANYWHERE in the name, not only trailing
//!     (`trio_tumble_horizontal_splash.png`)
//!   - `horizontal`/`vertical` as synonyms for `landscape`/`portrait`
//! and the splash destination is chosen by MEASURING the image, not by trusting
//! the word — which is why the word is safe to throw away.

import { describe, expect, it } from "vitest";

import { gameAliases, parseDropName, slug, splashDest } from "../tools/intake.mjs";
import { REGISTRY } from "../src/registry.js";

describe("parseDropName", () => {
  const cases: [string, { rawId: string; kind: string; focus?: number } | null][] = [
    // the three files that motivated this change
    ["trio_tumble_icon.png", { rawId: "trio_tumble", kind: "icon" }],
    ["trio_tumble_horizontal_splash.png", { rawId: "trio_tumble", kind: "splash" }],
    ["trio_tumble_portrait_splash.png", { rawId: "trio_tumble", kind: "splash" }],
    // the shapes that already worked, which must keep working
    ["align_splash_portrait.jpeg", { rawId: "align", kind: "splash" }],
    ["blockdoku_icon.png", { rawId: "blockdoku", kind: "icon" }],
    ["Drop4Splash.jpeg", { rawId: "Drop4", kind: "splash" }],
    ["dots_and_boxes_icon.png", { rawId: "dots_and_boxes", kind: "icon" }],
    // `cover` is an accepted synonym; `icon` is the name that sticks
    ["solitaire-cover.jpg", { rawId: "solitaire", kind: "icon" }],
    // an explicit crop focus survives
    ["wyrdle_icon@60.png", { rawId: "wyrdle", kind: "icon", focus: 60 }],
    // the new synonyms
    ["furrow_vertical_splash.png", { rawId: "furrow", kind: "splash" }],
    ["furrow-landscape-splash.png", { rawId: "furrow", kind: "splash" }],
    // no kind word at all — not ours to file
    ["just-a-picture.png", null],
  ];

  it.each(cases)("parses %s", (file, expected) => {
    expect(parseDropName(file)).toEqual(expected);
  });

  it("does not strip a shape word that is the whole game name", () => {
    // Guard against over-eager stripping: only a NON-LEADING token is a shape
    // word. Otherwise a game legitimately called "Square …" loses its name.
    expect(parseDropName("square_icon.png")).toEqual({ rawId: "square", kind: "icon" });
  });
});

describe("splashDest", () => {
  it("sends a landscape source to its own file so it cannot overwrite the portrait one", () => {
    expect(splashDest("/g", 1376, 768)).toBe("/g/splash-landscape.jpg");
  });

  it("sends portrait and square sources to the primary splash", () => {
    expect(splashDest("/g", 768, 1376)).toBe("/g/splash.jpg");
    expect(splashDest("/g", 900, 900)).toBe("/g/splash.jpg");
  });
});

describe("gameAliases", () => {
  it("resolves a game by its id and by its slugified title", () => {
    const a = gameAliases();
    expect(a.get("trio-tumble")).toBe("trio-tumble");
    // `dots_and_boxes` must find the game whose id is merely `dots`
    expect(a.get(slug("dots_and_boxes"))).toBe("dots");
  });

  it("resolves a subtitled game by its whole name, which is what its art says", () => {
    expect(gameAliases().get(slug("trio_tumble_jewel_drop"))).toBe("trio-tumble");
  });

  it("does not let a subtitle shift any other game's name", () => {
    // Regression: ids and titles were collected into two lists and zipped by
    // index, and `title:` matches inside `subtitle:`. The first subtitle in the
    // registry gave every later game its neighbour's name. Assert the whole map
    // round-trips, not just one entry.
    const a = gameAliases();
    for (const g of REGISTRY) {
      expect(a.get(g.id)).toBe(g.id);
      expect(a.get(slug(g.title))).toBe(g.id);
    }
  });
});
