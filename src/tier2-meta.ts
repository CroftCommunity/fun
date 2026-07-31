//! The Tier-2 game metadata schema + a fail-loud parser. Every wrapped game ships
//! a `tier2.meta.json` in its own directory recording PROVENANCE (upstream, ref,
//! license) and POSTURE (containment, egress, patches, and that it has no
//! verifiable record). This is the single source of truth: the registry's
//! attribution derives from it, the containment harness reads the posture, and a
//! gate test refuses a wrap whose meta is missing or malformed.
//!
//! Parsing is strict on purpose. A wrap is untrusted third-party code in our
//! chrome; if we can't say precisely where it came from and how it is contained,
//! it does not ship. Every check throws `Tier2MetaError` rather than coercing or
//! defaulting.

/** A single vendored-bundle modification, recorded honestly. */
export interface Tier2Patch {
  /** Path (within the game dir) of the file changed. */
  readonly file: string;
  /** What was changed. */
  readonly change: string;
  /** Why the change was necessary. */
  readonly reason: string;
}

/** Where the wrapped game came from and under what terms. */
export interface Tier2Provenance {
  /** Canonical upstream URL (repo or project home). */
  readonly upstreamUrl: string;
  /** The exact upstream point vendored, e.g. `master@abc1234` or a tag. */
  readonly upstreamRef: string;
  /** ISO date the bundle was retrieved. */
  readonly retrieved: string;
  /** Upstream author / project owner. */
  readonly author: string;
  /** License name (e.g. "MIT", "The Unlicense", "GPL-3.0"). */
  readonly license: string;
  /** Path (within the game dir) to the vendored license file, verbatim. */
  readonly licenseFile: string;
  /** The original work this game descends from, if any (homage/clone/port). */
  readonly basedOn?: string;
}

/** How the wrapped game is contained and what it may reach. */
export interface Tier2Posture {
  /** A wrap has no verifiable outcome record. Always `false`. */
  readonly verifiable: false;
  /** Containment mechanism, e.g. "iframe-sandbox". */
  readonly containment: string;
  /** The iframe `sandbox` attribute value, e.g. "allow-scripts". */
  readonly sandbox: string;
  /** Egress allowlist posture. Only "same-origin" is admissible. */
  readonly egress: "same-origin";
  /** Input model(s) the game uses, e.g. ["keyboard"], ["pointer","keyboard"]. */
  readonly input: readonly string[];
  /** Approximate vendored bundle size in KB (disclosed up front). */
  readonly approxSizeKb: number;
  /** Every modification made to the upstream bundle when vendoring. */
  readonly patches: readonly Tier2Patch[];
}

/** How the shelf represents the wrap honestly. */
export interface Tier2Representation {
  /** The banner claim shown to players (states there is no verifiable record). */
  readonly claim: string;
}

/** The full per-game Tier-2 metadata document. */
export interface Tier2Meta {
  readonly id: string;
  readonly tier: 2;
  readonly provenance: Tier2Provenance;
  readonly posture: Tier2Posture;
  readonly representation: Tier2Representation;
}

/** Thrown when a `tier2.meta.json` is missing a field or has a wrong value. */
export class Tier2MetaError extends Error {
  constructor(gameId: string, detail: string) {
    super(`tier2.meta.json for "${gameId}": ${detail}`);
    this.name = "Tier2MetaError";
  }
}

function obj(v: unknown, id: string, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Tier2MetaError(id, `${where} must be an object`);
  }
  return v as Record<string, unknown>;
}

function str(v: unknown, id: string, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Tier2MetaError(id, `${field} must be a non-empty string`);
  }
  return v;
}

/**
 * Parse and validate a raw `tier2.meta.json` value. Throws `Tier2MetaError` on
 * any missing or invalid field — nothing is defaulted or coerced.
 */
export function parseTier2Meta(raw: unknown, gameId: string): Tier2Meta {
  const root = obj(raw, gameId, "root");

  const id = str(root.id, gameId, "id");
  if (root.tier !== 2) throw new Tier2MetaError(gameId, "tier must be 2");

  const p = obj(root.provenance, gameId, "provenance");
  const provenance: Tier2Provenance = {
    upstreamUrl: str(p.upstreamUrl, gameId, "provenance.upstreamUrl"),
    upstreamRef: str(p.upstreamRef, gameId, "provenance.upstreamRef"),
    retrieved: str(p.retrieved, gameId, "provenance.retrieved"),
    author: str(p.author, gameId, "provenance.author"),
    license: str(p.license, gameId, "provenance.license"),
    licenseFile: str(p.licenseFile, gameId, "provenance.licenseFile"),
    ...(p.basedOn === undefined ? {} : { basedOn: str(p.basedOn, gameId, "provenance.basedOn") }),
  };

  const po = obj(root.posture, gameId, "posture");
  if (po.verifiable !== false) {
    throw new Tier2MetaError(gameId, "posture.verifiable must be false (a wrap is never verifiable)");
  }
  if (po.egress !== "same-origin") {
    throw new Tier2MetaError(gameId, 'posture.egress must be "same-origin"');
  }
  if (!Array.isArray(po.input) || po.input.length === 0) {
    throw new Tier2MetaError(gameId, "posture.input must be a non-empty array");
  }
  if (typeof po.approxSizeKb !== "number" || !Number.isFinite(po.approxSizeKb)) {
    throw new Tier2MetaError(gameId, "posture.approxSizeKb must be a number");
  }
  if (!Array.isArray(po.patches)) {
    throw new Tier2MetaError(gameId, "posture.patches must be an array (empty is fine)");
  }
  const patches: Tier2Patch[] = po.patches.map((raw, i) => {
    const pt = obj(raw, gameId, `posture.patches[${i}]`);
    return {
      file: str(pt.file, gameId, `posture.patches[${i}].file`),
      change: str(pt.change, gameId, `posture.patches[${i}].change`),
      reason: str(pt.reason, gameId, `posture.patches[${i}].reason`),
    };
  });
  const posture: Tier2Posture = {
    verifiable: false,
    containment: str(po.containment, gameId, "posture.containment"),
    sandbox: str(po.sandbox, gameId, "posture.sandbox"),
    egress: "same-origin",
    input: po.input.map((v, i) => str(v, gameId, `posture.input[${i}]`)),
    approxSizeKb: po.approxSizeKb,
    patches,
  };

  const r = obj(root.representation, gameId, "representation");
  const representation: Tier2Representation = {
    claim: str(r.claim, gameId, "representation.claim"),
  };

  return { id, tier: 2, provenance, posture, representation };
}
