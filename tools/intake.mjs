// intake.mjs — turn raw drops in assets/new/ into the assets the shelf uses.
//
//   npm run intake            dry run: say what would happen
//   npm run intake -- --go    do it
//
// The contract is in assets/new/README.md. In short: name a file after a game id
// and it becomes that game's cover or splash; drop an audio file and it becomes a
// shelf track. Per-game art lives with its game (CLAUDE.md § "Game isolation");
// audio is shelf-level because a track belongs to the shelf even when a game
// claims one by default.
//
// Tooling note: the installed `ffmpeg` is broken on this machine (missing
// libx265.215.dylib), so audio goes through macOS's `afconvert` to decode and
// `lame` to encode. Images go through `sips`, also built in. No new dependency.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DROP = join(root, "assets", "new");
const GO = process.argv.includes("--go");

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".aiff", ".flac"]);

/**
 * Audio target. 64 kbps CBR (owner, 2026-08-28). Measured on the real library:
 * a 2:57 track is 1.4 MB at 64k against 2.0 MB at 96k, taking the 16-track set
 * from 18.8 MB to about 12.6 MB. These are ambient beds played under a game at
 * 35% volume, which is what makes the trade cheap.
 *
 * Always re-encode from the MASTERS in `assets/new/`, never from a file already
 * in `assets/audio/` — re-encoding a lossy file is lossy twice.
 */
const AUDIO_KBPS = 64;

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
const dims = (f) => {
  const out = sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f]).toString();
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  return { w, h };
};

/**
 * Every way a drop may name a game: its registry id, and its slugified TITLE.
 * Read from the registry so the tool cannot drift from it.
 *
 * The title alias exists because the first real batch was named for the game as
 * a person says it — `dots_and_boxes_icon.png` for the game whose id is `dots`.
 * Demanding the internal id would be asking the drop-off to know the codebase.
 */
export function gameAliases() {
  const src = sh("cat", [join(root, "src", "registry.ts")]).toString();
  const body = src.slice(src.indexOf("export const REGISTRY"));
  // Read each entry AS A UNIT rather than collecting ids and titles into two
  // lists and zipping them by index. The zip was silently order-dependent, and
  // the first `subtitle:` in the registry broke it: `title:` matches inside the
  // word `subtitle`, so the titles list gained a phantom entry and every game
  // after it took its neighbour's name — `dots_and_boxes` resolved to `furrow`.
  // Matching within one object literal cannot drift that way.
  const ENTRY =
    /\bid:\s*"([^"]+)"[^}]*?\btitle:\s*"([^"]+)"(?:[^}]*?\bsubtitle:\s*"([^"]+)")?/g;
  const map = new Map();
  for (const [, id, title, subtitle] of body.matchAll(ENTRY)) {
    map.set(id, id);
    map.set(slug(title), id);
    // A game with a subtitle may also be dropped under its whole name, because
    // that is what the art itself says: `trio_tumble_jewel_drop_icon.png`.
    if (subtitle) map.set(slug(`${title} ${subtitle}`), id);
  }
  return map;
}

/**
 * Crop to `side`x`side` from the centre, biased for the source's aspect: a tall
 * source is cropped around 40% down (where a logo usually sits), a wide one dead
 * centre. Returns the box so the run can print it — a crop you cannot see is a
 * crop you cannot correct.
 */
function squareBox(w, h, focus) {
  const side = Math.min(w, h) === h ? Math.round(h * 0.95) : Math.round(w * 0.95);
  const s = Math.min(side, w, h);
  // `focus` is the drop's optional vertical hint (0-100). The default guess is
  // right for most sources but not all: measured on the first real batch, 8 of
  // 10 landed well, 2048's hexagon was clipped and Trio Tumble's tile sat too
  // loose. A hint is cheaper than asking someone to pre-crop.
  const cy = focus !== undefined ? h * (focus / 100) : w / h < 0.8 ? h * 0.4 : h * 0.5;
  return { s, left: Math.max(0, Math.round(w / 2 - s / 2)), top: Math.max(0, Math.min(h - s, Math.round(cy - s / 2))) };
}

