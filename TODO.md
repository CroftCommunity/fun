# fun — TODO

> Known work only — items whose shape is already decided, and which may therefore be
> proposed as work. Anything still an open question (decide / verify / investigate /
> reconcile) belongs in the backlog of record, `discovery/alpha/ROADMAP_TODO.md`,
> however small or operational it is. Tracking scheme: `CroftC/.claude/TRACKING.md`;
> the two piles and why: its § "Two piles". Plan status lives on each plan's `Status:`
> line; `docs/STATE-OF-PLAY.md` is the dated narrative, not the work list.

## Mocks (`CroftC/.claude/MOCKS.md`)

- **The four direction sketches carry no version and no baseline** — `mocks/b-worlds.html`,
  `c-pond.html`, `d-game-frame.html`, `pwa.html` (rules 1–2; check 44 flags them on every
  audit). They are sketches (drawings, not built from the game code) and predate the rules.
  Owed: `mock-version` (1) and `mock-baseline` (`fun@<sha they were drawn at>`, from
  `git log --diff-filter=A`), `SKETCH` in each title, and the Revisions block. No captures
  are owed for a direction study; rule 8 does not apply until one is built.
- **`e-color-sort.html` is built (rule 7) but names no `mock-proposal`** (rule 8). Its
  Shipped-per-phase captures from `tools/mock-snaps.mjs` are the right shape; the owed part
  is the meta naming the branch sha the Proposed frames came from, so check 44 can resolve it.
