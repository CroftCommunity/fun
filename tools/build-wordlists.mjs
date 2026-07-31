// Build Wyrdle's committed, license-clean word lists (plan W0).
//
// Produces two files consumed by `crates/wyrdle-core` via `include_str!`:
//   crates/wyrdle-core/data/allowed.txt  — every legal 5-letter guess (sorted)
//   crates/wyrdle-core/data/answers.txt  — the curated common answer pool
//                                          (frequency-ordered, most common first)
//
// This tool is documented + re-runnable but is NOT on the test gate — the
// committed data files are the source of truth (mirrors the "generator writes a
// committed pack" discipline). Re-run only to refresh the lists.
//
// Sources (all license-clean — see games/wyrdle/PROVENANCE.md):
//   - dwyl/english-words words_alpha.txt   — Unlicense (public domain)
//   - /usr/share/dict/words (web2)          — public domain (Webster's 1934)
//   - hermitdave/FrequencyWords en_50k.txt  — MIT (word-frequency facts)
//
// Determinism: allowed is sorted; answers preserve frequency order and are
// capped at ANSWER_CAP. Re-running against the same source revisions yields
// byte-identical output.
//
// Usage: node tools/build-wordlists.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const WORD_LEN = 5;
// The answer pool size. Frequency-ordered, so this keeps the most common words.
// Larger = more variety; the daily schedule (a year) is a subset of this pool.
const ANSWER_CAP = 1500;

const WORDS_ALPHA_URL =
  "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt";
const FREQ_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt";
const WEB2_PATH = "/usr/share/dict/words";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "crates/wyrdle-core/data");

const isFive = (w) => /^[a-z]{5}$/.test(w);

// Fetch with a small on-disk cache so repeated runs don't re-download the
// multi-MB sources. Delete the cache files to force a fresh fetch.
async function fetchCached(url) {
  const cache = join(tmpdir(), `wyrdle-src-${encodeURIComponent(url).slice(-80)}`);
  try {
    return await readFile(cache, "utf8");
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
    const text = await res.text();
    await writeFile(cache, text);
    return text;
  }
}

async function readWeb2() {
  try {
    return await readFile(WEB2_PATH, "utf8");
  } catch {
    console.warn(`note: ${WEB2_PATH} unavailable — allowed set uses words_alpha only`);
    return "";
  }
}

const fiveLetters = (text) =>
  text
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter(isFive);

async function main() {
  const [wordsAlphaText, freqText, web2Text] = await Promise.all([
    fetchCached(WORDS_ALPHA_URL),
    fetchCached(FREQ_URL),
    readWeb2(),
  ]);

  const wordsAlpha = new Set(fiveLetters(wordsAlphaText));
  const web2 = new Set(fiveLetters(web2Text));

  // allowed = the union of both real dictionaries (so any reasonable word is a
  // legal guess), sorted + unique.
  const allowed = [...new Set([...wordsAlpha, ...web2])].sort();

  // answers = the most frequent 5-letter words that are in BOTH dictionaries
  // (real, common, unambiguous), in frequency order, deduped, capped.
  const seen = new Set();
  const answers = [];
  for (const line of freqText.split(/\r?\n/)) {
    const word = (line.split(/\s+/)[0] ?? "").toLowerCase();
    if (!isFive(word) || seen.has(word)) continue;
    if (!wordsAlpha.has(word) || !web2.has(word)) continue; // must be a real word
    seen.add(word);
    answers.push(word);
    if (answers.length >= ANSWER_CAP) break;
  }

  // Invariant: every answer must be a legal guess.
  const allowedSet = new Set(allowed);
  const orphans = answers.filter((w) => !allowedSet.has(w));
  if (orphans.length) throw new Error(`answers not in allowed: ${orphans.slice(0, 5).join(", ")}`);

  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "allowed.txt"), allowed.join("\n") + "\n");
  await writeFile(join(dataDir, "answers.txt"), answers.join("\n") + "\n");

  console.log(`allowed: ${allowed.length} words (words_alpha ${wordsAlpha.size} ∪ web2 ${web2.size})`);
  console.log(`answers: ${answers.length} words (freq-ordered, ∩ both dictionaries, cap ${ANSWER_CAP})`);
  console.log(`every answer ∈ allowed: ${orphans.length === 0}`);
  console.log(`wrote ${join(dataDir, "allowed.txt")}`);
  console.log(`wrote ${join(dataDir, "answers.txt")}`);
}

await main();
