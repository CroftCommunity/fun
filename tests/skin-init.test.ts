//! The pre-paint boot script (M2). It stamps `[data-skin]` before first paint so
//! the page never flashes the wrong palette, and it CANNOT import the registry —
//! it is an inline `<head>` script with no module scope. So `tools/skin-init.mjs`
//! generates it from `src/skins.ts`, and these tests pin that derivation: if the
//! registry's shape drifts out from under the parser, this fails loudly rather
//! than silently emitting a script that stamps the wrong id.
//!
//! Same lesson as forage's href-by-convention pin, and the same reason: a boot
//! script that disagrees with the module it mirrors is a flash nobody can debug.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkins, skinInit } from "../tools/skin-init.mjs";
import { DEFAULT_SKIN, SKINS, resolveSkin } from "../src/skins.js";

const source = readFileSync(join(process.cwd(), "src/skins.ts"), "utf8");

describe("the generator reads the real registry", () => {
  it("parses every skin, with its palette and family", () => {
    expect(parseSkins(source)).toEqual(
      Object.fromEntries(
        Object.entries(SKINS).map(([id, s]) => [id, { palette: s.palette, family: s.family }]),
      ),
    );
  });

  it("fails loudly rather than emitting an empty id list", () => {
    // The failure that matters: a reformat the regex stops matching. Silently
    // emitting zero ids would make every stored preference look stale.
    expect(() => parseSkins("export const SKINS = Object.freeze({});")).toThrow(/no skins/i);
  });
});

describe("the emitted script mirrors resolveSkin", () => {
  const script = skinInit(source);

  it("names the storage key and stamps data-skin", () => {
    expect(script).toContain("fun-skin");
    expect(script).toContain("data-skin");
  });

  it("carries every skin id, so a stored choice is recognised", () => {
    for (const id of Object.keys(SKINS)) expect(script).toContain(id);
  });

  // Run the generated script against a stubbed document/localStorage and assert
  // it lands on exactly what resolveSkin would. This is the assertion that makes
  // the others worth having: the two paths agree on the actual answer, not just
  // on the strings they mention.
  function run(stored: string | null, prefersDark: boolean): string {
    let stamped = "";
    const sandbox = {
      localStorage: { getItem: () => stored },
      window: { matchMedia: () => ({ matches: prefersDark }) },
      document: { documentElement: { setAttribute: (_k: string, v: string) => (stamped = v) } },
    };
    new Function("localStorage", "window", "document", script)(
      sandbox.localStorage,
      sandbox.window,
      sandbox.document,
    );
    return stamped;
  }

  it.each([
    [null, false],
    [null, true],
    [DEFAULT_SKIN, true],
    ["table-dark", false],
    ["retired-skin", true],
    ["", false],
  ] as const)("stored=%s prefersDark=%s agrees with resolveSkin", (stored, dark) => {
    expect(run(stored, dark)).toBe(resolveSkin(stored, dark));
  });
});
