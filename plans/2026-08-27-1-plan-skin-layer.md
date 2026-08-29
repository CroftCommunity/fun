# A skin layer for the shelf — two identities, one app

**Status:** M0–M6 COMPLETE (2026-08-28). Originally Pass 1 (shape). Seven decisions recorded (D1–D7);
**no open questions remain.** O1–O3 settled 2026-08-27 → D5, D6, D4. O4 settled 2026-08-28: the rename
landed beside this plan (`plans/2026-08-28-2-plan-trio-tumble-rename.md`), and the name changed from
Ring Pop to **Trio Tumble: Jewel Drop** on a trademark collision.
M0 was attempted 2026-08-27 and **deferred** on `PATTERN.md`'s own bar — see D7.

**Owner decision (2026-08-27):** both mock directions are wanted, shipped together —
**Gallery of Worlds is the default**, The Pond is selectable. Mocks that produced this:
`mocks/b-worlds.html`, `mocks/c-pond.html`, hub at `mocks/index.html`.

## Problem Statement

The shelf's front door is one sentence — "Pick a game from the drawer to play." — over an empty
page, with twenty games behind a hamburger. Two full UI/UX directions were mocked (2026-08-27)
and the owner wants **both**, chosen from a picker, rather than picking one.

That is a skin layer. The trap is that it is **not a colour swap**, and the sibling repo has
already proved why.

**Forage solved most of this, and its answer forbids the obvious approach here.** `forage`
ships a skin system with an accepted ADR — `forage/docs/adr/0003-skins-subsume-themes.md`,
"Skins subsume themes — one skin carries one palette" — plus `forage/docs/SKINS.md` and
`forage/js/skins.js`. Two of its rules are load-bearing and both apply to us:

1. **A skin carries exactly one palette.** Light/dark is not a second axis; it is two registry
   entries in one FAMILY, and the ☾/☀ toggle swaps to the family's other side, *visibly
   disabled* where none exists. `js/skins.js` has since moved past the ADR: `pairedWith` is
   gone and the sibling is **derived** from family + palette, which makes asymmetric, dangling
   and self-paired registries structurally impossible rather than merely validated.

2. **A skin restyles anything and restructures nothing.** `skinScan()` rejects any component
   property or undeclared token, and `SKINS.md` states the reason plainly: a skin that could
   ship component CSS could write `.card { display: none }` and hide a moderation notice.
   The doc is explicit that **"a skin cannot change layout"** and that row density is a
   *registered frontier* (`DL-028`), not a gap to be filled by accident. That frontier is now
   marked `resolved` in `forage/ledger/divergence.js`, and `prefersDensity` is how — which is
   precisely the precedent this plan leans on.

Under rule 2, "make The Pond a skin" is illegal. Pond is not a palette. Its home page is a
plate plus labelled shelf sections carrying editorial blurbs; Worlds' is a full-bleed splash
hero plus a today strip and an icon grid. Different DOM, different information architecture,
different navigation. A stylesheet cannot express that, and the mechanism is built so it
cannot try.

So the real question is: **what is the smallest thing that lets a skin express a structural
identity without handing it structural power?**

## Approach

**Adopt forage's model, and reuse the escape hatch forage already invented for exactly this.**

`forage/js/skins.js` on density, which is the precedent:

> A skin may PREFER a board density (`prefersDensity`, DL-028). It is a **SUGGESTION**: a
> reader's explicit choice from the dial on the board always wins, in both directions. **A skin
> picks from the densities the app already ships — it is never handed layout properties — so it
> cannot express anything the reader cannot reach from that same dial.**

Transposed: **the app ships both home layouts as first-class, independently reachable options.
A skin only expresses a preference among them.**

```
FAMILY                  SKINS (one palette each)      prefersLayout
──────────────────────────────────────────────────────────────────
"Gallery of Worlds"     worlds-light  ◄──┐            today-first
  (default)             worlds-dark   ◄──┘ ☾/☀
"The Pond"              pond-light    ◄──┐            shelf
                        pond-dark     ◄──┘ ☾/☀
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
  LAYOUT: today-first                            LAYOUT: shelf
  hero · today strip · icon grid                 plate · labelled sections · list rows
  bottom tab bar                                 footer links
        └───────────────────┬───────────────────────────┘
                            ▼
                     ONE ShelfModel
        resume · today[] · groups[{label, headline, blurb, games[]}]
        computed once, skin-agnostic; a layout renders a SUBSET
```

