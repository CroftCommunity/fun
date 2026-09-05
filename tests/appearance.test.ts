//! M5 — the picker. Two family rows in the settings sheet; the ☾/☀ control keeps
//! its place in the header and chooses the side within whichever family is
//! active. Same shape forage landed on after trying skin-rows: the picker's unit
//! is a FAMILY, because listing four skins would present the palette twice —
//! once in the picker, once in the toggle — and invite the misreading that
//! light/dark came back as a second axis.

import { describe, expect, it } from "vitest";

import { appearanceSpec } from "../src/appearance.js";
import { FAMILIES } from "../src/skins.js";
import { LAYOUT_KEY, LAYOUTS } from "../src/shelf.js";

import type { ChoiceRow, SettingRow } from "../src/settings-sheet.js";

/** Narrow to the choice row with this id, so `onChange` has a string parameter. */
function choice(rows: readonly SettingRow[], id: string): ChoiceRow {
  const row = rows.find((r) => r.id === id);
  if (!row || row.kind !== "choice") throw new Error(`no choice row '${id}'`);
  return row;
}

function specFor(skin: string, layout: string | null) {
  const chosen: Record<string, string> = {};
  return {
    spec: appearanceSpec({
      skin,
      layout,
      onSkin: (id) => (chosen["skin"] = id),
      onLayout: (id) => (chosen["layout"] = id),
    }),
    chosen,
  };
}

describe("the picker lists families, not skins", () => {
  const { spec } = specFor("worlds-dark", null);
  const style = choice(spec.rows, "style");

  it("offers one row per family", () => {
    expect(style.options.map((o) => o.value)).toEqual(Object.keys(FAMILIES));
  });

  it("labels each family without a palette word — the label must read for both sides", () => {
    const labels = style.options.map((o) => o.label);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/light|dark|day|night/i);
  });

  it("marks the running family as selected, whichever side is showing", () => {
    for (const skin of ["worlds-light", "worlds-dark"]) {
      expect(choice(specFor(skin, null).spec.rows, "style").value).toBe("worlds");
    }
  });
});

describe("choosing a family keeps the side you are on", () => {
  it("switching family from a dark skin lands on that family's dark skin", () => {
    const { spec, chosen } = specFor("worlds-dark", null);
    choice(spec.rows, "style").onChange("pond");
    expect(chosen["skin"]).toBe("pond-dark");
  });

  it("and from a light skin lands on that family's light skin", () => {
    const { spec, chosen } = specFor("pond-light", null);
    choice(spec.rows, "style").onChange("worlds");
    expect(chosen["skin"]).toBe("worlds-light");
  });
});

describe("the layout row makes the preference reachable", () => {
  it("offers every layout the app ships, plus following the style's suggestion", () => {
    const { spec } = specFor("worlds-dark", null);
    expect(choice(spec.rows, "layout").options.map((o) => o.value)).toEqual([
      "",
      ...Object.keys(LAYOUTS),
    ]);
  });

  it("defaults to following the style when nothing is stored", () => {
    expect(choice(specFor("worlds-dark", null).spec.rows, "layout").value).toBe("");
  });

  it("shows an explicit choice as chosen, so the override is visible", () => {
    expect(choice(specFor("worlds-dark", "shelf").spec.rows, "layout").value).toBe("shelf");
  });

  it("reports the empty choice back, so the caller can clear the override", () => {
    const { spec, chosen } = specFor("worlds-dark", "shelf");
    choice(spec.rows, "layout").onChange("");
    expect(chosen["layout"]).toBe("");
  });

  it("names the key the override is stored under", () => {
    expect(LAYOUT_KEY).toBe("fun-layout");
  });
});

// ---------------------------------------------------------------------------
// Music (pure parts). The runtime is deliberately best-effort and silent, so
// what is worth asserting is the selection and the default — a track that
// starts uninvited, or a page that fetches ~2MB from a visitor who never asked
// for sound, are the two failures that matter.
// ---------------------------------------------------------------------------

import { SHELF_TRACK, TRACKS, isLoop, resolveMusic, trackFor, trackUrl } from "../src/music.js";

describe("music selection", () => {
  it("is OFF unless explicitly turned on — never starts uninvited", () => {
    expect(resolveMusic(null)).toBe(false);
    expect(resolveMusic("")).toBe(false);
    expect(resolveMusic("yes")).toBe(false);
    expect(resolveMusic("on")).toBe(true);
  });

  it("gives the shelf its own bed when no game is mounted", () => {
    expect(trackFor(null)).toBe(SHELF_TRACK);
  });

  it("gives a game the track it names", () => {
    expect(trackFor("trio-tumble")).toBe("gateway-to-the-spire");
    expect(trackFor("solitaire")).toBe("sunset-at-the-harbor");
    // Owner, 2026-09-05 (mock F, Q9): Mahjong had named nothing and played the
    // shelf's bed, Morning Miles — "not country". It names the nocturne.
    expect(trackFor("mahjong")).toBe("porch-light-nocturne");
  });

  it("falls back to the shelf bed for a game that names nothing", () => {
    expect(trackFor("placeholder")).toBe(SHELF_TRACK);
    expect(trackFor("not-a-game")).toBe(SHELF_TRACK);
  });

  it("every named default is a track that exists", () => {
    const ids = new Set(TRACKS.map((t) => t.id));
    for (const t of TRACKS) expect(ids.has(trackFor(t.id) )).toBe(true);
    expect(ids.has(SHELF_TRACK)).toBe(true);
  });

  it("loops loop and pieces do not — a 3-minute track restarting is not ambience", () => {
    expect(isLoop(SHELF_TRACK)).toBe(true);
    expect(isLoop("sunset-at-the-harbor")).toBe(false);
  });

  it("resolves to the shelf-level audio path, not a per-game one", () => {
    expect(trackUrl("morning-miles")).toBe("/assets/audio/morning-miles.mp3");
  });
});
