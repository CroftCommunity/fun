//! Every check must be reachable from the gate.
//!
//! **This exists because a harness ran nowhere for months.** `crates/xbuild`
//! backs `native == wasm` — a claim this shelf makes to its users — and it had
//! no npm script, no `tools/` caller and no CI reference. It existed, was
//! documented, and was executed by nothing. Writing this guard immediately found
//! a second one, `crates/solitaire-wasm/run.sh`, in the same state.
//!
//! A check nobody runs is worse than no check: it is a promise on the page and a
//! blank where the evidence should be. These tests make "unwired" a red board
//! rather than something you notice a year later while auditing something else.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

/** Every script `gate` reaches, transitively through `npm run`. */
function reachableFromGate(): Set<string> {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    const body = pkg.scripts[name];
    if (seen.has(name) || body === undefined) return;
    seen.add(name);
    for (const m of body.match(/npm run ([a-z:0-9-]+)/g) ?? []) {
      walk(m.replace("npm run ", ""));
    }
    // `pre<name>` runs automatically before `<name>` — reachability has to
    // follow npm's own semantics, not just the literal text of the command.
    walk(`pre${name}`);
  };
  walk("gate");
  return seen;
}

describe("every check is reachable from the gate", () => {
  it("runs every `test:*` script", () => {
    // The naming convention IS the declaration: a script named `test:*` claims
    // to check something, so it has to be reached. Tools (`serve`, `intake`,
    // `guide:shots`) make no such claim and are deliberately not required —
    // a guard that cannot tell a check from a tool becomes noise and gets
    // ignored, which is this same failure one level up.
    const checks = Object.keys(pkg.scripts).filter((s) => /^(test|check):/.test(s));
    expect(checks.length).toBeGreaterThan(0);
    const reached = reachableFromGate();
    const orphans = checks.filter((c) => !reached.has(c));
    expect(orphans, `these checks are not reachable from \`npm run gate\``).toEqual([]);
  });

  it("runs every check harness that exists as a script on disk", () => {
    // The npm-script guard above could not have caught `xbuild`: it had no
    // script at all. This is the guard that would have — a `run.sh` beside a
    // crate is a harness, and a harness nothing invokes is the failure that
    // started all of this.
    const harnesses = readdirSync("crates")
      .map((c) => join("crates", c, "run.sh"))
      .filter((p) => existsSync(p));
    expect(harnesses.length).toBeGreaterThan(0);

    const allScripts = Object.values(pkg.scripts).join("\n");
    const unreferenced = harnesses.filter((h) => !allScripts.includes(h));
    expect(
      unreferenced,
      "these harnesses exist and nothing runs them — wire them into a `test:*` script or delete them",
    ).toEqual([]);
  });

  it("resolves the toolchain through the pin, never a floating `stable`", () => {
    // Both unwired harnesses ALSO resolved `--toolchain stable`, floating free
    // of rust-toolchain.toml — the very pin a cross-build check exists to
    // validate. The two defects travel together because nothing ran either
    // script to notice.
    const scripts = readdirSync("crates")
      .map((c) => join("crates", c, "run.sh"))
      .filter((p) => existsSync(p))
      .concat(["tools/rust-gate.sh", "tools/build-wasm.sh"].filter(existsSync));
    // Match the INVOCATION, not the mention. The first draft of this test
    // flagged three scripts, two of which were comments *documenting* the fix —
    // a guard with a 2-in-3 false-positive rate gets muted, which is the failure
    // it exists to prevent.
    const floating = scripts.filter((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .some((line) => !line.trimStart().startsWith("#") && line.includes("--toolchain stable")),
    );
    expect(
      floating,
      "these resolve a floating `stable` instead of the pinned toolchain",
    ).toEqual([]);
  });
});
