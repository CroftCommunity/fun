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

// ---------------------------------------------------------------------------
// The registry: skins subsume themes.
//
// Light and dark are NOT an axis here. A FAMILY is one visual identity; a SKIN
// is exactly one palette within it; the ☾/☀ toggle swaps to the family's other
// side and is disabled where none exists. This is forage's model
// (`forage/docs/adr/0003-skins-subsume-themes.md`), adopted rather than
// re-derived — see the skin-layer plan's D4.
//
// The SIBLING IS DERIVED from family + palette and never declared. That makes
// asymmetric, dangling and self-paired registries structurally impossible
// rather than merely validated: there is no second place to write the
// relationship, so there is nothing to disagree with. Deriving introduces
// exactly one new class — two same-palette skins in one family — and
// `validateFamilies` is the guard for it.
//
// ONE DELIBERATE DIVERGENCE from forage, recorded because it looks like drift
// and is not. forage ships each skin as its own stylesheet behind a managed
// <link>, because it imports arbitrary phpBB styles and the set is unbounded.
// Ours is bounded and we have a build step, so every palette lives in
// `tokens.css` under a `[data-skin="…"]` selector, with the default's values on
// bare `:root`. The semantics D4 shares are untouched; only delivery differs,
// and this way a skin can never flash because there is no sheet to fetch.
// ---------------------------------------------------------------------------

/** A skin carries exactly one palette. */
export type Palette = "light" | "dark";

/** One visual identity, with up to two palettes. This is what the picker lists. */
export interface Family {
  /** Names the STYLE, and must read for both sides — no palette word. */
  readonly label: string;
  /**
   * The home layout this identity suggests (`src/shelf.ts` LAYOUTS). It is a
   * SUGGESTION: the user's explicit choice wins in both directions, and a skin
   * is never handed layout properties — it picks from what the app already
   * ships and the user can already reach.
   *
   * It lives HERE and not on the skin (plan D5). On the skin, two members of one
   * family could disagree, and a disagreement means the palette toggle silently
   * re-lays-out the page. One home deletes that class.
   */
  readonly prefersLayout?: string;
}

/** One palette within a family. */
export interface Skin {
  readonly label: string;
  readonly palette: Palette;
  readonly family: string;
}

type Families = Readonly<Record<string, Family>>;
type Skins = Readonly<Record<string, Skin>>;

/** Device-local preference key. Stores ONE concrete skin id, never a family. */
export const SKIN_KEY = "fun-skin";

/** The families the picker offers. */
export const FAMILIES: Families = Object.freeze({
  worlds: { label: "Gallery of Worlds", prefersLayout: "today-first" },
  pond: { label: "The Pond", prefersLayout: "shelf" },
});

/**
 * Every skin. Two families, each with both palettes first-class (owner
 * decision, 2026-08-27), so the palette toggle is never a dead control.
 * `worlds-light` is the default and its values live on bare `:root` in
 * `tokens.css`, so the common case matches no extra selector at all.
 */
export const SKINS: Skins = Object.freeze({
  "worlds-light": { label: "Gallery of Worlds (day)", palette: "light", family: "worlds" },
  "worlds-dark": { label: "Gallery of Worlds (night)", palette: "dark", family: "worlds" },
  "pond-light": { label: "The Pond (day)", palette: "light", family: "pond" },
  "pond-dark": { label: "The Pond (night)", palette: "dark", family: "pond" },
});

/**
 * The skin a fresh visitor with no OS preference lands on, and the one whose
 * values sit on bare `:root` in `tokens.css`. Gallery of Worlds is the default
 * family (owner, 2026-08-27); the OS preference picks the side through the
 * registry, so a dark-preferring visitor gets `worlds-dark` without that id
 * being hardcoded anywhere.
 */
export const DEFAULT_SKIN = "worlds-light";

/** The family a skin belongs to. Throws on an unknown SKIN id. */
export function familyOf(id: string, registry: Skins = SKINS): string {
  const skin = registry[id];
  if (!skin) throw new Error(`unknown skin id: ${id} (skin ids, not family ids)`);
  return skin.family;
}

/** Every skin id in a family, in registry order. Takes a FAMILY id. */
export function familyMembers(family: string, registry: Skins = SKINS): string[] {
  return Object.keys(registry).filter((id) => registry[id]!.family === family);
}

