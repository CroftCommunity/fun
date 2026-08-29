# Plan — match-3 becomes Trio Tumble: Jewel Drop

**Status:** Phase 0 complete (survey + decisions recorded). Phases 1–7 not started.

Owner decisions taken 2026-08-28, recorded in the Review Log below. Branch
`claude/trio-tumble-rename`; claim `CroftC/.coordination/claims/fun--trio-tumble-rename.md`.

## Problem Statement

The shelf's second game has never had a name. It ships as `id: "match3"`,
`title: "Match-3"` — a description of its genre, where every other Croft-native game
on the shelf carries a name (Furrow, Wyrdle, Align, Loose Ends, Orchard Drop). That
alone is only untidiness. Two things made it urgent:

1. **Art arrived for a name we cannot use.** A cover and splash were commissioned and
   landed on `main` in `2fb60ef` (2026-08-28) under the name **Ring Pop**. RING POP is
   a live registered mark of The Topps Company / Bazooka Candy Brands, and the
   collision is in its worst configuration: the mark denotes a *ring-shaped gem candy*,
   and the art applied it to a *candy-matching game depicting a gold ring holding a gem
   star*. That is use of the mark for the thing the mark names, which invites the
   inference "this is the official Ring Pop game" — affiliation confusion, not a
   coincidence of words. Famous-mark dilution needs neither confusion nor competing
   goods. The repo's own Tier-2 inclusion filter has an *honestly represented /
   non-extractive* leg strong enough to have deleted Astray, HexGL and Clumsy Bird
   eight commits earlier (`b5c0399`); a name borrowed from a candy brand fails the same
   test one layer up.

2. **The exposure window is open and closing.** The wordmark has never been published:
   `splash.jpg` is referenced by no code path and appears 0 times in `dist/`, because
   the PWA work that would consume it is entirely unbuilt (`TODO/pwa.md`). Only
   `icon.jpg` is live, via `src/home.ts:36`. Renaming now costs one image and a string.
   Renaming after a PWA manifest `id`, published `?r=` share links, or an Android TWA
   listing (a peer session is packaging one) costs all of those plus a rename under
   legal pressure.

The owner chose **Trio Tumble: Jewel Drop** and supplied replacement art. This plan
executes that rename, plus two enabling changes the owner accepted knowing they exceed
a pure rename.

## Approach

Rename every `match3` identifier to `trio-tumble` — id, URL, crate names, outcome
kinds, pack kinds, filenames, docs — with **one deliberate exception** (the hash domain
prefix, below). Then add the two accepted extensions, then land the art.

| Layer | From | To |
|---|---|---|
| registry id / URL | `match3` · `/match3/` | `trio-tumble` · `/trio-tumble/` |
| registry title | `"Match-3"` | `"Trio Tumble"` + `subtitle: "Jewel Drop"` |
| crates | `match3-{core,solver,wasm}` | `trio-tumble-{core,solver,wasm}` |
| Rust types | `Match3`, `Match3Jelly`, … | `TrioTumble`, `TrioTumbleJelly`, … |
| outcome kinds | `"match3"`, `"match3-jelly"`, … | `"trio-tumble"`, `"trio-tumble-jelly"`, … |
| pack kinds | `"match3-par-pack"`, … | `"trio-tumble-par-pack"`, … |
| pack dir | `games/match3/` | `games/trio-tumble/` |
| front-end | `src/games/match3*` | `src/games/trio-tumble*` |
| art | `assets/guide/match3-*.jpg` | `assets/guide/trio-tumble-*.jpg` |
| **hash prefix** | `b"m3\x00"` | **unchanged — see Reasoning** |

## Reasoning

