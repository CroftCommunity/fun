// Generates the pre-paint boot script from `src/skins.ts`.
//
// The script is inlined into every page's <head> and stamps [data-skin] before
// first paint, so a palette never flashes. It cannot import the registry — it
// runs before any module does — so the ids are derived from the source here and
// `tests/skin-init.test.ts` pins the derivation against the real `SKINS`, plus
// runs the emitted script and asserts it lands where `resolveSkin` would.
//
// Why derive instead of hand-maintaining a second list: the boot script and the
// module have to agree on the answer, and two hand-kept lists are exactly the
// pair that drifts. forage pins its href-by-convention the same way, for the
// same reason.

/** Parse `SKINS` out of the module source. Throws rather than yielding nothing. */
export function parseSkins(source) {
  const entries = {};
  const block = source.slice(source.indexOf("export const SKINS"));
  const re = /"([^"]+)":\s*\{[^}]*?palette:\s*"(light|dark)"[^}]*?family:\s*"([^"]+)"/g;
  for (const m of block.matchAll(re)) {
    entries[m[1]] = { palette: m[2], family: m[3] };
  }
  if (Object.keys(entries).length === 0) {
    throw new Error("skin-init: no skins parsed from src/skins.ts — the registry shape changed");
  }
  return entries;
}

/** The default skin id, read from the module source. */
export function parseDefault(source) {
  const m = source.match(/export const DEFAULT_SKIN\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("skin-init: DEFAULT_SKIN not found in src/skins.ts");
  return m[1];
}

/**
 * The inline `<head>` script. Mirrors `resolveSkin`: an explicit stored id wins;
 * otherwise the OS preference resolves THROUGH the registry — the dark default
 * is whatever the default family pairs its default with, never a hardcoded id.
 */
export function skinInit(source) {
  const skins = parseSkins(source);
  const def = parseDefault(source);
  const family = skins[def]?.family ?? Object.values(skins)[0].family;
  const inFamily = (palette) =>
    Object.keys(skins).find((id) => skins[id].family === family && skins[id].palette === palette);
  const light = inFamily("light") ?? def;
  const dark = inFamily("dark") ?? light;
  const ids = JSON.stringify(Object.keys(skins));
  return (
    `(function(){try{var ids=${ids};var s=localStorage.getItem('fun-skin');` +
    `var d=ids.indexOf(s)>=0?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?` +
    `${JSON.stringify(dark)}:${JSON.stringify(light)});` +
    `document.documentElement.setAttribute('data-skin',d);}catch(e){}})();`
  );
}
