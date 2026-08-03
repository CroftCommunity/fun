# TODO — puzzles (native, later)

Status: **not started.** A Tier-1 (build-fresh) direction, replacing a tried-and-removed Tier-2 embed.

## Why not embed (learning, 2026-08-03)

We wrapped Simon Tatham's Portable Puzzle Collection (MIT) as a Tier-2 iframe
(Net) and **tore it out**. Embedding the upstream emscripten build in our
opaque-origin sandbox produced a tiny, fixed-size, **light-theme, mouse-only**
board dropped into our dark chrome — unreadable, off-theme, and not tap-first. A
foreign WASM canvas can't inherit our tokens, our sizing, or our input model, so
it fought everything the shelf stands for.

Conclusion: **don't embed these — build them fresh** the Tier-1 way
(determinism-first Rust core → wasm, verifiable move-replay → state hash + `?r=`
re-verify, tap-first with the core deciding legality, our tokens with light/dark,
a build-time solver → winnable/unique daily pack). Mechanics aren't
copyrightable; the names below are Tatham's — choose our own names when building.

## Native-build candidates (best shelf fit first)

Pure-deduction, discrete-move, unique-solution puzzles — the sweet spot for our
verifiable + tap-first + daily-pack model:

- **Minesweeper** (Tatham "Mines") — reveal/flag; seeded mines; a no-guess solver
  makes a fair daily.
- **Nonograms / Picross** (Tatham "Pattern") — fill cells from row/column clues;
  unique-solution solver → daily.
- **Sudoku** (Tatham "Solo") — generator + solver for uniqueness and difficulty
  grading.
- **Light Up / Akari** — place bulbs to light every cell under wall constraints.
- **Bridges / Hashiwokakero** — connect numbered islands with 1–2 bridges.
- **Slitherlink** (Tatham "Loopy") — draw a single loop from edge counts.
- **Net** — rotate tiles until the network connects with no loops (the one we
  embedded); discrete rotations, naturally tap-first.
- Same vein if we want breadth: **Galaxies · Tents · Towers · Keen · Signpost ·
  Pearl (Masyu) · Dominosa · Same Game**.

## Approach when we build

- One Tier-1 core per puzzle (`<name>-core` + `<name>-wasm`), golden vectors, no
  floats on the hashed path (`usize`→`u32` at RNG/hash boundaries; native == wasm).
- Verifiable outcome (solved-clean record + `?r=` re-verify), tap-first,
  hints/assistance, a How-to-play guide — the shelf standards.
- Build-time solver → unique / winnable daily pack (mirrors solitaire · bubble).
- Consider a shared **logic-puzzle chrome** (grid + clue rendering + pencil
  marks) so the 2nd..nth puzzle is much cheaper than the first.
- Phase-plan each before code (repo rule). Minesweeper or Nonograms is the
  natural first hero — both light up the verifiable-daily story.
