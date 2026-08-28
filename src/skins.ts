//! The skin layer's foundation: which tokens a skin may assign, and the scan
//! that enforces it.
//!
//! `tokens.css` declares two regions, marked in the file itself so there is one
//! home for the fact rather than a list here that drifts from it:
//!
//! - **SKINNABLE — chrome roles.** Page, surface, ink, accent, border, focus,
//!   type and shape. A skin may assign these and nothing else.
//! - **GAME-OWNED.** Board surfaces and every per-game palette. A skin may
//!   never touch them. `tokens.css` says of Align's palette that it is
//!   "deliberately NOT the guideline shape-to-colour mapping (IP guardrail)",
//!   and the shaped palettes (Wyrdle, dots, furrow, colour-sort) are
//!   colour-blind-safety commitments where the glyph carries the meaning and
//!   the hue is only the second signal. A skin able to repaint those walks
//!   straight back into what those comments exist to prevent.
//!
//! This mirrors forage's `skinScan` (`forage/js/skins.js`) on purpose —
//! independent implementation, shared contract (skin-layer plan, D4) — and adds
//! one violation class forage has no need for: a *declared but game-owned*
//! token is its own error rather than merely "undeclared", because that
//! difference is exactly the guardrail.

/** Custom-property names, grouped by whether a skin may assign them. */
export interface TokenGroups {
  /** Chrome roles: a skin may assign these. */
  readonly chrome: ReadonlySet<string>;
  /** Game-owned tokens: a skin may never assign these. */
  readonly game: ReadonlySet<string>;
  /**
   * Tokens declared outside both marked regions. Always empty in a healthy
   * `tokens.css`, and asserted so by the suite — an unclassified token silently
   * behaves as "not skinnable", which is a decision nobody made.
   */
  readonly unclassified: ReadonlySet<string>;
}

/** The outcome of scanning one skin stylesheet. */
export interface ScanResult {
  /** True when the sheet assigns only chrome roles. */
  readonly ok: boolean;
  /** One named violation per offending declaration, in source order. */
  readonly violations: readonly string[];
}

const CHROME_MARKER = "SKINNABLE";
const GAME_MARKER = "GAME-OWNED";

type Region = "chrome" | "game" | "unclassified";

/**
 * Read the token groups out of `tokens.css`.
 *
 * Walks the sheet with a comment-aware state machine rather than stripping
 * comments first, because the region markers *are* comments — strip them and
 * the grouping information goes with them.
 */
export function declaredTokenGroups(cssText: string): TokenGroups {
  const chrome = new Set<string>();
  const game = new Set<string>();
  const unclassified = new Set<string>();
  const bucket: Record<Region, Set<string>> = { chrome, game, unclassified };

  let region: Region = "unclassified";
  let i = 0;
  let plain = "";
  const flush = (): void => {
    for (const m of plain.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
      bucket[region].add(m[1] as string);
    }
    plain = "";
  };

  while (i < cssText.length) {
    const open = cssText.indexOf("/*", i);
    if (open === -1) {
      plain += cssText.slice(i);
      break;
    }
    plain += cssText.slice(i, open);
    const close = cssText.indexOf("*/", open + 2);
    const end = close === -1 ? cssText.length : close + 2;
    const comment = cssText.slice(open, end);
    // A marker ends the run of declarations that belonged to the previous
    // region, so drain before switching.
    if (comment.includes(CHROME_MARKER) || comment.includes(GAME_MARKER)) {
      flush();
      region = comment.includes(CHROME_MARKER) ? "chrome" : "game";
    }
    i = end;
  }
  flush();

  return { chrome, game, unclassified };
}

/**
 * Scan a skin stylesheet. A skin may only **assign declared chrome roles**;
 * every other declaration is a named violation.
 *
 * Three classes, deliberately distinct so an author can tell what they did:
 * a smuggled component property (the class that could hide a surface — an
 * attribution banner on a Tier-2 wrap, say), an undeclared token (a typo), and
 * a game-owned token (the guardrail, where the token exists and is off-limits).
 */
export function skinScan(cssText: string, groups: TokenGroups): ScanResult {
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const violations: string[] = [];
  for (const block of clean.matchAll(/\{([^}]*)\}/g)) {
    for (const decl of (block[1] as string).split(";")) {
      const d = decl.trim();
      if (!d) continue;
      const colon = d.indexOf(":");
      if (colon === -1) continue;
      const prop = d.slice(0, colon).trim();
      if (!prop) continue;
      if (!prop.startsWith("--")) violations.push(`component property smuggled: ${prop}`);
      else if (groups.chrome.has(prop)) continue;
      else if (groups.game.has(prop)) violations.push(`game-owned token, not skinnable: ${prop}`);
      else violations.push(`undeclared token: ${prop}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
