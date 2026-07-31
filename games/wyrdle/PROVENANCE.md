# Wyrdle word-list provenance & licences

Wyrdle's word data is **license-clean, committed, and reproducible**. The
committed files under `crates/wyrdle-core/data/` are the source of truth — the
wasm embeds them via `include_str!`, so the game is fully offline and
deterministic. `tools/build-wordlists.mjs` regenerates them from the sources
below; it is documented and re-runnable but **not** on the test gate.

Retrieved: **2026-07-31**. Do NOT reuse NYT's Wordle name, answer list, or
assets — Wyrdle is an independent game with its own (license-clean) lists.

## Files

| File | Words | Meaning |
|------|-------|---------|
| `crates/wyrdle-core/data/allowed.txt` | 15922 | Every legal 5-letter guess (sorted, unique). |
| `crates/wyrdle-core/data/answers.txt` | 1500 | The curated common answer pool (frequency-ordered, most common first). |

Invariant (checked by the tool and by unit tests): **every answer ∈ allowed**.

## Sources & licences

### 1. dwyl/english-words — `words_alpha.txt`
- **URL:** https://github.com/dwyl/english-words (`words_alpha.txt`, `master`)
- **Licence:** **Unlicense** (public domain) — "This is free and unencumbered
  software released into the public domain ... for any purpose, commercial or
  non-commercial." (fetched from the repo's `LICENSE.md`, 2026-07-31)
- **Use:** the broad half of the `allowed` legal-guess set (a comprehensive
  English word list; 5-letter `[a-z]` subset ≈ 15921 words).

### 2. web2 (Webster's Second International, 1934) — `/usr/share/dict/words`
- **Source:** the FreeBSD/BSD `web2` word list, shipped at
  `/usr/share/dict/words` (offline).
- **Licence:** **public domain** — "The 1934 copyright has lapsed, according to
  the supplier." (`/usr/share/dict/README`)
- **Use:** the other half of the `allowed` union (a curated real-word
  dictionary; 5-letter `[a-z]` subset ≈ 9981 words), and — intersected with (1)
  and (3) — a real-word filter for `answers`.

### 3. hermitdave/FrequencyWords — `content/2018/en/en_50k.txt`
- **URL:** https://github.com/hermitdave/FrequencyWords (`en_50k.txt`, `master`)
- **Licence:** **MIT** (© 2016 Hermit Dave) — "Permission is hereby granted,
  free of charge ... to deal in the Software without restriction." (fetched
  from the repo's `LICENSE`, 2026-07-31). The data are word-frequency counts
  (facts about language, not copyrightable); the MIT licence covers the
  compilation.
- **Use:** the **commonness ordering** for `answers`. The 5-letter `[a-z]`
  words, in frequency order, intersected with (1) ∩ (2) so every answer is a
  real, common, unambiguous word; capped at the top 1500.

## Rejected sources (recorded so we don't revisit them)

- **NYT Wordle answer/allowed lists** and any repo derived from them
  (`tabatkins/wordle-list`, `dracos/valid-wordle-words`, …) — trademarked /
  NYT-owned. Never use.
- **first20hours/google-10000-english** — its own LICENSE says "I do not
  recommend using this data for commercial purposes without licensing it from
  the Linguistic Data Consortium" (LDC-derived). **Not license-clean** for a
  cooperative that may have commercial dimensions — rejected.
- **SCOWL** (`en-wl/wordlist`) — licence is clean (permissive, commercial-OK),
  but the release ships aspell/hunspell binary word lists (`.cwl`) that need
  `word-list-compress` to extract the frequency buckets — not worth the extra
  build dependency when (1)+(2)+(3) already give a clean, plaintext,
  easy-to-parse result. Parked as a future upgrade path for answer curation
  (see `TODO/wyrdle.md`).

## Regenerating

```
node tools/build-wordlists.mjs
```

Fetches (1) and (3) (cached under `$TMPDIR`), reads (2) offline, writes the two
data files, and asserts every answer ∈ allowed. Same source revisions →
byte-identical output. If the network is unavailable, the tool falls back to
`allowed` = web2 only (still valid, smaller); the committed files remain the
source of truth regardless.