function toIcon(src, dest, focus) {
  const { w, h } = dims(src);
  const box = squareBox(w, h, focus);
  const tmp = join(DROP, `.intake-tmp${extname(src)}`);
  sh("sips", ["-c", String(box.s), String(box.s), "--cropOffset", String(box.top), String(box.left), src, "--out", tmp]);
  sh("sips", ["-Z", "512", "-s", "format", "jpeg", "-s", "formatOptions", "82", tmp, "--out", dest]);
  sh("rm", ["-f", tmp]);
  return `${w}x${h} → crop ${box.s}² at ${box.left},${box.top} → 512²`;
}

/**
 * Splash source art. Sized on its LONG edge so a portrait and a landscape source
 * both keep their composition — this stores the art, it does not manufacture a
 * platform splash screen.
 *
 * Worth knowing before adding more: a PWA splash is not one image you supply.
 * Android/Chrome COMPOSES it from the manifest (name + background_color + a
 * >=512px icon) and accepts no image at all. iOS wants
 * `apple-touch-startup-image` at EXACT per-device pixel sizes, portrait and
 * landscape. So these files are source art for that generation step, and a
 * landscape source constrains what a portrait device screen can be cut from it.
 */
function toSplash(src, dest) {
  const { w, h } = dims(src);
  sh("sips", ["-Z", w >= h ? "1600" : "1200", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", dest]);
  const shape = w === h ? "square" : w > h ? "landscape" : "portrait";
  return `${w}x${h} ${shape} → ${w >= h ? "1600px wide" : "1200px tall"}`;
}

function toTrack(src, dest) {
  const wav = join(DROP, ".intake-tmp.wav");
  sh("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", src, wav]);
  sh("lame", ["--quiet", "--cbr", "-b", String(AUDIO_KBPS), "-h", wav, dest]);
  sh("rm", ["-f", wav]);
  return `→ ${AUDIO_KBPS} kbps`;
}

/** `Morning Miles.mp3` → `morning-miles` */
export const slug = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");

/**
 * Shape words a person adds to describe the art, which are never part of the
 * game's name. The tool MEASURES the aspect itself (see `splashDest`), so the
 * word carries no information — it is stripped wherever it appears, not only at
 * the end. `trio_tumble_horizontal_splash.png` arrived with the word in the
 * middle and was rejected as a game called "trio tumble horizontal".
 */
const SHAPE_WORDS = /^(portrait|landscape|square|horizontal|vertical)$/i;

/**
 * Decide what a dropped filename is: which game it names, and whether it is an
 * icon or a splash. Pure — no filesystem, no registry — so it is unit-tested
 * directly. Returns `null` when the name carries no kind word at all.
 *
 * Deliberately forgiving. The first real batch arrived as `blockdoku_icon`,
 * `Drop4Splash` and `dots_and_boxes_icon` — underscores, no separator at all,
 * mixed case, and "icon" for what this calls a cover. A drop-off that rejects
 * the names a person actually types is a drop-off nobody uses.
 */
export function parseDropName(file) {
  const stem = basename(file, extname(file));
  // Drop shape words, but never a LEADING one: that token is the start of the
  // game's name, and a game legitimately called "Square …" must keep it.
  const parts = stem.split(/[-_ ]+/).filter(Boolean);
  const kept = parts.filter((p, i) => i === 0 || !SHAPE_WORDS.test(p));
  const m = /^(.*?)[-_ ]?(icon|cover|splash)(?:@(\d{1,3}))?$/i.exec(kept.join("_"));
  if (!m) return null;
  const [, rawId, rawKind, focus] = m;
  if (!rawId) return null;
  // `cover` is accepted as a synonym; `icon` is the name that sticks, because it
  // is what the drop was called and what a web manifest calls it.
  const kind = rawKind.toLowerCase() === "cover" ? "icon" : rawKind.toLowerCase();
  return { rawId, kind, ...(focus === undefined ? {} : { focus: Number(focus) }) };
}

/**
 * Where a splash source lands, decided by MEASURING it rather than by trusting
 * a word in the filename. A landscape source gets its own file so it cannot
 * overwrite the portrait one — a game may supply both, and `TODO/pwa.md` notes
 * a PWA splash is not one image anyway (iOS wants exact per-device sizes in
 * both orientations).
 */
export function splashDest(dir, w, h) {
  return join(dir, w > h ? "splash-landscape.jpg" : "splash.jpg");
}

/** Levenshtein distance, for suggesting a near-miss rather than guessing one. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The closest known name, if it is close enough to be worth suggesting. */
function nearest(what, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dist = distance(what, c);
    if (dist < bestD) [best, bestD] = [c, dist];
  }
  return bestD <= Math.max(2, Math.floor(what.length / 4)) ? best : null;
}

