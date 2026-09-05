//! The frame owns every control surface now (plan 2026-08-30, Phase 22). The classes
//! the games used to render their own bars with must not come back — in a module or
//! in `styles.css` — because a rule with no caller is where the next "why is this
//! here" starts. `.crib-turnbar` is the one survivor: it is the final table's
//! scoreline on the result and shared screens, not a control row.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RETIRED_IN_SRC = ["sol-controls", "sol-settings", "sol-modes", '"sol-setting"', "wrapped-banner", "wrapped-game-frame"];
const RETIRED_IN_CSS = [".sol-controls", ".sol-settings", ".sol-setting ", ".sol-modes", ".wrapped-", ".drop4-player", ".al-range", ".cs-actions", ".t48-hud", ".bub-variants", ".le-home"];
const TURNBAR_ALLOWED = new Set([".crib-turnbar"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("the retired control-surface classes", () => {
  it("appear in no module under src/", () => {
    const hits = walk("src").flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return RETIRED_IN_SRC.filter((c) => text.includes(c)).map((c) => `${f}: ${c}`);
    });
    expect(hits).toEqual([]);
  });

  it("have no rule left in styles.css, and the only *-turnbar rule is Cribbage's final scoreline", () => {
    const css = readFileSync("styles.css", "utf8");
    expect(RETIRED_IN_CSS.filter((c) => css.includes(c))).toEqual([]);
    const turnbars = [...css.matchAll(/\.[a-z0-9-]+-turnbar\b/g)].map((m) => m[0]);
    expect([...new Set(turnbars)].filter((c) => !TURNBAR_ALLOWED.has(c))).toEqual([]);
    expect(css).not.toMatch(/\.[a-z0-9-]+-banner\b/);
  });
});

describe("the stylesheet's braces balance", () => {
  // A rebase on 2026-08-30 kept two games' appended blocks but lost the one
  // shared closing brace between them, so every chess rule sat inside mahjong's
  // reduced-motion media query and applied nowhere. The browser suite caught it
  // (24px squares); this catches it in the unit stage, a stage earlier.
  it("styles.css opens exactly as many blocks as it closes (outside comments and strings)", () => {
    const css = readFileSync("styles.css", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
    const open = (css.match(/\{/g) ?? []).length;
    const close = (css.match(/\}/g) ?? []).length;
    expect(close, `styles.css: ${open} '{' vs ${close} '}'`).toBe(open);
  });

  // The same rebase left a bare `=======` line above Orchard Drop's rules. A
  // marker has no braces, so the test above passed; the browser parsed
  // `======= /* … */ .orch-surface` as one invalid selector and dropped the
  // whole rule — the crate sat at the left edge of every desktop stage for five
  // days (mock F2.4 measured it: crate centre 237 in a stage centred at 500).
  it("styles.css and tokens.css carry no merge-conflict markers", () => {
    for (const file of ["styles.css", "tokens.css"]) {
      const lines = readFileSync(file, "utf8").split("\n");
      const markers = lines.map((l, i) => (/^(<{7}|={7}|>{7})(\s|$)/.test(l) ? i + 1 : 0)).filter(Boolean);
      expect(markers, `${file}: conflict markers at lines ${markers.join(", ")}`).toEqual([]);
    }
  });
});
