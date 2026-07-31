# Wyrdle — the daily word game (Tier-1 build-fresh, phase plan)

**Status:** 🚧 **IN PROGRESS** — planning complete (Pass 1+2+3, 2026-07-31);
execution starting at W0. Target: `/wyrdle/` — a daily 5-letter word-guessing
game (Wordle-family) for `fun.croft.ing`. Name = wyrm + word (nod to Old-English
*wyrd*, "fate"); icon 🐉; wyrm/dragon motif. Distinct, non-trademarked: original
name, original (license-clean) word lists, our own look — **not** Wordle, no NYT
assets.

> Convention note: this repo keeps plans as `plans/YYYY-MM-DD-<slug>.md`, so this
> file follows that rather than the skill's `N-plan-` scheme (skill: "match the
> existing convention"). Mirrors `plans/2026-07-30-bubble-shooter.md`.

## Problem Statement

`fun.croft.ing` is a two-tier game shelf (discovery COHESION §62). Tier 1 =
Croft-native, build-fresh, **determinism-first + verifiable outcome**. Live
Tier-1 games: solitaire, match-3, bubble. Wyrdle is the next Tier-1 game, chosen
(owner, 2026-07-31) as the corpus's own pick for the **purest expression of the
verifiable-daily-share thesis** — single-player, async, zero networking — and it
adds a new genre (word) to a shelf that already has card / match-3 / bubble.

Objective: guess a hidden 5-letter word within 6 guesses; each guess returns a
per-letter pattern (correct / present / absent). The daily answer is fixed per
seed (a curated answer schedule indexed by UTC day, the same daily-pack machinery
solitaire/match-3/bubble use). A finished game emits a **verifiable
`pond-outcome`** record: `replay(seed, guesses)` re-derives every pattern and the
solved/failed result — nothing trusted. The classic emoji-grid (🟩🟨⬛) is the
natural verification-forward result plus the deflated `?r=` self-verifying share.

Goal: `/wyrdle/` is a real, verifiable, accessible game meeting every standard in
`docs/BUILDING-GAMES.md` and its new-game checklist.

## Reasoning

- **Build fresh, not wrap.** Wordle is trademarked and NYT-owned (name, answer
  list, assets). The mechanic is simple; building is the only path that yields a
  verifiable outcome + our own identity + a clean license. (Owner-confirmed via
  the build prompt.)
- **Tap-first, core decides legality.** The floor is an on-screen keyboard (tap
  letters) that also mirrors physical typing; Enter submits, Backspace deletes.
  A guess must be a real word in the allowed set — the **core** decides
  (`is_allowed`), the UI asks and rejects/shakes non-words. An illegal guess
  changes nothing (an E2E guardrail asserts this — the bubble illegal-tap
  guardrail, ported to words).
- **Determinism is trivial here — no runtime RNG.** The answer for a seed is
  `ANSWERS[seed % N]` (pure integer), so `Game::new(seed)` needs no RNG at all.
  Patterns are a pure function of (answer, guess). The move list is the sequence
  of guesses; `replay(seed, guesses)` reproduces every pattern and the final
  `state_hash` exactly. No floats anywhere on the hashed path (letters are `u8`
  indices 0–25, counts are `u32`), so native==wasm by construction — even simpler
  than bubble (which needed a ChaCha20 launcher stream).
- **Word lists: license-clean, committed, reproducible (the one real external
  dependency).** Two sets: (a) **allowed guesses** — a broad public-domain 5-letter
  set so any reasonable word is guessable; (b) **answers** — a curated *common*
  5-letter subset (needs word-frequency signal) so dailies are fair and familiar.
  We do NOT reuse NYT's Wordle answer list. Sources are fetched **once** by a
  documented, re-runnable tool; the **filtered outputs are committed** into the
  repo and `include_str!`d into the core, so the wasm is reproducible and offline
  (mirrors the "generator writes a committed pack" discipline). Licence + source
  URL + commit recorded. W0 discovery confirms the sources and licences before we
  build on them.
- **The answer-pack machinery, minus the search.** Bubble/solitaire bake a
  **winnable** daily pack because an arbitrary deal may be unclearable. A word
  game has **no winnability search**: every answer is trivially winnable (the
  answer itself is a legal guess). So the "pack" collapses to a *seeded
  answer-schedule permutation* — a deterministic shuffle of `0..N` so dailies
  don't repeat within a year and aren't in dictionary order — plus one `fixture`
  (a seed + its one-guess winning line) for the win-path E2E. We keep the exact
  **machinery** (a `pond-docformat` pack envelope, `{ seeds, fixture }`,
  byte-identically regenerable, embedded in the wasm, indexed by UTC day via a
  `wyrdle_daily_seed` export) but there is **no `wyrdle-solver` crate** — an empty
  solver would be dishonest. Pack generation lives in a `wyrdle-core::pack` module
  with its generator + regeneration-drill tests. (Recorded delta from the bubble
  template; see Documentation Impact + W3.)
- **Verifiable share vs spoiler-free brag — Wyrdle's one novel design point.**
  The verifiable `?r=` record MUST contain the guesses (to replay), so opening it
  reveals the answer — it is a **completed-result artifact**, a spoiler by
  necessity (exactly as bubble/solitaire shares reveal their solutions). But a
  word game's classic social object is the **spoiler-free emoji grid** (🟩🟨⬛
  only, no letters). So Wyrdle ships **two share affordances**, framed honestly:
  1. **Emoji-grid brag** — copy spoiler-free `Wyrdle <n>/6` + the emoji grid to
     the clipboard (the classic paste-to-chat object). Reveals difficulty, not the
     word.
  2. **Verifiable `?r=` link** — the full self-verifying `pond-outcome` record;
     re-verifies on open; contains the guesses, so it is understood as
     "reveal + prove my result" (a spoiler for that seed).
  This keeps the whole verifiable-outcome thesis intact while honouring the word
  game's spoiler-free brag. (Design decision W5-Q1, recorded.)
- **Win/lose, not scored.** Wyrdle is win/lose; the compare metric is
  guesses-used (fewer = better), like solitaire. `Replayed::new(hash, won)` —
  `score: None, stars: None`. No `pond-outcome` change needed (verified below).
