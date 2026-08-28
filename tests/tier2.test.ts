//! Tier-2 honest-representation banner. A wrapped (Tier-2) game carries no
//! verifiable outcome record, and the shelf must say so — a persistent banner
//! plus attribution (author, license, upstream source). A Tier-1 game shows
//! nothing. The builder is pure DOM so it is unit-testable without booting the
//! whole chrome; the live wiring through `/<id>/` is asserted by the Astray E2E.

import { describe, expect, it } from "vitest";

import type { GameEntry } from "../src/contract.js";
import { wrappedBanner } from "../src/wrapped-banner.js";

function tier2Entry(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: "example-wrap",
    title: "Astray",
    emoji: "🔮",
    status: "playable",
    tier: 2,
    attribution: {
      author: "wwwtyro",
      license: "The Unlicense",
      upstreamUrl: "https://github.com/wwwtyro/Astray",
    },
    ...overrides,
  } as GameEntry;
}

function tier1Entry(): GameEntry {
  return { id: "solitaire", title: "Solitaire", emoji: "♠", status: "playable" };
}

describe("wrappedBanner (Tier-2 honest representation)", () => {
  it("renders a 'no verifiable record' banner for a Tier-2 game", () => {
    const banner = wrappedBanner(tier2Entry());
    expect(banner).not.toBeNull();
    expect(banner!.className).toContain("wrapped-banner");
    // States plainly that there is no verifiable record.
    expect(banner!.textContent?.toLowerCase()).toContain("no verifiable record");
    // Is announced to assistive tech as an informational note.
    expect(banner!.getAttribute("role")).toBe("note");
  });

  it("pays homage: credits the developer with thanks and links to the original", () => {
    const banner = wrappedBanner(tier2Entry())!;
    expect(banner.textContent).toContain("wwwtyro");
    expect(banner.textContent).toContain("The Unlicense");
    // A genuine acknowledgment, not a terse legal line.
    expect(banner.textContent?.toLowerCase()).toContain("with thanks");
    const link = banner.querySelector("a");
    expect(link?.textContent?.toLowerCase()).toContain("view the original");
    expect(link?.getAttribute("href")).toBe("https://github.com/wwwtyro/Astray");
    // External source link opens safely.
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("acknowledges the work it descends from when `basedOn` is set", () => {
    const banner = wrappedBanner(
      tier2Entry({
        attribution: {
          author: "ellisonleao",
          license: "GPL-3.0",
          upstreamUrl: "https://github.com/ellisonleao/clumsy-bird",
          basedOn: "Flappy Bird by Dong Nguyen",
        },
      }),
    )!;
    expect(banner.textContent).toContain("homage to Flappy Bird by Dong Nguyen");
  });

  it("renders nothing for a Tier-1 (verifiable, Croft-native) game", () => {
    expect(wrappedBanner(tier1Entry())).toBeNull();
  });
});