Both layouts are app code — enumerated, individually selectable in Settings, individually
tested. The skin's `prefersLayout` seeds the choice; an explicit user choice wins in both
directions, exactly as forage's density dial does. Adding a game or a daily pack updates both
layouts for free because neither owns data; only presentation differs. Pond's blurbs live in
the model as group metadata and today-first simply does not render them, so no copy is
duplicated.

**The picker shape follows forage's**, which landed on family rows rather than skin rows: the
Settings sheet (`src/settings-sheet.ts` → `renderSettingsSheet`) lists **two style rows**
(Gallery of Worlds / The Pond), and the header keeps ☾/☀ to choose the side. That is the
dropdown the owner asked for.

### What fun needs that forage did not: a skinnable-token split

Forage's `css/tokens.css` is fifteen roles, all legitimately skinnable. Fun's `tokens.css` is
roughly a hundred, and most are **game-owned**: `--al-i`…`--al-l`, `--cs-c0`…`--cs-c11`,
`--fur-board`, `--dots-paper`, `--wy-correct`, `--t48-*`, `--chk-*`.

Letting a skin assign those is not merely untidy. `tokens.css` says of Align's palette:
"Deliberately NOT the guideline shape-to-colour mapping (**IP guardrail**)." A skin able to
repaint it could walk straight back into the thing that comment exists to prevent. Several
others are colour-blind-safety commitments where the shape carries the meaning and the hue is
the second signal.

So `tokens.css` splits into two declared groups, and `skinScan`'s allowlist is the **chrome**
group only:

| Group | Examples | Skinnable |
|---|---|---|
| Chrome roles | `--bg` `--surface` `--ink` `--ink-muted` `--accent` `--border` `--focus` `--radius` `--font-display` `--font-body` | **yes** |
| Game palettes | `--al-*` `--cs-*` `--fur-*` `--dots-*` `--wy-*` `--t48-*` `--chk-*` `--oth-*` `--gem-*` `--felt` `--card` `--suit-*` | **no** |

**This retracts something in the Pond mock.** `mocks/c-pond.html` renders Othello on a paper
board with outlined discs. That was the mock over-reaching, and it is illegal under D2 below.
Pond's *chrome* is paper; Othello's board stays green felt in both skins. Pulling that back is
most of what makes the work tractable, and it is more consistent with the shelf's own premise
that each game is its own world.

## Reasoning

**Why not keep theme and skin as independent axes.** It was the first instinct and forage
already rejected it with evidence. ADR-003 records that synthesising a dark variant of a
single-palette theme produced a foreground/background pair co-occurring nowhere in the real
theme, measuring **1.19:1 against its true 16.17:1**. Fun does not import third-party themes,
so that specific failure cannot bite us — but the other consequence does: two axes means every
identity must ship both palettes *and* hand-sync them, which is the drift hazard ADR-003
removed by collapsing `css/tokens.css` from 147 to 86 lines *at the time* (it has since grown
back to 129 — the hazard was the three-way hand-sync, not the line count). Keeping two axes here would also
put fun and forage on different vocabularies for the same concept, in a workspace whose
`ARCHITECTURE.md` treats an undeclared seam between repos as a defect.

**Why layouts are app code and not skin code.** The security argument that motivates forage's
`skinScan` (untrusted imported phpBB styles) does **not** transfer — fun's skins are
first-party. But the *legibility* argument does, and it is the stronger one here: a skin that
ships renderers is a skin that can silently drop a surface. With an enumerated layout registry,
adding a surface fails loudly for every layout at once instead of degrading one of them
quietly. It also keeps both layouts reachable independently, which is what makes the
"suggestion, not a lock" property real rather than nominal.

**Why the ShelfModel is separate.** Twenty games, eight daily packs, campaign progress and
resume state are the same facts in both layouts. Computing them once is the difference between
a second layout costing a renderer and costing a parallel data path that drifts.

**Why family-shaped picker rather than four skin rows.** Forage tried skins-as-rows and moved
to families, recording that the model stayed "one skin, one palette" and only the presentation
changed. Four rows here (worlds-light, worlds-dark, pond-light, pond-dark) would present the
palette twice — once in the picker, once in the toggle — and invite the misreading that
light/dark came back as an axis.