- **Game isolation (BUILDING-GAMES).** Wyrdle owns `crates/wyrdle-core`,
  `crates/wyrdle-wasm`, `src/games/wyrdle/`, `games/wyrdle/`. It touches shared
  files only at wiring points (registry, how-to-registry, `tokens.css`,
  `Cargo.toml`, `build.mjs`, `tools/build-wasm.sh`, README). It never reaches into
  another game's directory.

## Verified Assumptions

- **`pond-outcome` needs no change for a win/lose word game.**
  `crates/pond-outcome/src/lib.rs`: `Replayed::new(final_hash, won)` sets
  `score: None, stars: None`; `Record`'s `score`/`stars` are
  `skip_serializing_if = "Option::is_none"`, so a word record omits them.
  `attest`/`verify`/`to_doc`/`from_doc` are game-agnostic over the `Game` trait
  (`Move: Serialize + DeserializeOwned + Clone`). `verify` re-derives the hash and,
  for a `Won` record, re-checks `replayed.won`. (Read 2026-07-31,
  `crates/pond-outcome/src/lib.rs:17-185`.)
- **`bubble-wasm` gives the exact C-ABI shape to mirror.** Module holds one
  `Game` in a `static mut STATE: Option<Session>`; reads are serde-JSON into a
  single `static mut OUT: Vec<u8>` read via return-ptr + `out_len()`; moves return
  a `u32` status; **never panics** (every fallible path → status code or
  `"null"`/`"[]"`); the daily pack is `include_bytes!`d and parsed once into a
  cached `Vec` (`bubble_daily_seed(day)` → `seeds[day % len]`, `0` if empty);
  `new_game(lo,hi)` splits the u64 seed. (Read 2026-07-31,
  `crates/bubble-wasm/src/lib.rs`.)
- **The typed TS wrapper shape.** `src/games/bubble/bubble-wasm.ts`:
  `WebAssembly.instantiateStreaming` with an arrayBuffer fallback; `read(ptr)`
  decodes `out_len` bytes from `memory.buffer`; a `STATUS` map turns the move
  `u32` into a union; `newGame(seed: bigint)` does the lo/hi split. (Read
  2026-07-31.)
- **The outcome/share TS shape.** `src/games/bubble/bubble-outcome.ts`:
  `encodeShare`/`decodeShare` (deflate-raw + base64url) from `src/games/share.ts`;
  a `Verifier` interface a second wasm instance satisfies; `verifyRecord` replays
  `(seed, moves)` and compares the hash + re-checks `isWon` — never trusts stored
  fields. `dayIndexUTC(now)` = whole UTC days since epoch. (Read 2026-07-31.)
- **The GameModule + result-screen shape.** `src/games/bubble/bubble.ts`: a
  `mount/unmount` module; a `renderResultScreen(env, verification, opts)` reused
  for both the live end-screen and the shared `?r=` view; a `window.__wyrdle`
  E2E hook exposing `{ game, refresh, seed, ... }`; `startGame("daily"|"free")`;
  `?r=` and `?seed=` URL handling; hints/settings via `src/settings.ts`
  (`hintsEnabled`, `declareAssistanceEnabled`, setters). Result classes reuse the
  shared `sol-result`/`sol-verify-badge`/`sol-record`/`sol-share` families. (Read
  2026-07-31.)
- **The shared wiring points.** `src/registry.ts` (a `GameEntry` with
  `id/title/icon/status/load`), `src/how-to-registry.ts` (a `Guide` map),
  `build.mjs` (`GAME_PAGES` array + a per-wasm copy block + a per-pack copy
  block), `tools/build-wasm.sh` (`-p <game>-wasm` list), `src/contract.ts`
  (`GameModule`), `src/how-to.ts` (`Guide`/`GuideBlock` pure-data types),
  `src/settings.ts`. (Read 2026-07-31.)
- **The daily-pack format + generator/regen pattern.** `bubble-solver`:
  a `Pack { seeds: Vec<u64>, fixture: PackEntry { seed, moves } }` serialized via
  `pond_docformat::write("bubble-clear-pack", 1, &pack)`; committed at
  `games/bubble/daily-pack.json`; fast tests replay the committed pack, an
  `#[ignore]` generator writes it, an `#[ignore]` drill asserts byte-identical
  regeneration. `games/bubble/daily-pack.json` is the on-disk shape to mirror.
  (Read 2026-07-31.)
- **Determinism harness.** `crates/xbuild` is solitaire-specific (hardcoded
  exports); bubble has **no** dedicated xbuild extension — it relies on the
  determinism discipline (ChaCha20, u32-width RNG, integer-only hashing) + its
  golden vectors. Wyrdle has **no RNG on the runtime path at all**, so native==wasm
  is guaranteed by integer-only hashing; golden vectors pin it. (Read 2026-07-31,
  `crates/xbuild/{src/lib.rs,check.mjs,run.sh}`, `tools/build-wasm.sh`.)
- **Word data is available, license-clean, offline-capable.** `/usr/share/dict/words`
  → `web2` (Webster's 2nd, 1934 copyright lapsed — public domain per its README;
  FreeBSD-maintained), **8506** five-letter lowercase `[a-z]{5}` words offline.
  Network egress to `raw.githubusercontent.com` returns HTTP 200 (tested
  2026-07-31), so a permissive frequency list for the *answers* subset is
  fetchable. **W0 confirms the exact sources + licences before embedding.**
- **Gate shape.** `npm run test` = typecheck · lint · unit (`preunit` builds the
  wasm) · build; `npm run e2e` = Playwright incl. `@axe-core/playwright`; Rust:
  `cargo test --workspace`, `fmt --check`, `clippy`. Guides: a unit test fails if
  a guide names a shot not on disk; an E2E fails if a guide image doesn't load and
  asserts TOC-count == entry-count + axe. (Read 2026-07-31, `package.json`,
  `docs/BUILDING-GAMES.md` §§7–8.)

## Documentation Impact

