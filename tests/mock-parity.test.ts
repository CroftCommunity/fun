//! The build must match the mock — and "match" has to be checkable, or it decays
//! into a feeling. Owner, 2026-08-29: "sometimes our plans have not quite matched
//! our mocks so let's build in protections to verify it looks and behaves like
//! the mock".
//!
//! A mock that wants this ships a `<mock>.claims.json` beside it: every promise
//! the drawing makes, each naming the exact title of the spec that proves it
//! and the phase that builds it. This test binds the three documents:
//!
//!   plan Status line ──declares phases COMPLETE──▶ claims of those phases
//!   claims ───────────name a spec title──────────▶ must exist in tests/
//!   claims ───────────quote timings (ms) ────────▶ must appear in the mock's text
//!
//! So a phase cannot be called complete while a claim it owns has no spec, and
//! the numbers in the claims cannot drift from the numbers on the mock page.
//! What it cannot do is judge whether a spec is a GOOD proof — that is review;
//! this is the guard that the proof was written and is wired.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Claim {
  readonly id: string;
  readonly proposal: number;
  readonly phase: string;
  readonly kind: "structure" | "measure" | "behaviour" | "look";
  readonly claim: string;
  readonly spec: string;
}
interface ClaimsFile {
  readonly mock: string;
  readonly mockVersion: number;
  readonly plan: string;
  readonly claims: readonly Claim[];
}

/**
 * The phases a plan's `**Status:**` line declares COMPLETE. Pure. Accepts the
 * shapes plans here actually use: "Phase A COMPLETE", "Phases A–C COMPLETE",
 * "Phases A, B COMPLETE", "A1–A3 COMPLETE" (a sub-phase completes nothing on
 * its own — only a whole letter counts). Case-insensitive on COMPLETE.
 */
export function completedPhases(status: string): ReadonlySet<string> {
  const out = new Set<string>();
  const re = /phases?\s+([A-Z](?:\s*[–,-]\s*[A-Z])*)\s+complete/gi;
  for (const m of status.matchAll(re)) {
    const spec = m[1]!.toUpperCase();
    const range = spec.match(/^([A-Z])\s*[–-]\s*([A-Z])$/);
    if (range) {
      for (let c = range[1]!.charCodeAt(0); c <= range[2]!.charCodeAt(0); c++) out.add(String.fromCharCode(c));
      continue;
    }
    for (const p of spec.split(/\s*,\s*/)) if (/^[A-Z]$/.test(p)) out.add(p);
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every `test("…")` / `it("…")` title in tests/. */
function specTitles(): Set<string> {
  const titles = new Set<string>();
  for (const file of walk("tests").filter((f) => /\.(spec|test)\.ts$/.test(f))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\b(?:test|it)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) titles.add(m[2]!);
  }
  return titles;
}

function claimsFiles(): string[] {
  return walk("mocks").filter((f) => f.endsWith(".claims.json"));
}

describe("completedPhases — the plan's Status line", () => {
  it("reads single, ranged and listed phases, and ignores sub-phases", () => {
    expect([...completedPhases("**Status:** Phase A COMPLETE (2026-09-01)")]).toEqual(["A"]);
    expect([...completedPhases("**Status:** Phases A–C COMPLETE; D in progress")]).toEqual(["A", "B", "C"]);
    expect([...completedPhases("Phases A, B complete")]).toEqual(["A", "B"]);
    expect([...completedPhases("**Status:** A1–A3 COMPLETE")]).toEqual([]);
    expect([...completedPhases("**Status:** DECIDED — phases not started")]).toEqual([]);
  });
});

describe("every mock with a claims file", () => {
  const files = claimsFiles();
  it("exists — a parity contract is expected for a mock that will be built", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as ClaimsFile;
    const mockHtml = readFileSync(doc.mock, "utf8");
    const plan = readFileSync(doc.plan, "utf8");
    const statusLine = plan.split("\n").find((l) => l.startsWith("**Status:**")) ?? "";

    describe(file, () => {
      it("is well-formed: unique ids, unique spec titles, known kinds and phases", () => {
        const ids = doc.claims.map((c) => c.id);
        expect(new Set(ids).size, "duplicate claim id").toBe(ids.length);
        const specs = doc.claims.map((c) => c.spec);
        expect(new Set(specs).size, "two claims share a spec title").toBe(specs.length);
        for (const c of doc.claims) {
          expect(["structure", "measure", "behaviour", "look"]).toContain(c.kind);
          expect(c.phase).toMatch(/^[A-Z]$/);
          expect(c.spec.startsWith(`mock ${c.id}:`), `${c.id}: spec title must start with "mock ${c.id}:"`).toBe(true);
        }
      });

      it("names the mock version the mock actually carries", () => {
        const v = mockHtml.match(/<meta name="mock-version" content="(\d+)"/)?.[1];
        expect(Number(v), "mockVersion must equal the mock's <meta mock-version>").toBe(doc.mockVersion);
      });

      it("quotes timings the mock page itself states (no drift between the two)", () => {
        for (const c of doc.claims) {
          for (const ms of c.claim.match(/\b\d+ms\b/g) ?? []) {
            expect(mockHtml.includes(ms), `${c.id} says ${ms}; the mock page does not`).toBe(true);
          }
        }
      });

      it("has a wired spec for every claim of a phase the plan calls COMPLETE", () => {
        const done = completedPhases(statusLine);
        const titles = specTitles();
        const owed = doc.claims.filter((c) => done.has(c.phase) && !titles.has(c.spec));
        expect(
          owed.map((c) => `${c.id} (phase ${c.phase}) needs a test titled "${c.spec}"`),
          `plan Status declares phases ${[...done].join(", ") || "(none)"} complete`,
        ).toEqual([]);
      });
    });
  }
});