## Decisions

- **D1 — Worlds ships light and dark, both first-class** (owner, 2026-08-27). No disabled
  toggle on the default family. Costs a properly designed and graded `worlds-light`; the mock's
  light variant is a starting point, not a finished palette.
- **D2 — Skins reach chrome only** (owner, 2026-08-27). Game palettes are game-owned and
  untouchable, per the IP-guardrail and colour-blind-safety commitments above. Boards render
  identically in both skins.
- **D3 — The a11y budget is decided on a measurement, not an estimate** (owner, 2026-08-27).
  **Resolved 2026-08-28 → take the FULL matrix.** Measured locally (7 workers) rather than
  estimated:

  | | tests | local |
  |---|---|---|
  | e2e suite before | 507 | 66s |
  | e2e suite with the full matrix | 531 | 83s |
  | matrix alone | 24 | 20.2s |
  | ├ shared surfaces × 4 skins | 16 | 7.3s |
  | └ every game × 4 skins | 8 | 18.3s |

  **+17s locally ≈ +1.4 min on CI** (`CLAUDE.md` records CI ≈ 4.9× local for the browser
  half), taking `e2e` from roughly 5.4 to 6.8 minutes. It is the critical path, so that is
  a real 25% on the longest job.

  Taken anyway, because the standard is explicit — "every page × every theme/skin, zero
  excluded rules by default" — and four palettes is precisely the situation it anticipates.
  "It costs 84 seconds" is not a reason to grade three of four skins. The tempting
  reduction (a representative game page instead of all twenty) is wrong on inspection: each
  game renders its OWN controls into the play area using chrome tokens, so twenty pages
  carry twenty different chrome surfaces, not one repeated.

  *The lever, if CI time later becomes the binding constraint,* is the games half —
  **18.3s of the 20.2s**, measured, so the trade can be made with a number attached rather
  than by feel.

  *And the estimate this replaces was wrong.* This plan predicted "roughly doubles the
  scans … likely 4.5 → 8 min". The real numbers are 5.4 → 6.8. Same direction, wrong
  magnitude — which is the entire reason D3 existed.