**Why the hash prefix stays `b"m3\x00"`.** `crates/match3-core/src/hash.rs:10` folds
this constant into `state_hash`, so unlike the outcome envelope `kind` (checked on read
at `pond-outcome/src/lib.rs:184`, never hashed) it is *inside* the verifiable record.
Changing it would invalidate all 26 golden vectors in `crates/match3-core/vectors/` and
force regeneration of all 7 seed packs — each a 365-seed solver run, and each
regeneration a fresh opportunity to silently change which dailies are winnable. The
benefit would be cosmetic, because **the tag was never the game's name in the first
place**: six of the fourteen cores already use a domain tag that does not match their
game (`sk1` solitaire, `cs1` color-sort, `t48` 2048, `algn` align, `bdk` blockdoku,
`m3` here) against eight that do (`checkers`, `othello`, `furrow`, `dots`, `drop4`,
`bubble`, `loose`, `wyr`). Leaving it is the consistent choice; changing it spends real
determinism risk to make an invisible constant prettier. Recorded here so a later
reader does not "finish the job" and re-lock the corpus for nothing.

**Why pack kinds change but pack payloads do not.** The kind lives in the
`pond-docformat` envelope, not the payload. Generators are `#[ignore]`d tests in
`crates/match3-solver/tests/solver.rs` (lines 210, 416) that write the files; the
read-back assertions at lines 158 and 347 check the kind string. So changing the
constant in the generator, the reader, and the envelope line of each committed JSON is
sufficient — no solver re-run, byte-identical payloads.

**Why `?r=` share links break, and why that is acceptable.** Outcome kind is checked on
envelope read, so every existing share URL stops verifying. `TODO/match3.md` already
records "no users" as the basis for retuning par (Track P-now/C1), the repo is pre-1.0,
and the global rule is that pre-1.0 projects take no backwards-compatibility burden
(no shims, no aliases). Accepting the break is cheaper than carrying a kind-alias table
forever for a game nobody has shared.

**Why `subtitle` is a contract field rather than a longer title.** The owner chose the
full name *Trio Tumble: Jewel Drop*. Rendered as one `title` string it is 23 characters
against a shelf whose longest is `"Dots and Boxes"` at 14, in a `.home-tile-title`
(`styles.css:4155`) that has no truncation or clamp, on a shelf whose floor is 360px —
so it would wrap to three lines in a tile and need clamp CSS the other 16 games do not
have. An optional `subtitle` keeps tiles and the drawer at 11 characters, keeps the
name whole where there is room (how-to page, game header), and keeps the PWA
`short_name` inside the ~12-char truncation `TODO/pwa.md` warns about.

**Why `tools/intake.mjs` needs extending rather than the files being renamed by hand.**
The drop-off exists precisely so art can arrive named the way a person names things
(`cbf932f`: "Demanding the internal id was asking the drop-off to know the codebase").
All three supplied files are named the way a person names things —
`trio_tumble_horizontal_splash.png` — and the tool rejects two of them, because the
shape-word strip at line 182 only fires on a **trailing** word and only knows
`portrait|landscape|square`. Hand-renaming the files would leave the next drop-off
broken in exactly the same way. Extending the tool is the fix the tool's own stated
purpose asks for. The second splash slot is separately justified: `intake.mjs` already
measures aspect ratio and already documents (line 100) that "a PWA splash is not one
image you supply".

## Verified assumptions

Each measured on `b5c0399` before writing this plan.

- `splash.jpg` is referenced by no source file and appears 0 times in `dist/` —
  the Ring Pop wordmark has never been published. `icon.jpg` is live via `src/home.ts:36`.
- 118 files reference `match3`/`Match-3` outside build outputs: 662 `match3`, 154
  `match-3`, 66 `Match3`, 59 `match3_`, 37 `Match-3`, 7 `MATCH3`.
- Rust type names to rename: `Match3` ×18, plus `Match3Blockers`/`Jelly`/`Ingredients`/
  `Checklist`/`Obstacles` ×4 each.
