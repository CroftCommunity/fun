// Reads the game registry out of `src/registry.ts` as TEXT, for `build.mjs`.
//
// build.mjs is plain Node and cannot import the TS registry, so — like
// `tools/skin-init.mjs` does for `src/skins.ts` — it derives what it needs from
// the source and `tests/page-titles.test.ts` pins the derivation against the
// real module. Two things come out: every game's display name (the page
// `<title>`), and the page list itself, which used to be a hand-kept array in
// build.mjs that nothing checked against the registry.
//
// Each entry is parsed AS A UNIT (one `{ … }` object at a time), never as
// parallel lists of ids and titles zipped by index — `gameAliases()` once did
// that and mis-paired them (TODO/README.md, 2026-08-28).

/** The registry's array body, from `export const REGISTRY` to its closing `];`. */
function registryBlock(source) {
  const start = source.indexOf("export const REGISTRY");
  if (start < 0) return "";
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open < 0 || close < 0) return "";
  return source.slice(open + 1, close);
}

/** Each top-level `{ … }` object in the array body, as text. Comments are stripped first. */
function entryTexts(block) {
  const noComments = block.replace(/\/\/[^\n]*/g, "");
  const out = [];
  let depth = 0;
  let begin = -1;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === "{") {
      if (depth === 0) begin = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && begin >= 0) {
        out.push(noComments.slice(begin, i + 1));
        begin = -1;
      }
    }
  }
  return out;
}

function field(entry, name) {
  const m = entry.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`));
  return m ? m[1] : undefined;
}

/** Every registry entry as `{ id, name }`, in registry ORDER — an array, because a
 *  plain object would hoist "2048" to the front (integer-like keys sort first). */
export function readRegistryEntries(source) {
  const entries = [];
  for (const entry of entryTexts(registryBlock(source))) {
    const id = field(entry, "id");
    const title = field(entry, "title");
    if (!id || !title) continue;
    const sub = field(entry, "subtitle")?.trim();
    entries.push({ id, name: sub ? `${title}: ${sub}` : title });
  }
  if (entries.length === 0) {
    throw new Error("registry-titles: no games parsed from src/registry.ts — the registry shape changed");
  }
  return entries;
}

/** `{ id: displayName }` for every registry entry. Throws on zero. */
export function readRegistryTitles(source) {
  return Object.fromEntries(readRegistryEntries(source).map((e) => [e.id, e.name]));
}

/** The registry's ids, in registry order — the pages build.mjs emits. */
export function GAME_PAGES(source) {
  return readRegistryEntries(source).map((e) => e.id);
}
