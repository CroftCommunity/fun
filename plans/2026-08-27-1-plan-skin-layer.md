# A skin layer for the shelf — two identities, one app

**Status:** Pass 1 (shape). Not started. Four owner decisions recorded (D1–D4); three open
questions remain (O1, O2, O4), none blocking the first phase. O3 settled 2026-08-27 → D4.

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
  Build the layer, measure the full matrix on CI, then choose. See "Verified assumptions".

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
  on their preference field.

  *Rejected alternative worth recording:* `forage/ledger/divergence.js` looked like the
  cross-repo drift mechanism and is not — it tracks substrate and engine-variant parity
  **inside** forage. Nothing in this workspace tracks repo-to-repo divergence except
  `DECISIONS.md` and the audit script.

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

- **M0 — declare the shared dimension** (D4). A thin `.claude/SKINS.md` index pointing at
  forage's ADR-003 and `SKINS.md` as canonical, a row in the `CLAUDE.md` dimension table, and
  the audit check with its fixtures. **Lands in `CroftC`, not here** — the orientation layer
  is a separate repo and a contested surface, so it needs its own branch and claim per
  `COORDINATION.md`. Do this before M2 writes fun's registry, so fun's implementation is
  checked from its first commit rather than retrofitted.
- **M1 — the token split.** Divide `tokens.css` into chrome roles and game palettes with a
  declared allowlist; port `skinScan` from `forage/js/skins.js` and gate it in `tests/`.
  Nothing user-visible changes. This is the phase that makes every later one safe.
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
- **M6 — measure the a11y matrix, then decide D3.**

## Open questions

- **O1 — where does `prefersLayout` live, family or skin?** Forage moved `prefersDensity` onto
  the FAMILY specifically because two skins in one family could otherwise disagree, and a
  disagreement means toggling palette silently re-lays-out the page. The same argument applies
  unchanged, so family is the presumed answer — but it should be recorded as a decision rather
  than inherited by imitation.
- **O2 — does this warrant an ADR in `fun`?** `fun/docs/` has no `adr/` directory today; forage
  has one. If yes, allocate with `bash .claude/bin/next-id.sh adr fun` — **not by eye**, per
  `TRACKING.md` § ID discipline. Not allocated yet, deliberately: an id reserved for a plan that
  may not land is waste.
- ~~**O3 — is the skin mechanism itself shared code or parallel implementations?**~~
  **Settled 2026-08-27 → D4:** independent implementations, shared contract, enforced by a new
  audit check. The undeclared edge `ARCHITECTURE.md` warns about is closed by M0 rather than
  left to imitation.
- **O4 — does Ring Pop's rename land inside this plan or beside it?** The mocks call Match-3
  "Ring Pop" throughout on the owner's 2026-08-27 decision, but the rename touches the registry
  id, the how-to guide, seven campaign packs and every `?r=` share link. It is independent of
  the skin layer and probably wants its own plan.

## Review Log

*(empty — Pass 1 shape only, nothing executed)*