- **`m3` as a bare substring is NOT a rename target.** Its 459 hits are dominated by
  hash constants (`b"m3\x00"`) and unrelated identifiers in eleven other crates'
  `rng.rs`/`hash.rs`. Only the seven `m3*` locals in `build.mjs` (lines 117–198) are
  ours, and they are cosmetic.
- Pack kinds in the 7 committed JSONs: `match3-{par,blockers,jelly,ingredients,checklist,obstacles,campaign}-pack`.
  `campaign-pack.json` is pretty-printed (`"kind": "…"` with a space) — a `"kind":"…"`
  regex misses it. Noted because it did.
- Outcome kinds in `crates/match3-wasm/src/lib.rs`: `match3-blockers` (705),
  `match3-jelly` (732), `match3-ingredients` (760), `match3-checklist` (789),
  `match3-obstacles` (819).
- `crates/match3-wasm/src/lib.rs:59` includes `games/match3/par-pack.json` by relative
  path — the pack directory move must be paired with this line.
- `tools/intake.mjs` `gameAliases()` maps both id and `slug(title)` to the id, so
  `trio_tumble_*` drops resolve once `id: "trio-tumble"` exists.
- No conflicting claim; the one other live `fun` worktree (`claude/orchard-tier1-plan`)
  touches `spike/orchard-physics` only.

## Phases

Each phase ends green and gets its own commit (repo rule: commit at every stable point).

- **Phase 0 — survey + decisions.** ✅ Complete. This document.
- **Phase 1 — Rust rename.** Crate dirs, `Cargo.toml` names, workspace members,
  `Cargo.lock`, `use match3_core::` → `use trio_tumble_core::`, `Match3*` types,
  outcome kinds, pack kinds (generator + reader + the 7 envelope lines), `games/match3/`
  → `games/trio-tumble/`, the `include_bytes!` path. Hash prefix untouched.
  **Gate:** `npm run test:rust` (fmt + `cargo test --workspace --release` + clippy),
  and the 26 golden vectors must pass **unchanged** — that is the proof the hash did
  not move.
- **Phase 2 — web rename.** Registry id/title, `src/games/match3*` → `trio-tumble*`,
  imports, `build.mjs` (`GAME_PAGES`, wasm copy, 7 pack copies, `m3*` locals),
  `src/music.ts`, `src/how-to-registry.ts`, `tools/guide-shots.mjs`, the 5 test files,
  `assets/guide/match3-*.jpg` → `trio-tumble-*.jpg`. **Gate:** typecheck, lint, unit,
  build, e2e.
- **Phase 3 — docs + backlog.** `TODO/match3.md` → `TODO/trio-tumble.md` (+ its README
  entry), `docs/MATCH3-STORY.md` → `docs/TRIO-TUMBLE-STORY.md`, `docs/BUILDING-GAMES.md`,
  `docs/DESIGN.md`, `docs/AI-PLAYERS.md`, `docs/RESPONSIVE-DESIGN.md`, `README.md`,
  `CLAUDE.md`. The 15 historical `plans/*-match3-*.md` docs are **renamed** to
  `*-trio-tumble-*.md` and their identifier references updated; narrative use of
  "match-3" as the genre stays. **This plan doc is excluded from every rename sed** —
  its "From" column and Problem Statement must keep saying `match3`, and one sed pass
  rewrote them to "rename `trio-tumble` to `trio-tumble`" before being restored.
  **Gate:** unit (the how-to sync tests read doc data).
- **Phase 4 — the `subtitle` contract field.** RED first: a test asserting the how-to
  page renders the subtitle, and a registry test asserting `subtitle` is optional and
  absent on the other 16 games. Then `readonly subtitle?: string` on `BaseGameEntry`,
  the render in `src/how-to-page.ts`, and `subtitle: "Jewel Drop"` on the entry.
  **Gate:** typecheck, unit, e2e, axe in both skins.