function main() {
  if (!existsSync(DROP)) {
    console.log("no assets/new/ — nothing to do");
    return;
  }
  const aliases = gameAliases();
  const drops = readdirSync(DROP).filter(
    (f) => !f.startsWith(".") && f !== "README.md" && statSync(join(DROP, f)).isFile(),
  );
  if (drops.length === 0) {
    console.log("assets/new/ is empty — drop files in and re-run (see its README)");
    return;
  }

  const planned = [];
  const skipped = [];
  for (const file of drops) {
    const ext = extname(file).toLowerCase();
    const m = parseDropName(file);

    if (IMAGE.has(ext) && m) {
      const { rawId, kind, focus } = m;
      const id = aliases.get(slug(rawId));
      if (!id) {
        // Suggest, never guess. `solitare` and `wyrde` both arrived as typos, and
        // filing art against a fuzzy match would put the wrong picture on the
        // wrong game — silently, and only visible to whoever notices later.
        const near = nearest(slug(rawId), [...aliases.keys()]);
        skipped.push(
          `${file}: "${rawId}" matches no game id or title in src/registry.ts` +
            (near ? ` — did you mean "${near}"?` : ""),
        );
        continue;
      }
      const dir = join(root, "src", "games", id, "assets");
      // A splash's destination depends on its measured aspect, so a game can
      // supply both orientations without one silently overwriting the other.
      const dest =
        kind === "splash"
          ? (() => {
              const { w, h } = dims(join(DROP, file));
              return splashDest(dir, w, h);
            })()
          : join(dir, `${kind}.jpg`);
      planned.push({
        file,
        kind,
        dest,
        dir,
        ...(focus === undefined ? {} : { focus: Number(focus) }),
      });
    } else if (AUDIO.has(ext)) {
      planned.push({
        file,
        kind: "track",
        dest: join(root, "assets", "audio", `${slug(file)}.mp3`),
        dir: join(root, "assets", "audio"),
      });
    } else if (IMAGE.has(ext)) {
      skipped.push(`${file}: name it <game>-icon or <game>-splash`);
    } else {
      skipped.push(`${file}: not an image or audio file this tool handles`);
    }
  }

  console.log(GO ? "intake — applying" : "intake — DRY RUN (add --go to apply)");
  for (const p of planned) {
    const rel = p.dest.replace(`${root}/`, "");
    const exists = existsSync(p.dest);
    if (!GO) {
      console.log(`  ${p.file}\n    → ${rel}${exists ? "   (OVERWRITES an existing file)" : ""}`);
      continue;
    }
    mkdirSync(p.dir, { recursive: true });
    const src = join(DROP, p.file);
    const how =
      p.kind === "track"
        ? toTrack(src, p.dest)
        : p.kind === "icon"
          ? toIcon(src, p.dest, p.focus)
          : toSplash(src, p.dest);
    const size = Math.round(statSync(p.dest).size / 1024);
    console.log(`  ${p.file}\n    → ${rel}  ${how}  ${size}KB${exists ? "  (replaced)" : ""}`);
  }
  for (const s of skipped) console.log(`  SKIP ${s}`);
  if (!GO && planned.length > 0) console.log("\nnothing written. re-run with --go");
  if (GO) console.log("\ndrops left in assets/new/ — clear them when you are satisfied");
}

// Run only when invoked as a script. The parser and its helpers are exported
// for tests, and importing this module must not start filing art.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
