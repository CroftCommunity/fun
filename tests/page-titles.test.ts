//! Every game page's <title> is the game's NAME, not its slug (plan Phase 2b,
//! closing the TODO/README item). `build.mjs` is plain Node and cannot import
//! the TS registry, so `tools/registry-titles.mjs` reads `src/registry.ts` as
//! text — the way `tools/skin-init.mjs` reads `src/skins.ts` — and these tests
//! pin the derivation against the real registry. They are also the first test
//! that pins `build.mjs`'s page list to the registry: a game registered without
//! a page, or a page without a game, fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readRegistryTitles, GAME_PAGES } from "../tools/registry-titles.mjs";
import { REGISTRY } from "../src/registry.js";
import { displayName } from "../src/contract.js";

const source = readFileSync(join(process.cwd(), "src/registry.ts"), "utf8");

describe("readRegistryTitles", () => {
  it("returns every registry id with its display name — the same set, the same names", () => {
    expect(readRegistryTitles(source)).toEqual(
      Object.fromEntries(REGISTRY.map((e) => [e.id, displayName(e)])),
    );
  });

  it("parses each entry as a unit: two entries on one line are two entries (the index-zip regression)", () => {
    const text = `export const REGISTRY = [{ id: "a", title: "A", emoji: "x" }, { id: "b", title: "B", subtitle: "Two", emoji: "y" }];`;
    expect(readRegistryTitles(text)).toEqual({ a: "A", b: "B: Two" });
  });

  it("an entry without a subtitle yields the title alone; a blank subtitle too", () => {
    const text = `export const REGISTRY = [
      { id: "a", title: "A", emoji: "x", status: "playable" },
      { id: "b", title: "B", subtitle: "  ", emoji: "y" },
    ];`;
    expect(readRegistryTitles(text)).toEqual({ a: "A", b: "B" });
  });

  it("a registry that parses to zero entries throws rather than building zero pages green", () => {
    expect(() => readRegistryTitles("export const REGISTRY = [];")).toThrow(/no games/i);
    expect(() => readRegistryTitles("nothing here")).toThrow(/no games/i);
  });

  it("the page list build.mjs emits is exactly the registry's ids, in registry order", () => {
    expect(GAME_PAGES(source)).toEqual(REGISTRY.map((e) => e.id));
  });
});