- **D4 — share the contract, not the code** (owner, 2026-08-27; settles O3). forage and fun
  keep **independent implementations**; the shared artifact is the *model*, promoted to the
  workspace layer, plus an audit check that enforces it.

  *Why not a shared package.* forage has **no build step** — `package.json` declares no
  `build`, and `index.html` loads `/js/main.js` raw as `<script type="module">` with absolute
  paths and no resolver. fun is TypeScript through esbuild under a no-`any` rule. A shared
  module would therefore have to be plain ESM JS that fun imports untyped and forage vendors
  or path-aliases. Measured against that: `js/skins.js` is **151 lines of code across 22
  exports**, of which only ten are portable — `familyOf`, `familyMembers`, `resolveInFamily`,
  `families`, `prefersDensityFor`, `validateFamilies`, `siblingOf`, `resolveDefault`,
  `declaredTokens`, `skinScan` — roughly sixty lines, every one already taking
  `(registry, fams)` as defaulted parameters. The other twelve are storage, DOM and
  `<link>` glue each repo must own regardless.

  *And the requirements are already diverging.* forage has `prefersDensity` and a phpBB
  importer; fun needs `prefersLayout` and the game-token guardrail. The token vocabularies
  share nothing: forage's roles (`band-fill`, `row-odd`, `nav-fill`) are lifted from real
  phpBB selectors, which is what makes its importer a near-identity mapping. Extracting a
  common module at the moment two consumers visibly diverge is the abstraction this
  workspace's own `DECISIONS.md` exists to prevent.

  *What is shared, then.* The semantics: one skin one palette; family canonical with the
  sibling derived; a skin assigns only declared tokens; a skin's preference is a suggestion
  the user's explicit choice overrides. Those are already written — in `forage/docs/adr/
  0003-skins-subsume-themes.md` and `forage/docs/SKINS.md` — and `DECISIONS.md` already
  carries the `forage/0003` row. The workspace layer gains a **thin index doc pointing at
  them**, following the established shape (`CI-PATTERN.md` → `croft-pwa/docs/CI.md`;
  `WEB-TESTING.md` → `croft-pwa/docs/WEB-TESTING.md`), never a second copy of the rules.

  *Checked, not just written.* `PATTERN.md` is explicit that a new cross-repo dimension is not
  done until its rule has a check with harvested fixtures. So M0 adds one to
  `.claude/bin/workspace-audit.sh` (28 checks today), asserting both repos use the same
  vocabulary, that neither reintroduces a second theme axis, and that a family's members agree
  on their preference field. **M0 runs after M2, not first — see D7:** that same section of
  `PATTERN.md` is why, because the fixtures cannot be harvested until fun has a registry.

  *Rejected alternative worth recording:* `forage/ledger/divergence.js` looked like the
  cross-repo drift mechanism and is not — it tracks substrate and engine-variant parity
  **inside** forage. Nothing in this workspace tracks repo-to-repo divergence except
  `DECISIONS.md` and the audit script.

- **D5 — `prefersLayout` lives on the FAMILY, not the skin** (settles O1). Recorded rather
  than inherited, because the argument is forage's and transfers with no adaptation.
  `forage/js/skins.js` on its own equivalent:

  > `prefersDensity` (DL-028) lives HERE and not on the skin. It used to sit on each phpBB
  > entry independently, where nothing stopped the two from disagreeing — and a disagreement
  > means toggling palette silently re-lays-out the board. One home deletes that class.

  Identical here: on the skin, `worlds-light` and `worlds-dark` could disagree, and ☾/☀ would
  silently re-lay-out the home page — a control that looks purely cosmetic changing the
  information architecture. On the family the class does not exist, so fun's `validateFamilies`
  equivalent has one fewer thing to check rather than one more. That layout is a *home page*
  property where forage's density is a *board* property changes nothing: the failure mode is
  the same surface-swap under a palette toggle.

- **D6 — fun starts `docs/adr/` with exactly one ADR: the token split** (settles O2). Two
  halves, and the second is the point.

  *No ADR for adopting skins-subsume-themes.* D4 says point at forage's ADR-003, never copy it.
  An ADR in fun reading "we adopt ADR-003" would be precisely the second copy of the rules that
  D4 forbids, and it would create two places for the model to drift.

  *An ADR for the chrome/game token split, because that one has no upstream.* It is fun's own
  decision, driven by fun-specific facts — roughly a hundred tokens of which most are
  game-owned, the Align IP guardrail, and the colour-blind-safety commitments where shape
  carries the meaning and hue is the second signal. It constrains every future skin and every
  future game, which is what an ADR is for.

  *Conventions are already fixed and starting the directory is free.* Audit check 11 is
  conditional — `if [ -d "$ROOT/$r/docs/adr" ]` — so fun having none today is compliant. Once
  it exists, the check requires `NNNN-slug.md` naming and a registered `fun/NNNN` row in
  `.claude/DECISIONS.md`, and separately flags ADR-shaped files anywhere outside `docs/adr/`.
  The ADR is written **with M1**, where the split actually lands. The id is allocated then with
  `bash .claude/bin/next-id.sh adr fun` — not now, and not by eye (`TRACKING.md` § ID
  discipline); an id reserved for a plan that may not land is waste.

- **D7 — M0 is deferred until fun's skin layer exists** (2026-08-27, correcting this plan's
  own sequencing). M0 was written to land *before* M2 so fun's registry would be checked from
  its first commit. Attempting it surfaced that `PATTERN.md` refuses it, on two grounds, the
  second decisive:

  *The bar.* `PATTERN.md` § "When NOT to add a convention": "A concern with no second instance
  yet is a note in the owning repo, not a workspace doc — the pattern here was extracted from
  five applications, **not predicted from one**." The skin model has exactly one built
  instance today. Fun's is planned and unstarted. croft-pwa shares fun's *token* architecture
  but has no families, no one-palette skins, no preference-not-lock rule — so it is not a
  second instance of this concern.

  *The check cannot be validated.* `PATTERN.md` step 5 requires an audit check proven **RED on
  known fixtures, then GREEN**, and is emphatic that "fixtures come from the shapes actually in
  use, harvested — never invented", listing four checks that passed their invented fixtures
  while proving nothing (check 12's pointer grep, the teardown check's empty branch, the
  version check reading a declared range, the destructive-git guard's wrong-tree shape). The
  check M0 proposes compares fun's skin vocabulary against forage's. **Fun has no vocabulary
  yet**, so there is nothing to harvest and the only available fixtures would be invented —
  precisely the failure mode that section documents. The check is unwritable today on the
  pattern's own terms, not merely premature.

  *What carries the load meanwhile, which turns out to be everything needed.* forage's
  `docs/adr/0003-skins-subsume-themes.md` and `docs/SKINS.md` **are** the "note in the owning
  repo" the bar prescribes, and `.claude/DECISIONS.md` already carries the `forage/0003` row —
  the register agents are told to grep first before building a capability. D4's mechanism is
  therefore already in place; nothing is missing today, and no `CroftC` change is warranted yet.

  *Re-sequenced:* M0 runs **after M2**, when fun's registry exists and its shapes can be
  harvested. The cost accepted is that fun's first registry commits are checked by fun's own
  suite rather than by the workspace audit — which is the correct division anyway, since a
  workspace check exists to catch *divergence between* two implementations and cannot mean
  anything until both exist.

## Verified assumptions

Checked in this repo at `e453afb`:

- `build.mjs` `THEME_INIT` is the pre-paint script; it reads `localStorage['fun-theme']` and
  stamps `data-theme`. `src/theme.ts` `KEY` holds the same string. Both change under this plan.
- `src/settings-sheet.ts` `renderSettingsSheet` is the existing settings surface the picker
  joins.
- `build.mjs` copies only `assets/` and each Tier-2 `vendor/` directory, so `mocks/` is inert
  and nothing in this plan is blocked on removing it.
- `tests/theme.spec.ts` currently axe-scans the home page and the solitaire board in **both**
  themes, and asserts the chrome and board consume tokens. It is the file that grows most.

Explicitly **not** verified, and therefore not asserted anywhere above:

- The CI cost of the full a11y matrix. The repo's own record warns against guessing here: the
  last parallel-job estimate in `CLAUDE.md` predicted "no added wall clock" and was wrong by
  about a minute, because a GitHub runner gives Playwright 2 workers where a laptop gives 7.
  D3 exists because of that entry.
- Whether `worlds-light` clears every contrast floor. The mocks were never contrast-checked.

## Milestones

- ~~**M0 (as first sequenced, before M1)**~~ — struck 2026-08-27 per D7, not deleted, so the
  reason survives: `PATTERN.md` refuses a workspace dimension predicted from one instance, and
  its audit check has no harvested fixtures to be proven RED against until fun has a registry.
  It now runs after M2 and carries `PATTERN.md`'s full five-surface funnel: the canonical
  `.claude/SKINS.md` index pointing at forage's ADR-003 and `SKINS.md`, a compressed row in the
  `CLAUDE.md` dimension table, a line in COORDINATION's layer listing, a line in the human
  `README.md`, a `workspace/skins` row in `DECISIONS.md`, and the audit check proven RED first.
  **Lands in `CroftC`, not here** — the orientation layer is a separate repo and a contested
  surface, so it needs its own branch and a claim per `COORDINATION.md`.
- **M1 — the token split.** Divide `tokens.css` into chrome roles and game palettes with a
  declared allowlist; reimplement `skinScan` in TypeScript (D4: independent implementation) and
  gate it in `tests/`. Carries fun's first ADR (D6), id allocated at write time. Nothing
  user-visible changes. This is the phase that makes every later one safe.
- **M2 — skins subsume themes.** Registry (`FAMILIES`, `SKINS`, sibling derived from family +
  palette), `resolveSkin`, the rewritten pre-paint script, retirement of `theme.ts` and
  `resolveTheme` with **no migration shim** (pre-1.0, per the workspace rule). Ships with the
  existing look re-expressed as one family, so the diff is provably behaviour-preserving.
- **M3 — the ShelfModel and the two layouts.** Extract the model, build `today-first` and
  `shelf` as registered layouts, add `prefersLayout` as a suggestion with the user's explicit
  choice winning both ways.
- **M4 — the four palettes.** Design and grade `worlds-light`, `worlds-dark`, `pond-light`,
  `pond-dark`; rewrite `docs/DESIGN.md`'s contrast table from two columns to four, each palette
  graded on its own terms.
- **M5 — the picker.** Two family rows in the settings sheet, ☾/☀ keeps its place in the header.
- ~~**M6 — measure the a11y matrix, then decide D3.**~~ **Done 2026-08-28.**
  `tests/a11y-matrix.spec.ts` enumerates REGISTRY × SKINS in one place rather than
  scattering the matrix across twenty specs. It found **a real bug that had shipped**: the
  drawer's `<ul>` contained `<a>` elements directly, which axe's `list` rule fails. It
  survived because every existing scan ran with the drawer CLOSED — and therefore
  `hidden`, so axe skipped it entirely. Nobody had ever scanned the open drawer.
- **M0 (re-sequenced, runs after M2)** — declare the shared dimension, per D7 above.

## Open questions

- ~~**O1 — where does `prefersLayout` live, family or skin?**~~ **Settled 2026-08-27 → D5:**
  the family, on forage's own recorded argument.
- ~~**O2 — does this warrant an ADR in `fun`?**~~ **Settled 2026-08-27 → D6:** one ADR, for the
  token split only — not for adopting a model that already has an ADR upstream.
- ~~**O3 — is the skin mechanism itself shared code or parallel implementations?**~~
  **Settled 2026-08-27 → D4:** independent implementations, shared contract, enforced by a new
  audit check. The undeclared edge `ARCHITECTURE.md` warns about is closed by M0 rather than
  left to imitation — after M2, per D7.
- ~~**O4 — does Ring Pop's rename land inside this plan or beside it?**~~ **Settled
  2026-08-28: beside it, and the name itself changed.** Its own plan,
  `plans/2026-08-28-2-plan-trio-tumble-rename.md`. Two things moved after this question was
  written. First, **the name is not Ring Pop** — RING POP is a live Topps / Bazooka Candy
  Brands mark, and the art applied it to a candy-matching game depicting a gem ring, which is
  the mark used for the thing the mark names. The owner chose **Trio Tumble: Jewel Drop** and
  supplied replacement art. Second, this entry's "the mocks call Match-3 Ring Pop throughout"
  is **no longer true**: the mocks, their brand art filenames and their prose were renamed as
  part of that plan, so no Ring Pop reference survives outside the two docs that record the
  decision (this line and the rename plan). The scope estimate here held — registry id, how-to
  guide, packs and every `?r=` share link — and the rename additionally took the three Rust
  crates, the outcome kinds and the pack kinds.

## Review Log

- **2026-08-27 — Pass 1 written, then settled in three rounds.** The plan opened with four
  open questions. O3 was settled first at the owner's direction and turned on a fact not in
  the original draft — forage has no build step — which moved the answer from "extract a
  shared package" to "share the contract". O1 and O2 then settled from the record rather than
  from preference: O1 by forage's own `prefersDensity` argument, O2 by audit check 11 being
  conditional, so starting `docs/adr/` is a free choice and the only ADR-worthy decision here
  is the one with no upstream to point at. O4 stayed open and was settled on 2026-08-28 in its own plan — beside this one, and
  with the name changed from Ring Pop to Trio Tumble on a trademark collision.
  Nothing has been executed.

- **2026-08-28 — M1 through M6 executed; two real defects found by the new gates.**
  M1's token split and M2's registry landed behaviour-preserving. M3's home layouts turned
  up a contrast bug in code written the same hour — `--accent` used as text at **2.13:1**
  in the light palette, legible in dark, which is exactly why each palette is graded on its
  own terms. M6's matrix turned up the drawer `<ul>`/`<a>` violation described above,
  which had shipped and was invisible to every prior scan. Both are now pinned by tests.
  The a11y cost was measured, not estimated, and the plan's own estimate was wrong.

- **2026-08-27 — M0 attempted and deferred (D7).** Execution started with a state
  reconstruction of `CroftC` (clean, `main` level with `origin/main`, three peer commits to
  `.claude/` today) and a read of `PATTERN.md` before designing, per its step 1. That read
  stopped the work: the dimension would be predicted from a single instance, and its audit
  check has no shapes to harvest fixtures from until fun's registry exists. No `CroftC`
  branch, claim or commit was made. Recorded because the plan's own sequencing was wrong and
  improvising around `PATTERN.md` is, by its own words, how the pattern collapses.
