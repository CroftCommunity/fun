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
import { fileURLToPath } from "node:url";

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

/** Game ids, read from the registry so the tool cannot drift from it. */
function gameIds() {
  const src = sh("cat", [join(root, "src", "registry.ts")]).toString();
  const body = src.slice(src.indexOf("export const REGISTRY"));
  return new Set([...body.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]));
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
  // 10 landed well, 2048's hexagon was clipped and Ring Pop's tile sat too
  // loose. A hint is cheaper than asking someone to pre-crop.
  const cy = focus !== undefined ? h * (focus / 100) : w / h < 0.8 ? h * 0.4 : h * 0.5;
  return { s, left: Math.max(0, Math.round(w / 2 - s / 2)), top: Math.max(0, Math.min(h - s, Math.round(cy - s / 2))) };
}

function toCover(src, dest, focus) {
  const { w, h } = dims(src);
  const box = squareBox(w, h, focus);
  const tmp = join(DROP, `.intake-tmp${extname(src)}`);
  sh("sips", ["-c", String(box.s), String(box.s), "--cropOffset", String(box.top), String(box.left), src, "--out", tmp]);
  sh("sips", ["-Z", "512", "-s", "format", "jpeg", "-s", "formatOptions", "82", tmp, "--out", dest]);
  sh("rm", ["-f", tmp]);
  return `${w}x${h} → crop ${box.s}² at ${box.left},${box.top} → 512²`;
}

function toSplash(src, dest) {
  const { w, h } = dims(src);
  sh("sips", ["-Z", "1200", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", dest]);
  return `${w}x${h} → 1200px tall`;
}

function toTrack(src, dest) {
  const wav = join(DROP, ".intake-tmp.wav");
  sh("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", src, wav]);
  sh("lame", ["--quiet", "--cbr", "-b", String(AUDIO_KBPS), "-h", wav, dest]);
  sh("rm", ["-f", wav]);
  return `→ ${AUDIO_KBPS} kbps`;
}

/** `Morning Miles.mp3` → `morning-miles` */
const slug = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");

function main() {
  if (!existsSync(DROP)) {
    console.log("no assets/new/ — nothing to do");
    return;
  }
  const ids = gameIds();
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
    const stem = basename(file, extname(file));
    // `<id>-cover.png` or, with a vertical crop hint, `<id>-cover@57.png`.
    const m = /^(.*)-(cover|splash)(?:@(\d{1,3}))?$/i.exec(stem);

    if (IMAGE.has(ext) && m) {
      const [, id, kind, focus] = m;
      if (!ids.has(id)) {
        skipped.push(`${file}: "${id}" is not a game id in src/registry.ts`);
        continue;
      }
      const dir = join(root, "src", "games", id, "assets");
      planned.push({
        file,
        kind: kind.toLowerCase(),
        dest: join(dir, `${kind.toLowerCase()}.jpg`),
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
      skipped.push(`${file}: name it <game-id>-cover or <game-id>-splash`);
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
        : p.kind === "cover"
          ? toCover(src, p.dest, p.focus)
          : toSplash(src, p.dest);
    const size = Math.round(statSync(p.dest).size / 1024);
    console.log(`  ${p.file}\n    → ${rel}  ${how}  ${size}KB${exists ? "  (replaced)" : ""}`);
  }
  for (const s of skipped) console.log(`  SKIP ${s}`);
  if (!GO && planned.length > 0) console.log("\nnothing written. re-run with --go");
  if (GO) console.log("\ndrops left in assets/new/ — clear them when you are satisfied");
}

main();
