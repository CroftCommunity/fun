//! Every Tier-2 wrapped game carries a `tier2.meta.json` in its own directory:
//! the single source of truth for its PROVENANCE (where it came from, under what
//! license) and its POSTURE (how it is contained, what it may reach, what we
//! patched, and that it has no verifiable record). The parser is fail-loud —
//! a wrap with a missing or malformed meta is a gate failure, not a silent gap.
//! A consistency check ties the registry's attribution back to the meta so the
//! two can never drift.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseTier2Meta } from "../src/tier2-meta.js";
import { REGISTRY } from "../src/registry.js";

function validRaw(): unknown {
  return {
    id: "astray",
    tier: 2,
    provenance: {
      upstreamUrl: "https://github.com/wwwtyro/Astray",
      upstreamRef: "master@abc1234",
      retrieved: "2026-07-31",
      author: "wwwtyro",
      license: "The Unlicense",
      licenseFile: "vendor/License.md",
    },
    posture: {
      verifiable: false,
      containment: "iframe-sandbox",
      sandbox: "allow-scripts",
      egress: "same-origin",
      input: ["keyboard"],
      approxSizeKb: 1400,
      patches: [
        {
          file: "vendor/index.html",
          change: "absolute texture paths /x.png -> relative",
          reason: "vendored under /astray/, not the domain root",
        },
      ],
    },
    representation: { claim: "Wrapped game — no verifiable record." },
  };
}

describe("parseTier2Meta (fail-loud)", () => {
  it("parses a complete, well-formed meta", () => {
    const meta = parseTier2Meta(validRaw(), "astray");
    expect(meta.id).toBe("astray");
    expect(meta.tier).toBe(2);
    expect(meta.provenance.license).toBe("The Unlicense");
    expect(meta.posture.verifiable).toBe(false);
    expect(meta.posture.patches[0]?.reason).toContain("vendored");
  });

  type MutableRaw = { provenance: Record<string, unknown>; posture: Record<string, unknown> };

  it("throws when a required provenance field is missing", () => {
    const raw = validRaw() as MutableRaw;
    delete raw.provenance.license;
    expect(() => parseTier2Meta(raw, "astray")).toThrow(/license/i);
  });

  it("throws when posture.verifiable is not false (a wrap is never verifiable)", () => {
    const raw = validRaw() as MutableRaw;
    raw.posture.verifiable = true;
    expect(() => parseTier2Meta(raw, "astray")).toThrow(/verifiable/i);
  });

  it("throws when the egress posture is not the same-origin allowlist", () => {
    const raw = validRaw() as MutableRaw;
    raw.posture.egress = "anywhere";
    expect(() => parseTier2Meta(raw, "astray")).toThrow(/egress/i);
  });
});

describe("Tier-2 registry ↔ meta consistency (the gate)", () => {
  const gamesDir = join(process.cwd(), "src", "games");

  it("every Tier-2 registry entry has a matching, consistent meta file", () => {
    const tier2 = REGISTRY.filter((g) => g.tier === 2);
    for (const entry of tier2) {
      const metaPath = join(gamesDir, entry.id, "tier2.meta.json");
      expect(existsSync(metaPath), `missing ${metaPath}`).toBe(true);
      const meta = parseTier2Meta(
        JSON.parse(readFileSync(metaPath, "utf8")),
        entry.id,
      );
      expect(meta.id).toBe(entry.id);
      // The registry's attribution derives from — and must equal — the meta.
      if (entry.tier === 2) {
        expect(entry.attribution.author).toBe(meta.provenance.author);
        expect(entry.attribution.license).toBe(meta.provenance.license);
        expect(entry.attribution.upstreamUrl).toBe(meta.provenance.upstreamUrl);
      }
    }
  });

  it("every tier2.meta.json on disk is valid and has a live registry entry", () => {
    if (!existsSync(gamesDir)) return;
    for (const name of readdirSync(gamesDir)) {
      const metaPath = join(gamesDir, name, "tier2.meta.json");
      if (!existsSync(metaPath)) continue;
      const meta = parseTier2Meta(JSON.parse(readFileSync(metaPath, "utf8")), name);
      const entry = REGISTRY.find((g) => g.id === meta.id);
      expect(entry, `no registry entry for meta ${meta.id}`).toBeTruthy();
      expect(entry!.tier).toBe(2);
    }
  });
});