- `crates/wyrdle-core/RULES.md` — **new**: the guess-pattern rules (correct/
  present/absent + duplicate-letter handling), the seed→answer map, the word-list
  provenance + licences, the `state_hash` encoding, and the answer-pack contract.
  Phases: W1 (pattern + hash + lists), W2 (Game + outcome), W3 (pack).
- `games/wyrdle/PROVENANCE.md` — **new**: the exact source URLs, commit/date,
  licence text pointer, and filter command for `allowed`/`answers`. Phase: W0.
- `docs/BUILDING-GAMES.md` — confirm the new-game checklist fits a word game at
  W6; if the "no solver for a trivially-winnable game" pattern generalizes, fold a
  one-line note into §3 (the pack section). Phase: W6.
- `README.md` — Wyrdle in shelf order + the new crate list
  (`wyrdle-core`, `wyrdle-wasm`; note: **no** `wyrdle-solver`) + the
  `games/wyrdle/` data map. Phase: W6.
- `TODO/wyrdle.md` — **new**: variants (hard mode, word length, unlimited/free
  practice), answer-list curation/tuning, keyboard layout options, a spoiler-free
  "play the same board" `?seed=` share affordance polish. Phase: W6.
- `src/registry.ts`, `src/how-to-registry.ts` — Wyrdle entries (grep confirms the
  only two registries). Phase: W6.
- `.claude/` / discovery handoff: none in this repo. The build prompt lives in the
  discovery `catalog` worktree; no update needed here.

## Concurrency Map

Sequential spine: **W0 → W1 → W2 → W3 → W4 → W5 → W6.** Each phase reads what the
prior wrote (W2's Game uses W1's pattern+lists; W3's pack uses W2's Game; W4's
wasm binds W2 + embeds W3's pack; W5's UI calls W4; W6 wires/guides W5). All
phases sequential — no parallel set, so no re-entry-verification field is needed.

**Cross-session shared-file merge risk (not intra-plan parallelism):** W4 and W6
edit files the **active match-3 session also edits** — `Cargo.toml`, `build.mjs`,
`tools/build-wasm.sh`, `src/registry.ts`, `src/how-to-registry.ts`, `README.md`.
This work runs in a **git worktree** (`worktrees/fun/wyrdle`, branch
`claude/wyrdle`) off `origin/main`, so there is no live trampling; these files
need a clean merge/rebase against `fun` main at delivery. Wyrdle-owned paths
(`crates/wyrdle-*`, `src/games/wyrdle/*`, `games/wyrdle/*`) don't overlap
match-3's — the merge surface is exactly those six shared files. Isolation
invariants: this session does not run `git checkout`/`stash`/`rebase` in the main
`fun/` worktree, binds no ports beyond an ephemeral test server, and writes only
under the worktree + the session scratchpad.

## Phases

### Phase W0 — Discovery: word-list sourcing + licences
**Goal:** Resolve the one real unknown — which license-clean sources to embed —
and produce the committed, reproducible word data before any core code assumes it.
**Discovery tasks:**
- [ ] **D1: Confirm the broad allowed-guess source + licence.**
  - **Probe:** Fetch the candidate list and its LICENSE from a pinned URL and
    confirm the licence is public-domain / permissive. Primary candidate:
    dwyl/english-words `words_alpha.txt` (Unlicense). Fallback (offline, no
    network): `/usr/share/dict/words` (web2, public domain — already verified).
    Filter to `^[a-z]{5}$`, dedupe, sort; record the count.
  - **Success criteria:** A named source with a confirmed permissive licence and
    a 5-letter count in a sane range (≈8k–16k). Licence text pointer recorded.
  - **Disposition:** `keep-as-fixture` — the filtered `allowed.txt` is committed
    data embedded by the core; the fetch/filter tool is `promote` (becomes
    `tools/build-wordlists.mjs`, documented + re-runnable, off the gate path).
- [ ] **D2: Confirm the common-answers frequency source + licence.**
  - **Probe:** Fetch a permissive word-frequency list (candidate:
    first20hours/google-10000-english, MIT) + its LICENSE. Filter to 5-letter,
    **intersect with the allowed set** (every answer must be a legal guess),
    preserve frequency order, drop obvious junk (non `[a-z]`). Record the count.
  - **Success criteria:** A named MIT/permissive source; an answer count in a sane
    range (≈300–1500) after intersection; every answer ∈ allowed.
  - **Disposition:** `keep-as-fixture` — committed `answers.txt`; same tool as D1.
- [ ] **D3: Decide the on-disk data location + embedding.**
  - **Probe:** Confirm `include_str!` from `crates/wyrdle-core/data/{allowed,answers}.txt`
    (relative to the crate) compiles and the parse (split on `\n`, trim) yields the
    counts from D1/D2. Estimate the embedded wasm size delta (≈ allowed_count × 6
    bytes) and confirm it is acceptable (< ~150 KB).
  - **Success criteria:** A tiny throwaway build confirms the files embed and parse
    to the expected counts; size delta recorded.
  - **Disposition:** `throwaway` (the probe build) + the committed data files.
**Outputs fed back into the plan:** Verified Assumptions gains the confirmed
sources/licences/counts; `games/wyrdle/PROVENANCE.md` written; W1 proceeds against
real committed lists, not inference.
**Depends on:** nothing.
**Read-set:** `/usr/share/dict/words`, fetched sources (network), `crates/bubble-core/Cargo.toml`.
**Write-set:** `tools/build-wordlists.mjs`, `crates/wyrdle-core/data/allowed.txt`,
`crates/wyrdle-core/data/answers.txt`, `games/wyrdle/PROVENANCE.md`.
**Shared-state contract:** network reads (idempotent GETs); no shared mutable state
beyond the write-set; no git/proc/port state.
**Risks:** network unavailable at regen time → the fetch tool documents the offline
web2 fallback, and the committed files are the source of truth (regen is for
updates, not the gate). A too-small answer set → tune the frequency cutoff (logged).
**Done when:** (1) `allowed.txt` + `answers.txt` are committed with recorded
provenance + licences; every answer ∈ allowed; a probe confirms they embed + parse.
(2) `PROVENANCE.md` records sources, commit/date, licences, and the exact filter
command. **Discovery Exemption applies** (no TDD on the fetch tool; the committed
data is a fixture).
**Validation:** Moderate — counts + subset check + a probe embed/parse; licences
recorded from primary sources.

