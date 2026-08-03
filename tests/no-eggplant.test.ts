//! Banned-emoji guard. The eggplant emoji (U+1F346) is not allowed anywhere in
//! the shelf's own source (it reads as innuendo, not produce). This scans the
//! hand-written source — TS, CSS, and the build/tool scripts — and fails if it
//! reappears, so the ban holds across every game's emoji usage, not just today's
//! fix. The banned glyph is referenced only via its \u escape below so the repo
//! carries no literal copy. Vendored third-party bundles under `**/vendor/` are
//! out of scope (not ours to edit).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EGGPLANT = "\u{1F346}"; // the banned eggplant emoji, by code point
const ROOTS = ["src", "tools", "tests"];
const FILES = ["styles.css", "tokens.css", "build.mjs"];

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "vendor" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(ts|mjs|js|css|html|json)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("banned emoji", () => {
  it("the eggplant emoji appears nowhere in the shelf's own source", async () => {
    const roots = await Promise.all(ROOTS.map(sourceFiles));
    const files = [...roots.flat(), ...FILES];
    const offenders: string[] = [];
    for (const f of files) {
      if ((await readFile(f, "utf8")).includes(EGGPLANT)) offenders.push(f);
    }
    expect(offenders, `eggplant found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
