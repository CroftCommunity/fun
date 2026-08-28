//! The token split (M1 of the skin-layer plan) and the scan that enforces it.
//!
//! `tokens.css` declares two groups. **Chrome roles** are skinnable: a skin may
//! assign them and nothing else. **Game palettes** are game-owned and a skin may
//! never touch them — `tokens.css` says of Align's that it is "deliberately NOT
//! the guideline shape-to-colour mapping (IP guardrail)", and several others are
//! colour-blind-safety commitments where the shape carries the meaning and the
//! hue is only the second signal. A skin able to repaint those walks straight
//! back into what those comments exist to prevent.
//!
//! This mirrors forage's `skinScan` (`forage/js/skins.js`) deliberately —
//! independent implementation, shared contract (plan D4) — but adds a third
//! violation class forage has no need for: a *declared but game-owned* token is
//! its own error, not merely "undeclared", because the difference is exactly the
//! guardrail.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { declaredTokenGroups, skinScan } from "../src/skins.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const groups = declaredTokenGroups(read("tokens.css"));

describe("the token groups are declared in tokens.css", () => {
  it("chrome roles are skinnable", () => {
    for (const t of ["--bg", "--surface", "--ink", "--ink-muted", "--accent", "--border", "--focus"]) {
      expect(groups.chrome.has(t), `${t} should be a chrome role`).toBe(true);
    }
  });

  it("type and shape roles are skinnable — a skin must be able to change the voice", () => {
    for (const t of ["--font-display", "--font-body", "--radius"]) {
      expect(groups.chrome.has(t), `${t} should be a chrome role`).toBe(true);
    }
  });

  it("game palettes are NOT skinnable", () => {
    for (const t of ["--al-i", "--cs-c0", "--fur-board", "--dots-paper", "--gem-0", "--t48-lo", "--chk-dark"]) {
      expect(groups.game.has(t), `${t} should be game-owned`).toBe(true);
      expect(groups.chrome.has(t), `${t} must not be skinnable`).toBe(false);
    }
  });

  it("board surfaces are game-owned — a board is the game's own world", () => {
    for (const t of ["--felt", "--felt-ink", "--card", "--suit-red", "--suit-black"]) {
      expect(groups.game.has(t), `${t} should be game-owned`).toBe(true);
    }
  });

  it("every declared token lands in exactly one group", () => {
    // The guard that keeps the split honest as tokens are added: a new token
    // written outside both marked regions is unclassified, and unclassified
    // silently means "not skinnable" — a decision nobody made.
    expect([...groups.unclassified].sort()).toEqual([]);
  });

  // The two below are what make the assertion above mean something. Without
  // them, "unclassified is empty" is equally true of a parser that never fills
  // that bucket at all — the shape of green that hides a hole.
  it("a sheet with no region markers leaves every token unclassified", () => {
    const g = declaredTokenGroups(`:root { --a: #fff; --b: #000; }`);
    expect([...g.unclassified].sort()).toEqual(["--a", "--b"]);
    expect(g.chrome.size).toBe(0);
    expect(g.game.size).toBe(0);
  });

  it("a marker switches region mid-block, and only from that point on", () => {
    const g = declaredTokenGroups(
      `:root { /* SKINNABLE */ --a: #fff; /* GAME-OWNED */ --b: #000; /* SKINNABLE */ --c: #111; }`,
    );
    expect([...g.chrome].sort()).toEqual(["--a", "--c"]);
    expect([...g.game]).toEqual(["--b"]);
    expect(g.unclassified.size).toBe(0);
  });

  it("the two groups are disjoint", () => {
    const both = [...groups.chrome].filter((t) => groups.game.has(t));
    expect(both).toEqual([]);
  });
});

describe("skinScan: a skin restyles chrome and restructures nothing", () => {
  it("accepts a skin that assigns only chrome roles", () => {
    const skin = `:root { --bg: #101214; --ink: #f0f0f0; --radius: 2px; }`;
    expect(skinScan(skin, groups)).toEqual({ ok: true, violations: [] });
  });

  it("rejects a smuggled component property", () => {
    // The reason the restriction exists: a skin that can ship component CSS can
    // hide a surface. forage's doc makes the same argument about a moderation
    // notice; here it would be an attribution banner on a Tier-2 wrap.
    const skin = `:root { --bg: #101214; } .wrapped-banner { display: none; }`;
    const r = skinScan(skin, groups);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("component property smuggled: display");
  });

  it("rejects a token that tokens.css never declares", () => {
    const r = skinScan(`:root { --totally-made-up: #fff; }`, groups);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("undeclared token: --totally-made-up");
  });

  it("rejects a game-owned token by name, as its own violation class", () => {
    // The IP guardrail, made mechanical. Reported distinctly from "undeclared"
    // because a skin author needs to know the token exists and is off-limits,
    // not that they typo'd it.
    const r = skinScan(`:root { --al-i: #ff0000; }`, groups);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("game-owned token, not skinnable: --al-i");
  });

  it("reports every violation, not just the first", () => {
    const r = skinScan(`:root { --al-i: #f00; --nope: #f00; color: red; }`, groups);
    expect(r.violations).toHaveLength(3);
  });

  it("ignores comments, so a commented-out rule is not a violation", () => {
    const r = skinScan(`/* .x { display: none } */ :root { --bg: #101214; }`, groups);
    expect(r.ok).toBe(true);
  });
});