- **Phase 5 — intake extension.** RED first: table-driven tests over the filename
  parser for mid-stem shape words, `horizontal`/`vertical` synonyms, and the second
  splash slot. Then the parser change and a `splash-landscape` kind writing
  `assets/splash-landscape.jpg`. **Gate:** unit; a dry run over the three real files
  must plan three writes and zero skips.
- **Phase 6 — land the art.** Run intake `--go` over the owner's three files, then
  regenerate the how-to guide shots (`npm run build:wasm && npm run build &&
  npm run guide:shots`), staging only this game's shots per the repo's churn rule.
  **Gate:** `tests/art.test.ts` asserts the `icon: true` claim against the filesystem
  in both directions.
- **Phase 7 — full gate + land.** `npm run gate` at exit 0 against the final tree,
  toolchain resolved through `rustup which` rather than bare PATH. Then land per
  workspace Rule 2: `merge --no-ff` from the `fun` main checkout, then push.

## Risks

- **A missed identifier compiles but breaks at runtime.** Rust and TS catch renames at
  compile time; the ones that do not are *string* identifiers — outcome kinds, pack
  kinds, URL paths, asset paths. Mitigation: after Phase 2, a repo-wide grep for
  `match3` must return only the deliberate exceptions (hash prefix, historical plan
  filenames), and that grep is part of the Phase 7 evidence rather than a spot check.
- **Guide-shot churn.** `guide:shots` rebuilds every game's JPEGs and they re-encode
  differently run to run. The repo rule is to stage only the changed game's shots; a
  bulk `git add` here would produce a diff touching 16 unrelated games.
- **Pack payloads drifting.** The only intended edit to the 7 JSONs is the envelope
  `kind` line. Verify with a diff that shows one changed line per file.

## Review Log

- **2026-08-28 — owner, name.** Asked whether "Ring Pop" collides with the Topps mark.
  Advised yes, rename, with the exposure measurement (wordmark unpublished) as the
  reason it is cheap now. Owner chose **Trio Tumble: Jewel Drop** and supplied three
  replacement art files.
- **2026-08-28 — owner, rename depth.** Chose the **full** rename (crates, outcome
  kinds, pack dir) over display-name-only, accepting that existing `?r=` share links
  stop verifying.
- **2026-08-28 — owner, title placement.** Chose **add a subtitle field** over a
  longer title or a shortened one, having been shown the 23-vs-14-character
  measurement and that it is a contract change beyond a pure rename.
- **2026-08-28 — owner, splash.** Chose **keep both orientations, extend intake** over
  picking one, having been shown that it is a tool change with its own tests beyond a
  pure rename.
- **2026-08-28 — agent, plan filenames (reversal).** Phase 3 originally said the 15
  historical `plans/*-match3-*.md` docs keep their filenames as a record of what was
  done under the old name. Reversed during Phase 1: three of them are cited from Rust
  doc comments, the Phase 1 sed rewrote those citations, and the result was three
  dangling paths. Keeping the old filenames would have meant reverting citations to
  point at files whose names no longer match any identifier in the tree — and a reader
  grepping `trio-tumble` would find the game's code but not its history. Renamed all
  15; git preserves the old names. Recorded as a reversal rather than edited silently,
  because the first choice was written down and someone may have read it.
- **2026-08-28 — agent, this doc is sed-excluded.** The Phase 3 doc sweep rewrote this
  plan's own "From" column, turning the rename table into `trio-tumble` → `trio-tumble`
  and the Problem Statement into a claim the game already had its new name. Restored
  from the Phase 0 commit and the two later edits re-applied by hand. A document whose
  job is to record what something *used to be called* cannot be inside the sweep that
  renames it; every later sweep excludes this path explicitly.
- **2026-08-28 — agent, hash prefix.** Decided unilaterally to leave `b"m3\x00"`
  unchanged; reasoning under "Why the hash prefix stays" above. Flagged here rather
  than buried because it is the one place this plan deliberately leaves the old name in
  the source, and a future reader will otherwise read it as an oversight.
