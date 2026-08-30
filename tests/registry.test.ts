//! What the site ships versus what the test runs mount. The placeholder is the
//! frame's own exercise (`src/games/placeholder.ts`) — one meter, one verb, a
//! controllable mount count — and the unit and e2e suites lean on it. It was also
//! the site's first drawer item and `/placeholder/` on fun.croft.ing, a dev
//! artifact a player could open. The catalog now has two halves: the shipped one
//! (`build.mjs` reads it as text for the page list) and the dev fixtures that ride
//! along only when `FUN_DEV_GAMES=1` — set by vitest and playwright, never by the
//! deploy build.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { catalog, REGISTRY, SHIPPED } from "../src/registry.js";
import { GAME_PAGES } from "../tools/registry-titles.mjs";

const ids = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id);

describe("the shipped catalog", () => {
  it("never carries the placeholder", () => {
    expect(ids(SHIPPED)).not.toContain("placeholder");
    expect(ids(catalog({ devGames: false }))).toEqual(ids(SHIPPED));
  });

  it("is what build.mjs emits pages for — so /placeholder/ does not exist on the site", () => {
    const source = readFileSync(join(process.cwd(), "src/registry.ts"), "utf8");
    expect(GAME_PAGES(source)).toEqual(ids(SHIPPED));
    expect(GAME_PAGES(source)).not.toContain("placeholder");
  });
});

describe("dev games", () => {
  it("get pages in a dev build — the e2e run drives /placeholder/ on a built dist", () => {
    const source = readFileSync(join(process.cwd(), "src/registry.ts"), "utf8");
    expect(GAME_PAGES(source, { devGames: true })).toEqual(ids(catalog({ devGames: true })));
    expect(GAME_PAGES(source)).toEqual(ids(SHIPPED));
  });

  it("are not in a production bundle at all — the module, not just the page", () => {
    // build.mjs substitutes process.env.FUN_DEV_GAMES with a literal, so the
    // dev branch must be one esbuild can fold away with its import.
    const source = readFileSync(join(process.cwd(), "src/registry.ts"), "utf8");
    expect(source).toMatch(/process\.env\.FUN_DEV_GAMES === "1" \? /);
  });

  it("ride along AFTER the shipped catalog, so the drawer's first item is a real game", () => {
    const dev = ids(catalog({ devGames: true }));
    expect(dev.slice(0, SHIPPED.length)).toEqual(ids(SHIPPED));
    expect(dev.at(-1)).toBe("placeholder");
  });

  it("are in this run's REGISTRY — the suites mount the placeholder through the real chrome", () => {
    expect(process.env.FUN_DEV_GAMES).toBe("1");
    expect(ids(REGISTRY)).toContain("placeholder");
  });
});
