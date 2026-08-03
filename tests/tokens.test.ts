//! Token discipline (Phase E), mirroring croft-pwa: `tokens.css` is the ONLY
//! file that may hold raw hex, and every text/UI colour pair must clear WCAG AA
//! in BOTH themes. The ratios are load-bearing — a future colour tweak that
//! breaks a floor fails the gate rather than shipping an illegible surface.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from the repo root (vitest's cwd) rather than import.meta.url, which
// the transform can rebase away from the real file.
function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe("hex is confined to tokens.css", () => {
  it("styles.css references semantic tokens only (no raw hex)", () => {
    expect(read("styles.css").match(HEX) ?? []).toEqual([]);
  });

  it("tokens.css is where the palette lives", () => {
    expect((read("tokens.css").match(HEX) ?? []).length).toBeGreaterThan(10);
  });
});

function relLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = read("tokens.css");

function scope(name: "light" | "dark"): Record<string, string> {
  const marker = '[data-theme="dark"]';
  const block =
    name === "light" ? css.slice(css.indexOf(":root"), css.indexOf(marker)) : css.slice(css.indexOf(marker));
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map[m[1] as string] = m[2] as string;
  }
  return map;
}

// [foreground token, background token, floor]
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ["ink", "bg", 4.5],
  ["ink-muted", "bg", 4.5],
  ["ink", "surface", 4.5],
  ["ink-muted", "surface", 4.5],
  ["link", "bg", 4.5],
  ["accent-ink", "accent", 4.5],
  ["active-ink", "active", 4.5],
  ["danger-ink", "danger", 4.5],
  ["danger", "surface", 4.5],
  ["suit-red", "card", 4.5],
  ["suit-black", "card", 4.5],
  ["felt-ink", "felt", 3], // labels/hints on the felt table — UI/large floor
  ["focus", "bg", 3], // focus ring is a UI indicator
  ["gem-0", "surface", 3], // match-3 gem glyphs on their tile — large-glyph floor
  ["gem-1", "surface", 3],
  ["gem-2", "surface", 3],
  ["gem-3", "surface", 3],
  ["gem-4", "surface", 3],
  ["gem-5", "surface", 3],
  ["wy-correct-ink", "wy-correct", 4.5], // Wyrdle tile letters on their state fill
  ["wy-present-ink", "wy-present", 4.5],
  ["wy-absent-ink", "wy-absent", 4.5],
  ["t48-lo-ink", "t48-lo", 3], // 2048 tile numerals (large + bold → large-glyph floor)
  ["t48-mid-ink", "t48-mid", 3],
  ["t48-hi-ink", "t48-hi", 3],
  ["t48-max-ink", "t48-max", 3],
  ["d4-x", "d4-slot", 3], // Drop 4 discs must read against the empty slot (UI floor)
  ["d4-o", "d4-slot", 3],
];

describe.each(["light", "dark"] as const)("tokens: %s theme clears WCAG AA", (name) => {
  const map = scope(name);
  it.each(PAIRS)("%s on %s ≥ %s:1", (fg, bg, floor) => {
    expect(map[fg], `missing --${fg} in ${name}`).toBeTruthy();
    expect(map[bg], `missing --${bg} in ${name}`).toBeTruthy();
    expect(ratio(map[fg] as string, map[bg] as string)).toBeGreaterThanOrEqual(floor);
  });
});