/** The member of `family` carrying `palette`, if there is one. Takes a FAMILY id. */
export function resolveInFamily(
  family: string,
  palette: Palette,
  registry: Skins = SKINS,
): string | undefined {
  return familyMembers(family, registry).find((id) => registry[id]!.palette === palette);
}

/**
 * The opposite-palette twin in the same family — derived, never declared.
 * `undefined` for a single-palette family, which is what disables the toggle.
 * That disabled state must stay visible: a user on a dark-only family cannot
 * reach light, and a dead-looking control is the honest way to say so.
 */
export function siblingOf(id: string, registry: Skins = SKINS): string | undefined {
  const skin = registry[id];
  if (!skin) return undefined;
  return resolveInFamily(skin.family, skin.palette === "dark" ? "light" : "dark", registry);
}

/**
 * The guard for the one failure class deriving cannot delete. Returns a list of
 * human-readable errors; empty means valid.
 */
export function validateFamilies(fams: Families = FAMILIES, registry: Skins = SKINS): string[] {
  const errors: string[] = [];
  for (const [id, skin] of Object.entries(registry)) {
    if (!fams[skin.family]) errors.push(`skin '${id}' names unknown family '${skin.family}'`);
  }
  for (const family of Object.keys(fams)) {
    const members = familyMembers(family, registry);
    if (members.length === 0) {
      errors.push(`family '${family}' has no skins`);
      continue;
    }
    for (const palette of ["light", "dark"] as const) {
      const same = members.filter((id) => registry[id]!.palette === palette);
      if (same.length > 1) {
        errors.push(`family '${family}' has two ${palette} skins: ${same.join(", ")}`);
      }
    }
  }
  return errors;
}

/**
 * Resolve the skin to apply. An explicit stored choice wins; otherwise the OS
 * preference resolves **through the registry** — the dark default is whatever
 * the default family pairs its default with, not a hardcoded id.
 *
 * A stored id that is no longer in the registry (a retired skin outliving its
 * entry in someone's `localStorage`) falls back rather than rendering unstyled.
 */
export function resolveSkin(
  stored: string | null,
  prefersDark: boolean,
  registry: Skins = SKINS,
): string {
  if (stored && registry[stored]) return stored;
  const family = registry[DEFAULT_SKIN]?.family ?? Object.values(registry)[0]?.family;
  if (family === undefined) return DEFAULT_SKIN;
  return (
    resolveInFamily(family, prefersDark ? "dark" : "light", registry) ??
    resolveInFamily(family, prefersDark ? "light" : "dark", registry) ??
    DEFAULT_SKIN
  );
}

// ---------------------------------------------------------------------------
// The DOM side. Storage and attribute glue — each repo owns its own (plan D4),
// which is why none of it is shared with forage.
// ---------------------------------------------------------------------------

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(SKIN_KEY);
  } catch {
    return null;
  }
}

function persist(id: string): void {
  try {
    localStorage.setItem(SKIN_KEY, id);
  } catch {
    // Private mode / storage denied: the DOM attribute still applies for the
    // session. A cosmetic preference degrades rather than failing loud.
  }
}

/**
 * Apply a skin to the document and keep the browser/manifest `theme-color` in
 * sync. `--theme-color` is a chrome role, so each skin sets its own.
 */
export function applySkin(id: string): void {
  document.documentElement.setAttribute("data-skin", id);
  const color = getComputedStyle(document.documentElement).getPropertyValue("--theme-color").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (color && meta) meta.setAttribute("content", color);
}

/** The running skin, read from the DOM (set pre-paint), else resolved fresh. */
export function currentSkin(): string {
  const attr = document.documentElement.getAttribute("data-skin");
  if (attr && SKINS[attr]) return attr;
  return resolveSkin(read(), prefersDark());
}

/** True when the running skin's palette is dark — what the ☾/☀ control reflects. */
export function isDark(): boolean {
  return SKINS[currentSkin()]?.palette === "dark";
}

/**
 * Swap to the family's other palette. Returns the running skin unchanged when
 * the family has no sibling — the control is disabled in that case, and a
 * silent no-op from a control that looks live is the thing this avoids.
 */
export function togglePalette(): string {
  const current = currentSkin();
  const next = siblingOf(current);
  if (next === undefined) return current;
  persist(next);
  applySkin(next);
  return next;
}

/** Choose a skin outright — what the settings picker calls. */
export function setSkin(id: string): string {
  if (!SKINS[id]) return currentSkin();
  persist(id);
  applySkin(id);
  return id;
}