### Phase W1 — core: guess-pattern engine + word lists + state hash
**Goal:** The deterministic heart — score a guess against an answer with correct
duplicate-letter handling, embed + query the word lists, and a replay-anchoring
`state_hash`; golden-vector-pinned.
**Changes:**
- [ ] `crates/wyrdle-core/Cargo.toml` (member; deps: serde, serde_json, sha2, hex,
  thiserror — mirror bubble-core minus rand).
- [ ] `crates/wyrdle-core/src/word.rs` — `Word([u8; WORD_LEN])` newtype (letters
  0–25) with serde to/from a lowercase 5-char `a-z` string (the record's `Move`,
  compact + human-readable in `?r=`), a `TryFrom<&str>` that rejects non-`[a-z]`/
  wrong-length, and `Display`.
- [ ] `crates/wyrdle-core/src/pattern.rs` — `Mark { Correct, Present, Absent }`
  and `fn score(answer: &Word, guess: &Word) -> [Mark; WORD_LEN]` implementing the
  **standard two-pass** algorithm: pass 1 marks exact positions Correct and tallies
  the remaining answer letters; pass 2 marks Present iff that letter's remaining
  tally > 0 (decrementing), else Absent. Emoji + a11y-label helpers.
- [ ] `crates/wyrdle-core/src/words.rs` — `include_str!` `data/allowed.txt` +
  `data/answers.txt`, parse once into sorted slices; `is_allowed(&Word) -> bool`
  (binary search), `answer_for(seed: u64) -> Word` = `ANSWERS[seed % N]`,
  `answers_len() -> usize`.
- [ ] `crates/wyrdle-core/src/hash.rs` — `state_hash(answer, &guesses)` = SHA-256
  over `b"wyr\x00"` + `WORD_LEN u32` + `MAX_GUESSES u32` + answer's 5 bytes +
  `guess_count u32` + each guess's 5 bytes. (Patterns are derived, so not hashed;
  the hash is fully determined by `(seed→answer, guesses)`.)
- [ ] `crates/wyrdle-core/src/lib.rs` — `#![warn(missing_docs)]`, re-exports, a
  `mode` module (`WORD_LEN=5`, `MAX_GUESSES=6`).
- [ ] `crates/wyrdle-core/tests/golden.rs` — pinned golden hashes for a known
  `(answer, guesses)` incl. a **duplicate-letter** case.
- [ ] `Cargo.toml` (workspace member add).
**Call chain:** (core API) `score(answer, guess)` and `is_allowed`/`answer_for`
are called by the W2 `Game`; `state_hash` by W2's `current_hash`/`replay`.
**Wiring test:** `tests/golden.rs::pattern_and_hash_are_pinned` — assert `score`
on a scripted duplicate case matches the expected `[Mark;5]`, and `state_hash` of a
scripted `(answer, guesses)` equals a pinned 64-hex golden. RED until the modules
exist.
**Test edges (mutation resistance):** the canonical duplicate cases — answer
`ALLOY`, guess `LOLLY` (only two `L` slots consumed correctly); answer `ABBEY`,
guess `KEBAB` (present/absent split on repeated `B`); a guess with a letter absent
entirely; an all-correct guess. `answer_for(seed)` wraps at `N` (`answer_for(N) ==
answer_for(0)`). `is_allowed` rejects a non-list word and accepts a list word +
every answer. A one-byte change in a guess flips the golden hash.
**Depends on:** W0 (the committed lists).
**Read-set:** `crates/wyrdle-core/data/{allowed,answers}.txt`, `crates/bubble-core/src/{hash,lib}.rs` (reference).
**Write-set:** `crates/wyrdle-core/{Cargo.toml,src/*.rs,tests/golden.rs,RULES.md}`, `Cargo.toml`.
**Shared-state contract:** edits shared `Cargo.toml` (member add) — merge-time only; Rust-only, no ambient state.
**Observability:** `WordError`/pattern are typed (`thiserror`); no panics on bad
input (`TryFrom` returns `Err`). `answer_for` uses `%`, never indexes out of range.
**Risks:** duplicate-letter handling is the classic bug — the golden pins the
canonical cases. `Word` serde must round-trip lowercase exactly (a golden asserts).
**Done when:** (1) `score` produces the canonical marks for the duplicate cases and
`state_hash` matches the pinned goldens; lists embed + query correctly. (2) `cargo
test -p wyrdle-core` (incl. golden) green; `fmt --check` + `clippy` (default +
pedantic) clean.
**Validation:** Narrow — golden + unit tests over the pure functions. Sufficient.

### Phase W2 — core: the `Game` wrapper + `pond-outcome` binding
**Goal:** A play-loop (submit a legal guess → pattern; win on exact match, lose on
budget-out) with a verifiable outcome replayable from `(seed, guesses)`.
**Changes:**
- [ ] `crates/wyrdle-core/src/game.rs` — `Game` holding `answer: Word`, `seed`,
  `guesses: Vec<Word>`. `Game::new(seed)` = `answer_for(seed)` (no RNG).
  `play(guess: Word) -> Result<[Mark; WORD_LEN], GuessError>`: `Err(NotAWord)` if
  `!is_allowed`, `Err(GameOver)` if already won/lost; else push + return
  `score(answer, guess)`. `guesses_left`, `is_won` (last guess == answer),
  `is_lost` (`guesses.len() == MAX_GUESSES && !is_won`), `current_hash`
  (`state_hash(answer, &guesses)`), `keyboard_state()` → best `Mark` per letter
  (Correct > Present > Absent > unseen) for key colouring, `patterns()` for the UI.
- [ ] `impl pond_outcome::Game for Wyrdle` (`Move = Word`, `KIND = "wyrdle"`,
  `VERSION = 1`): `replay(seed, guesses)` builds a `Game`, applies each guess
  (an illegal/extra guess in a tampered record is a no-op → hash diverges), returns
  `Replayed::new(current_hash, is_won)` (`score`/`stars` `None`).
