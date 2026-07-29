//! How-to-play guide content discipline (the reusable game user-guide standard).
//! Copy is pure data, so it is unit-tested: stable anchors, non-empty entries,
//! and — the sync guarantee — every screenshot a guide names exists on disk
//! (rerun `npm run guide:shots` after a visual change).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GUIDES } from "../src/how-to-registry.js";

const guides = Object.entries(GUIDES);

it("ships at least the solitaire guide", () => {
  expect(GUIDES.solitaire).toBeTruthy();
});

describe.each(guides)("guide: %s", (_id, guide) => {
  it("has a title, a lede, and entries", () => {
    expect(guide.title.length).toBeGreaterThan(0);
    expect(guide.lede.length).toBeGreaterThan(0);
    expect(guide.entries.length).toBeGreaterThan(0);
  });

  it("uses stable, unique howto- anchors and non-empty sections", () => {
    const seen = new Set<string>();
    for (const entry of guide.entries) {
      expect(entry.testid, `bad testid ${entry.testid}`).toMatch(/^howto-[a-z0-9-]+$/);
      expect(seen.has(entry.testid), `duplicate testid ${entry.testid}`).toBe(false);
      seen.add(entry.testid);
      expect(entry.toc.length).toBeGreaterThan(0);
      expect(entry.blocks.length).toBeGreaterThan(0);
    }
  });

  it("every screenshot it references exists on disk (rerun `npm run guide:shots`)", () => {
    for (const entry of guide.entries) {
      for (const block of entry.blocks) {
        if (block.kind !== "shot") continue;
        const path = join(process.cwd(), "assets", "guide", `${block.name}.jpg`);
        expect(existsSync(path), `missing screenshot assets/guide/${block.name}.jpg`).toBe(true);
      }
    }
  });
});
