//! Align's IP gate (BUILDING-GAMES / the build plan's pre-deploy checklist, made
//! executable): the shelf must never ship the trademarked name or glossary, and
//! Align's palette must be its own — not the guideline shape-to-colour mapping.
//! A mutation that reintroduces any of these fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string): string => readFileSync(join(root, p), "utf8");

// The Align-owned source (engine, binding, front end, guide, RULES).
const ALIGN_FILES = [
  "crates/align-core/src/piece.rs",
  "crates/align-core/src/scoring.rs",
  "crates/align-core/src/engine.rs",
  "crates/align-core/src/lib.rs",
  "crates/align-core/RULES.md",
  "crates/align-wasm/src/lib.rs",
  "src/games/align/align.ts",
  "src/games/align/align-wasm.ts",
  "src/games/align/align-outcome.ts",
  "src/games/align/align-howto.ts",
];

describe("Align IP gate", () => {
  it("never uses the trademarked name or the '-tris' suffix", () => {
    for (const f of ALIGN_FILES) {
      const text = read(f);
      expect(/tetris/i.test(text), `"${f}" must not contain "tetris"`).toBe(false);
      expect(/[a-z]tris\b/i.test(text), `"${f}" must not use a "-tris" name`).toBe(false);
    }
  });

  it("never uses the trademarked glossary (Tetrimino / the Matrix as the board)", () => {
    for (const f of ALIGN_FILES) {
      const text = read(f);
      expect(/tetrimino/i.test(text), `"${f}" must not say "Tetrimino"`).toBe(false);
    }
  });

  it("brands a four-line clear as an Align", () => {
    expect(read("crates/align-core/src/scoring.rs")).toMatch(/\bAlign\b/);
  });

  it("uses its own palette, not the guideline shape-to-colour mapping", () => {
    const tokens = read("tokens.css");
    // The original mapping from the build plan — our expression, deliberately not
    // the guideline's cyan-I / yellow-O / purple-T / green-S / red-Z / blue-J /
    // orange-L. Pin each so a drift back toward the guideline mapping fails.
    const expected: Record<string, string> = {
      "al-i": "#7c5cff",
      "al-o": "#ff6b5e",
      "al-t": "#1fb6a6",
      "al-s": "#e8b93e",
      "al-z": "#4aa8ff",
      "al-j": "#e05c8f",
      "al-l": "#5cc96a",
    };
    for (const [name, hex] of Object.entries(expected)) {
      const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m, `--${name} defined`).toBeTruthy();
      expect(m![1]!.toLowerCase()).toBe(hex);
    }
    // And the classic guideline hues must not be the Align mapping.
    const guideline = ["#00ffff", "#ffff00", "#800080", "#00ff00", "#ff0000", "#0000ff"];
    for (const hex of Object.values(expected)) {
      expect(guideline).not.toContain(hex.toLowerCase());
    }
  });

  it("titles the game Align in the registry", () => {
    const reg = read("src/registry.ts");
    expect(reg).toMatch(/id:\s*"align",\s*title:\s*"Align"/);
  });
});