- [ ] `crates/wyrdle-core/Cargo.toml` — add `pond-outcome`; extend `RULES.md`.
- [ ] `crates/wyrdle-core/tests/golden.rs` — a replay golden.
**Call chain:** `pond_outcome::verify::<Wyrdle>(record)` → `Wyrdle::replay` →
`Game::play`×n → `pattern::score` + `hash::state_hash`.
**Wiring test:** `game.rs::tests::verify_roundtrip_holds_and_detects_tamper` —
build a `Game`, play a scripted **winning** line (final guess = the answer),
`attest::<Wyrdle>`→`Record`, `verify`→`ok==true`, `result == Won`; a tampered
`final_hash` → `ok==false`; a tampered move (swap a guess) → `ok==false`. RED until
`Game` + `impl Game` exist.
**Test edges:** win on the **last** (6th) guess is `Won`; the same answer with 6
wrong guesses is `Lost` (`is_lost`, `!is_won`); `play` after game-over is
`Err(GameOver)` and does not grow `guesses`; a `NotAWord` guess is `Err` and a
no-op (hash unchanged); two `replay`s of the same `(seed, guesses)` are
byte-identical; an illegal guess in a record diverges the hash from the honest game.
**Depends on:** W1.
**Read-set:** `crates/wyrdle-core/src/{pattern,words,hash,word,lib}.rs`, `crates/pond-outcome/src/lib.rs`, `crates/bubble-core/src/game.rs` (reference).
**Write-set:** `crates/wyrdle-core/src/{game.rs,lib.rs}`, `crates/wyrdle-core/Cargo.toml`, `crates/wyrdle-core/RULES.md`, `crates/wyrdle-core/tests/golden.rs`.
**Shared-state contract:** no shared mutable state beyond the write-set; `Cargo.lock` gains the `pond-outcome` edge (benign).
**Observability:** `GuessError` is a typed `thiserror` enum (`NotAWord`,
`GameOver`); the `Game` never panics on a bad guess.
**Risks:** the win check must be "final guess all-Correct", not "any guess" — the
last-guess-win edge pins it. Replay==play requires `play` to reject the same inputs
identically — the tamper test pins it.
**Done when:** (1) a scripted game attests to a `Record` and re-verifies by replay
(hash + move tamper both fail), through `pond_outcome::{attest,verify}`. (2) `cargo
test -p wyrdle-core` (incl. `verify_roundtrip` + replay golden) green; `-p
pond-outcome` still green.
**Validation:** Narrow — wiring test + unit + golden. Sufficient.

### Phase W3 — core: the answer daily-pack (`wyrdle-core::pack` + `games/wyrdle/daily-pack.json`)
**Goal:** Bake a deterministic, byte-identically-regenerable answer schedule (a
year of non-repeating, shuffled daily seeds) + a fixture win-line — the same pack
machinery, no winnability search.
**Changes:**
- [ ] `crates/wyrdle-core/src/pack.rs` — `Pack { seeds: Vec<u64>, fixture:
  PackEntry { seed, moves: Vec<Word> } }`; `generate_pack(master_seed, count)`:
  a **seeded Fisher-Yates** shuffle (ChaCha20 — dev-dep, build-time only) of
  `0..answers_len()` truncated to `count`, so day `d` → `seeds[d % len]` → a
  distinct answer, non-sequential, non-repeating within `len`. `fixture` =
  `{ seed: seeds[0], moves: vec![answer_for(seeds[0])] }` (one guess = the answer →
  a win). `pack_to_doc` via `pond_docformat::write("wyrdle-answer-pack", 1, &pack)`.
- [ ] `crates/wyrdle-core/Cargo.toml` — `[dev-dependencies] rand`, `rand_chacha`
  (build-time shuffle only; **not** on the runtime/hashed path).
- [ ] `crates/wyrdle-core/tests/pack.rs` — fast tests replay the **committed**
  pack (no generation); an `#[ignore]` generator writes
  `games/wyrdle/daily-pack.json`; an `#[ignore]` drill asserts byte-identical
  regeneration (mirror `bubble-solver/tests/solver.rs`).
- [ ] `games/wyrdle/daily-pack.json` — the committed pack (written by the ignored
  generator, then committed).
- [ ] extend `RULES.md` (the pack contract + the "no solver, trivially winnable"
  note).
**Call chain:** (build-time) ignored generator → `generate_pack` →
`answer_for`; (runtime) W4 `wyrdle_daily_seed(day)` → `seeds[day % len]`.
**Wiring test:** `pack.rs::committed_pack_is_wellformed` — the committed pack has
`count` unique seeds, the fixture seed ∈ seeds, and replaying the fixture
`(seed, moves)` through `wyrdle_core::Game` yields `is_won`;
`pack.rs::fixture_is_a_win` replays the fixture line and asserts a win. RED until
`pack` + the committed file exist.
**Test edges:** the shuffle is deterministic (regen byte-identical); `count` ≤
`answers_len()` (no repeats within a year); the fixture's one guess equals the
answer (an off-by-one seed→answer would fail the win); `day % len` wraps.
**Depends on:** W1, W2.
**Read-set:** `crates/wyrdle-core/src/{words,game,word}.rs`, `crates/bubble-solver/{src/lib.rs,tests/solver.rs}` (reference), `games/bubble/daily-pack.json` (shape).
**Write-set:** `crates/wyrdle-core/src/pack.rs`, `crates/wyrdle-core/Cargo.toml`, `crates/wyrdle-core/tests/pack.rs`, `crates/wyrdle-core/RULES.md`, `games/wyrdle/daily-pack.json`.
**Shared-state contract:** build-time crate; no runtime state. The generator writes exactly one file under `games/wyrdle/`.
**Observability:** the generator prints seeds/fixture counts (no silent
truncation); a `count > answers_len()` is a loud `panic`/`assert` (misconfig), not
a silent clamp.
**Risks:** regeneration must be byte-identical — a fixed `master_seed` + a
width-stable shuffle (u32 index draws, like `bubble-core::rng`) pins it; the
`#[ignore]` drill guards it.
**Done when:** (1) `games/wyrdle/daily-pack.json` exists, the fixture line clears to
a win by replay, seeds are unique, and the pack regenerates byte-identically. (2)
`cargo test -p wyrdle-core` (incl. the fast pack tests) green; the ignored generator
+ drill run clean.
**Validation:** Moderate — wiring tests (well-formed + fixture win + byte-identical
regen) + the generator's logged counts.

