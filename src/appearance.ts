//! The appearance picker (M5): which identity the shelf wears, and which home
//! layout it uses.
//!
//! **The picker's unit is a FAMILY, not a skin.** Listing all four skins would
//! present the palette twice — once in the picker, once in the ☾/☀ control — and
//! invite the misreading that light and dark came back as a second axis. They did
//! not: one preference key still stores one concrete skin id, and every skin
//! still carries exactly one palette. forage reached the same conclusion after
//! shipping skin-rows first.
//!
//! Choosing a family **keeps the side you are on**: switching from a dark skin
//! lands on the new family's dark skin. Anything else would make the picker
//! silently flip your palette, which is the same class of surprise as a palette
//! toggle silently re-laying-out the page.
//!
//! Pure: it builds a spec and calls back. Storage and DOM live with the caller.

import type { SettingsSheetSpec } from "./settings-sheet.js";
import { FAMILIES, SKINS, resolveInFamily } from "./skins.js";
import { LAYOUTS, prefersLayoutFor } from "./shelf.js";
import { TRACKS } from "./music.js";

/** What the picker needs to know, and where its choices go. */
export interface AppearanceDeps {
  /** The track the player would play — its pick, or the page's own. */
  readonly track?: string;
  /** Whether music is currently on. */
  readonly music?: boolean;
  onMusic?(on: boolean): void;
  /** The running skin id. */
  readonly skin: string;
  /** The stored layout override, or null to follow the family's preference. */
  readonly layout: string | null;
  onSkin(id: string): void;
  /** An empty string clears the override and returns to following the style. */
  onLayout(id: string): void;
}

/** Build the appearance rows. */
export function appearanceSpec({
  skin,
  layout,
  onSkin,
  onLayout,
  track,
  music = false,
  onMusic,
}: AppearanceDeps): SettingsSheetSpec {
  const current = SKINS[skin];
  const palette = current?.palette ?? "light";
  const family = current?.family ?? "";
  const suggested = LAYOUTS[prefersLayoutFor(skin)]?.label ?? "";

  return {
    intro: "How the shelf looks, and what the home page opens on.",
    rows: [
      {
        kind: "choice",
        id: "style",
        label: "Style",
        hint: "The ☾/☀ control in the header picks the light or dark side of whichever style you choose.",
        value: family,
        options: Object.entries(FAMILIES).map(([id, f]) => ({ value: id, label: f.label })),
        onChange: (next) => {
          // Keep the side. Falling back to the family's other palette covers a
          // single-palette family without ever landing on nothing.
          const id =
            resolveInFamily(next, palette) ??
            resolveInFamily(next, palette === "dark" ? "light" : "dark");
          if (id) onSkin(id);
        },
      },
      {
        kind: "choice",
        id: "layout",
        label: "Home page",
        hint: "Each style suggests one. Your choice wins, and you can hand it back.",
        value: layout && LAYOUTS[layout] ? layout : "",
        options: [
          { value: "", label: `Follow the style`, hint: suggested ? `now: ${suggested}` : undefined },
          ...Object.entries(LAYOUTS).map(([id, l]) => ({ value: id, label: l.label })),
        ],
        onChange: onLayout,
      },
      {
        kind: "toggle",
        id: "music",
        label: "Music",
        // Named, because "Music" alone does not tell you that turning it on
        // fetches roughly a megabyte. Nothing is downloaded until it is on.
        hint: `Off by default. Turning it on plays ${
          TRACKS.find((t) => t.id === track)?.title ?? "a track"
        }, downloaded then and not before. The header's ▶ is the same switch.`,
        value: music,
        onChange: (on) => onMusic?.(on),
      },
    ],
  };
}
