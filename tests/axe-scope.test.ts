//! An axe scan must not silently grade less than it appears to.
//!
//! **Measured 2026-08-29**, because the two halves of axe's scoping API behave
//! differently and only one of them tells you when you are wrong:
//!
//! | | selector matches nothing |
//! |---|---|
//! | `.include(sel)` | **throws** — "No elements found for include in page Context" |
//! | `.exclude(sel)` | **silent** — scans everything, reports clean |
//!
//! So a broken `include` fails instantly and loudly, and a stale `exclude` sits
//! there for as long as nobody looks. One did: `tests/a11y-matrix.spec.ts`
//! excluded `iframe.wrapped-game-frame` for a day after the last iframe left the
//! shelf. It excluded nothing, reported the same green, and would have widened
//! the moment an iframe returned — grading a live surface as exempt because of a
//! rule written for something that no longer existed.
//!
//! This test is deliberately **vacuous today**: there are no exclusions left. It
//! exists so the next one has to justify itself at the moment it is written,
//! rather than a year later during an unrelated audit.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SPECS = readdirSync("tests")
  .filter((f) => f.endsWith(".spec.ts"))
  .map((f) => join("tests", f));

describe("axe scans grade what they claim to", () => {
  it("has specs to check", () => {
    expect(SPECS.length).toBeGreaterThan(10);
  });

  it("pairs every `.exclude()` with proof its target exists", () => {
    // An exclusion is a claim that something is present AND out of scope. The
    // first half is checkable and is exactly the half that rots.
    const offenders: string[] = [];
    for (const spec of SPECS) {
      const src = readFileSync(spec, "utf8");
      src.split("\n").forEach((line, i) => {
        const m = /\.exclude\((["'`])(.+?)\1\)/.exec(line);
        if (!m) return;
        // The guard: somewhere in the same file, assert the selector matches.
        // `toHaveCount(0)` does not count — that asserts the opposite.
        const selector = m[2] ?? "";
        const quoted = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const proves = new RegExp(
          `locator\\((['"\`])${quoted}\\1\\)[\\s\\S]{0,120}?(toBeVisible|toHaveCount\\(\\s*[1-9])`,
        ).test(src);
        if (!proves) {
          offenders.push(
            `${spec}:${i + 1} excludes "${selector}" without proving it is present`,
          );
        }
      });
    }
    expect(
      offenders,
      "axe's `.exclude()` is SILENT when its selector matches nothing — it then " +
        "grades everything while reading as scoped. Assert the target exists, or " +
        "drop the exclusion.",
    ).toEqual([]);
  });
});