### Phase W4 — wyrdle-wasm C-ABI binding + typed TS wrapper
**Goal:** The browser holds a `Game` and drives it; daily reads the baked pack;
never panics.
**Changes:**
- [ ] `crates/wyrdle-wasm/Cargo.toml` + `src/lib.rs` — raw C-ABI over
  `wyrdle_core::Game` (mirror bubble-wasm): `new_game(lo,hi)`; `board_json()` →
  `{ wordLen, maxGuesses, guesses: [{ letters:[u8;5], marks:[u8;5] }],
  keyboard: {a: mark, …}, won, lost, guessesLeft }`; `is_allowed(l0..l4) -> u32`
  (legality query for the UI, **core decides**); `guess(l0,l1,l2,l3,l4) -> u32`
  (status 0 applied / 1 not-a-word / 2 bad-or-over); `current_hash()`;
  `is_won()`/`is_lost()`; `answer_for_seed(lo,hi)` → packed letters (used only by
  the **verifier** replay path and the emoji-share, never shown pre-win);
  `mark_assistance()`; `outcome_json(declare)`; `wyrdle_daily_seed(day)`;
  `out_len()`. `include_bytes!` the pack; parse once (cached), `0` on empty.
  **Never panics.**
- [ ] `src/games/wyrdle/wyrdle-wasm.ts` — typed wrapper (per-game dir): `BoardView`,
  `Mark`, `GuessStatus` union, `newGame(seed: bigint)` lo/hi split, `read(ptr)`
  decode, `isAllowed(word)`, `guess(word)`, `board()`, `currentHash()`, `isWon()`,
  `isLost()`, `dailySeed(day)`, `markAssistance()`, `outcome(declare)`.
- [ ] `Cargo.toml` (member), `build.mjs` (copy `/wyrdle.wasm` + the pack as
  `/wyrdle-daily-pack.json`), `tools/build-wasm.sh` (`-p wyrdle-wasm`).
**Call chain:** `/wyrdle/` UI → `wyrdle-wasm.ts guess()` → wasm `guess` →
`wyrdle_core::Game::play` → `pattern::score`.
**Wiring test:** `crates/wyrdle-wasm/src/lib.rs::tests::cabi_new_game_guess_outcome`
(native rlib, mirrors bubble's C-ABI test): `new_game(fixtureSeed)` → `is_allowed`
true for the answer, false for a non-word → `guess(answer)` returns 0 and
`is_won()==1` → `board_json` parses, `won==true` → `outcome_json(1)` parses to a
`kind:"wyrdle"` envelope → `wyrdle_daily_seed(0) != <sentinel>` (pack embedded). An
out-of-list guess returns 1 and leaves `current_hash` unchanged. RED until the
binding exists.
**Test edges:** a `guess` on a non-word is status 1 + hash unchanged; a `guess`
after a win is status 2; `board_json` round-trips a known board; the daily seed
comes from the pack.
**Depends on:** W2, W3.
**Read-set:** `crates/wyrdle-core/**`, `crates/bubble-wasm/src/lib.rs` +
`src/games/bubble/bubble-wasm.ts` (reference), `games/wyrdle/daily-pack.json`,
`build.mjs`, `tools/build-wasm.sh`.
**Write-set:** `crates/wyrdle-wasm/{Cargo.toml,src/lib.rs}`,
`src/games/wyrdle/wyrdle-wasm.ts`, `Cargo.toml`, `build.mjs`, `tools/build-wasm.sh`, `Cargo.lock`.
**Shared-state contract:** edits shared `Cargo.toml`+`build.mjs`+`build-wasm.sh`
(merge-time); the wasm holds module-static single-game state (as bubble-wasm does).
**Observability:** every fallible C-ABI path returns a status / empty buffer; the
TS wrapper surfaces a JSON decode failure to `console.error` (not a silent empty
board).
**Risks:** raw-pointer out-buffer + never-panic discipline; the seed lo/hi split
must match bubble's; `answer_for_seed` must be used **only** by the verifier/emoji
paths, never rendered before a win (spoiler discipline — an E2E in W5 guards it).
**Done when:** (1) JS starts a game, queries legality, guesses, reads the board +
keyboard + won/lost, gets a verifiable `outcome_json`, and daily resolves via the
pack. (2) `npm run build:wasm` builds `/wyrdle.wasm`; the C-ABI Rust test + `cargo
test --workspace` green.
**Validation:** Moderate — wiring test + build the wasm + a scripted JS smoke.

### Phase W5 — board UI + verifiable result + two shares (`src/games/wyrdle/`)
**Goal:** A playable, accessible, verification-forward `/wyrdle/`.
**Changes:**
- [ ] `src/games/wyrdle/wyrdle-outcome.ts` — pure outcome/verify/share
  (mirror bubble-outcome): `WyrdleRecord { kind, seed, moves: string[], move_count,
  final_hash, result, assistance }`, `WyrdleEnvelope`, `encodeRecord`/`decodeRecord`
  (deflate+base64url), a `Verifier` interface, `verifyRecord` (replay → hash +
  `isWon` re-check; never trusts stored fields), and **`emojiGrid(patterns)`** → the
  spoiler-free 🟩🟨⬛ text (with a colour-blind-friendly note using distinct
  glyphs is not needed in text — the standard squares are the shared object).
- [ ] `src/games/wyrdle/wyrdle.ts` — a `GameModule`: a 6×5 tile grid (each tile
  carries its letter **and** its mark as a shape/label, not colour alone — WCAG-AA
  both themes, colour-blind-safe), an on-screen **keyboard** (tap A–Z + Enter +
  Backspace; keys colour by best-known `Mark`) that also mirrors **physical
  typing** (keydown), a submit path that asks the core `isAllowed` and **shakes +
  rejects** a non-word (no state change), row-reveal on submit, a HUD
  (guesses-left). Result screen (reuse `renderResultScreen`): win/lose headline,
  verification badge, the record (result / guesses-used / seed / hash), a **"Copy
  result" emoji-grid** button (spoiler-free), a **`?r=` share** link (verifiable,
  spoiler by necessity — labelled), one-tap **re-verify**, and play-again. Daily
  (pack via `wyrdle_daily_seed`) + free-play (`?seed=`) + shared (`?r=`). Hints
  on-by-default (**reveal one not-yet-placed correct letter position** → counts as
  assistance) + shared settings; hints-off → "I'm done" ends + reports honestly.
- [ ] `tokens.css` — Wyrdle tiles/keyboard tokens (only-hex file); correct/present/
  absent pairs clear **WCAG-AA in both themes** (ratios recorded + asserted by
  `tests/tokens.test.ts`).
- [ ] `styles.css` — Wyrdle component classes (the hex-in-`styles.css` unit test
  must still pass — semantic `var()` only).
- [ ] a `window.__wyrdle` E2E hook (`{ game, refresh, seed, submitGuess }`).
**Call chain:** `/wyrdle/` URL → drawer/registry `load` → `wyrdle.ts mount` →
`wyrdle-wasm.ts` → wasm.
**Wiring test:** `tests/wyrdle.spec.ts` (mirror bubble.spec) — load `/wyrdle/?seed=`,
type a legal guess via the on-screen keyboard, assert a row reveals with per-tile
marks; **the illegal-guess guardrail** — submitting a non-word shakes and changes
nothing (`isWon`/guess-count unchanged); the committed **fixture** guess line
clears to a **verifiable win** (`.sol-verify-badge.ok`), the emoji-grid copy is
spoiler-free (no `[a-z]`), and the `?r=` link round-trips + re-verifies on open;
hints-off "I'm done" ends; axe clean **light + dark**; **360px** no horizontal
overflow.
**Test edges:** the keyboard-key colours == the core's `keyboard_state` exactly (no
UI-invented marks); a physical-typing path and the on-screen-tap path produce the
same guess; the pre-win screen never renders the answer letters (spoiler guard);
theme toggle no-flash.
**Depends on:** W4.
**Read-set:** `src/{contract,chrome,settings,theme,how-to}.ts`,
`src/games/bubble/{bubble.ts,bubble-outcome.ts}` (reference), `src/games/share.ts`,
`tokens.css`, `tests/bubble.spec.ts` + `tests/tokens.test.ts` (reference).
**Write-set:** `src/games/wyrdle/{wyrdle.ts,wyrdle-outcome.ts}`, `tokens.css`,
`styles.css`, `tests/wyrdle.spec.ts`, any `src/games/wyrdle/` assets.
**Shared-state contract:** append-only Wyrdle tokens/classes in
`tokens.css`/`styles.css` (the hex-in-`styles.css` test must still pass) —
merge-time only.
**Observability:** the module logs (`console.debug`) the seed + mode on mount so a
"wrong word" report is diagnosable; no answer logged pre-win (spoiler + no PII).
**Risks:** the spoiler discipline (never render the answer before a win); the
keyboard colouring must read the core; the duplicate-letter marks must match the
core exactly — the wiring + edge tests guard these.
**Done when:** (1) a stranger opens `/wyrdle/`, types guesses (on-screen or
physical; non-words rejected with a shake), sees per-tile + per-key marks, and on
win/lose gets a verifiable result with a spoiler-free emoji copy + a self-verifying
`?r=` + re-verify; hints/settings/daily/free-play work. (2) `npm run test` + `npm
run e2e` (axe both themes, 360px, illegal-guess guardrail) green.
**Validation:** Broad — wiring e2e + manual play (both input paths) + axe both
themes + 360px + illegal-guess guardrail + both-shares round-trip + spoiler guard.

### Phase W6 — how-to guide, registry wiring, docs, gate, deploy-ready
**Goal:** Wyrdle is a first-class shelf game; full gate green.
**Changes:**
- [ ] `src/games/wyrdle/wyrdle-howto.ts` (pure-data; **lead with the tap/type
  interaction** and the two shares) + `src/how-to-registry.ts` entry + `npm run
  guide:shots` (generate `assets/guide/wyrdle-*.jpg`).
- [ ] `src/registry.ts` — `{ id:"wyrdle", title:"Wyrdle", icon:"🐉",
  status:"playable", load: wyrdleModule }`; `build.mjs` `GAME_PAGES` gains
  `"wyrdle"` (own `/wyrdle/` URL).
- [ ] `README.md` (shelf order + crate/data map), `docs/BUILDING-GAMES.md`
  (confirm checklist; optional pack-section note), `TODO/wyrdle.md` (**new**).
- [ ] full gate: `cargo test --workspace` + `fmt --check` + `clippy`; `npm run
  test` + `npm run e2e`.
**Call chain:** header → `/how-to/?game=wyrdle` → shared `renderGuide` → Wyrdle
howto; drawer → registry → Wyrdle.
**Wiring test:** `tests/how-to.spec.ts` picks up Wyrdle (images load, TOC ==
entries, axe) + the drawer/registry E2E lists + launches Wyrdle; `tests/how-to.test.ts`
(the sync unit test) fails if the guide names a missing shot.
**Test edges:** the how-to sync test fails on a missing shot; the registry E2E
launches `/wyrdle/` and mounts the board.
**Depends on:** W5.
**Read-set:** `src/{how-to,how-to-page,how-to-registry,registry}.ts`,
`tools/guide-shots.mjs`, `src/games/bubble/bubble-howto.ts` (reference),
`README.md`, `docs/BUILDING-GAMES.md`, `TODO/README.md`.
**Write-set:** `src/games/wyrdle/wyrdle-howto.ts`, `src/how-to-registry.ts`,
`src/registry.ts`, `build.mjs`, `README.md`, `docs/BUILDING-GAMES.md`,
`TODO/wyrdle.md`, `assets/guide/wyrdle-*.jpg`.
**Shared-state contract:** edits shared `registry.ts`+`how-to-registry.ts`+
`build.mjs`+`README.md` (merge-time coordination with match-3).
**Observability:** the gate is the safety net; a failed gate blocks a (later,
owner-requested) deploy.
**Risks:** guide-shot sync; CI builds the wasm + the pack; the six shared files
need a clean rebase onto `fun` main at delivery.
**Done when:** (1) the drawer lists Wyrdle as playable, launches it, links to its
how-to (with screenshots). (2) `cargo test --workspace` + `fmt` + `clippy`; `npm
run test` + `npm run e2e` (axe) all green. Deploy-ready (**not pushed** unless the
owner asks).
**Validation:** Broad — full gate + a local `npm run serve` smoke of `/wyrdle/` +
`/how-to/?game=wyrdle`.

## Open Questions

- [RECOMMENDED: PHASE-GATED (W0)] **W0-Q1 — word-list sources + licences.**
  Recommended: **allowed** = dwyl/english-words `words_alpha.txt` (Unlicense) with
  an offline **web2** (public-domain) fallback; **answers** = 5-letter ∩ a
  permissive frequency list (google-10000-english, MIT), intersected with allowed.
  *Rationale: both permissive/public-domain, offline fallback exists, and the
  filtered outputs are committed so the build is reproducible. W0 confirms the
  exact licences from primary sources before embedding — resolvable by the probe
  itself, so PHASE-GATED not BLOCKING.*
- [RECOMMENDED: ADVISORY] **W5-Q1 — two share affordances.** Recommended: ship
  BOTH a spoiler-free emoji-grid copy (the brag) AND the verifiable `?r=` record
  (spoiler by necessity, labelled). *Rationale: verifiability requires the moves
  (so `?r=` is inherently a spoiler, exactly like the other games' shares), but a
  word game's classic social object is the spoiler-free grid — shipping both keeps
  the thesis intact and the game idiomatic. Advisory: the build can ship the `?r=`
  first and the emoji copy is a small, self-contained add within W5.*
- [RECOMMENDED: ADVISORY] **W-Q3 — no `wyrdle-solver` crate.** Recommended: fold
  the answer-pack generator into `wyrdle-core::pack` (no separate solver crate),
  since a word game has no winnability search. *Rationale: an empty "solver" would
  be dishonest; the pack machinery (envelope, seeds+fixture, byte-identical regen,
  wasm-embedded, daily indexing) is preserved. Advisory — a structural choice, not
  a blocker.*

No BLOCKING questions remain. W0-Q1 is PHASE-GATED at W0 (the discovery phase
resolves it) but does not block starting W0.

## Review Log

- **2026-07-31 Pass 1+2+3 (combined, single context).** Built the plan from the
  build prompt (`discovery catalog` worktree) + the proven bubble template, read
  firsthand (bubble core/wasm/ts/outcome/howto/solver, pond-outcome, pond-docformat,
  shared wiring, build glue, the bubble e2e, the gate). Verified assumptions from
  real source (file:line recorded). Structural decisions: seed→answer is pure
  integer (no runtime RNG); pack machinery kept but the winnability search dropped
  (W-Q3); the verifiable `?r=` is a spoiler by necessity, so two share affordances
  (W5-Q1); word-list sourcing is the one real unknown → a Phase W0 discovery
  resolves it against license-clean sources (W0-Q1). Added the Concurrency Map
  (sequential + the six-file cross-session merge surface with match-3), Documentation
  Impact (RULES.md, PROVENANCE.md, README, TODO, BUILDING-GAMES, the two registries),
  and per-phase Call chain / Wiring test / Read+Write-set / Shared-state / 2-tier
  Done-when / Validation.
  - **Pass 2 gap checks:** write-sets are disjoint from match-3's except the six
    named shared files (merge-time, documented); every new file has an owning phase;
    the wiring test in each phase drives the real entry point (W1 golden; W2
    `verify`; W3 pack-fixture-win; W4 C-ABI; W5/W6 e2e through `/wyrdle/` + drawer).
  - **Pass 3 quality gates:** TDD ordering — every phase leads RED with a
    boundary-exercising test. Observability — typed `WordError`/`GuessError` (no
    panics); the W3 generator logs counts (no silent truncation); the W4 TS wrapper
    surfaces decode failures; the W5 module logs seed+mode (no answer/PII pre-win).
    Mutation resistance — duplicate-letter pattern goldens (ALLOY/LOLLY, ABBEY/KEBAB),
    last-guess-win vs 6-wrong-lose, not-a-word no-op, move-tamper hash divergence,
    byte-identical pack regen, keyboard==core marks, spoiler guard. Validation
    calibration — W0 Moderate, W1/W2 Narrow, W3 Moderate, W4 Moderate, W5/W6 Broad.
    Concurrency honesty — sequential spine; the only shared surface is the six named
    files; worktree isolation invariants stated. Documentation impact — every
    stale-making change sits in its own phase (RULES.md at W1–W3, README/registries
    at W6), no trailing docs-only phase. Discovery Exemption noted for W0.
  - **Confirmed ready:** yes — W0 can start now; W0-Q1 is resolved by W0 itself.
- **2026-07-31 W0 executed (discovery).** Sources confirmed from primary
  LICENSE files. **W0-Q1 RESOLVED:** `allowed` = union of dwyl `words_alpha`
  (Unlicense/PD) + web2 (PD) 5-letter = **15922** words; `answers` = top-1500
  frequency-ordered 5-letter words from **hermitdave/FrequencyWords (MIT)** ∩
  both dictionaries (every answer ∈ allowed, verified). **Rejected**
  google-10000-english (its LICENSE forbids commercial use w/o an LDC licence —
  not clean) and SCOWL (clean licence but ships aspell-binary `.cwl`, not worth
  the extra build dep). Embedded size ≈ 104 KB (under the ~150 KB budget).
  Committed `tools/build-wordlists.mjs` (re-runnable, off-gate),
  `crates/wyrdle-core/data/{allowed,answers}.txt`, `games/wyrdle/PROVENANCE.md`.
  D3 (`include_str!` embed/parse) folded into W1's tests (the crate lands there).
