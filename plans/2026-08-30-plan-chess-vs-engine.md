# Chess vs the engine — the sixth adversarial game, and the first whose rules are the weight

**Status:** PLANNED — Pass 1 (plan development) 2026-08-30; Pass 2 (gap analysis)
2026-08-30. Pass 3 (quality gates) not yet run. No phase executed. Worktree `worktrees/chess/fun`,
branch `claude/chess`.
**Standards anchor:** `docs/BUILDING-GAMES.md` §10 + both new-game checklists;
`docs/AI-PLAYERS.md` (search cost, honesty gate); `docs/HARNESS.md` (adding a game).
**Scoping note it supersedes:** `TODO/README.md` → "Next games" entry 1 (Chess), and the
`plans/2026-07-31-drop4-ai-harness.md` "Phase 9 — chess" stub.
**Reference implementations it copies from:** checkers (`plans/2026-08-04-checkers-game.md`
— the proven-terminal `exact`, the packed move code, the coach/tutor budget split) and
cribbage (`plans/2026-08-29-plan-cribbage-vs-engine.md` — the plan shape, the mutation
audit as a phase, the Rust `RULES.md` the vectors cite).

---

## Problem Statement

Chess has been the shelf's named "completeness/credibility" game since the first
adversarial plan (`plans/2026-07-31-drop4-ai-harness.md:18`) and has sat first in
`TODO/README.md` → "Next games" since checkers shipped. It has never been planned,
for one stated reason: **the rules are the weight.** Castling (with its four
temporary conditions), en passant (legal for exactly one move), promotion (a move
that changes the piece), check (a move is illegal if it leaves your own king
attacked — legality is global, not local), and three families of draw (stalemate,
repetition, the no-progress clocks, dead positions) — every one is a rule an
implementation gets "nearly right", and nearly right in a core that signs its
outcomes is a wrong record.

Two things have changed since that note was written, and both are why now:

1. **The adversarial stack is finished and has five precedents.** `Adversary` +
   `pond_outcome::Game`, `adversary_solver::{select_in_band, NodeBudget, deepen}`,
   the `{value, regret, quality, exact}` tutor, `GameOracle` and the rig, the game
   frame (§4c, landed 2026-08-30). Checkers already answered chess's two hardest
   abstraction questions — a move that is more than a destination, and an `exact`
   that means *proven*, not *solved* — so chess is a **consumer** of the stack, not
   a stress on it (`docs/AI-PLAYERS.md:706-714` says so in as many words).
2. **Chess is the one game with a published, exact oracle for its rules.** Perft
   (the count of legal move sequences to depth N) is tabulated for the initial
   position and five standard test positions that between them exercise castling
   through attacked squares, en passant, promotion with capture, discovered check,
   pins and checkmate. A build-fresh move generator that reproduces those numbers
   is verified more strongly than any other core on this shelf — the other five
   cores' rules were verified against hand-written vectors and one reading of
   Wikipedia.

**What we are building:** Chess (FIDE rules, standard start position) as the sixth
Tier-1 adversarial game at `/chess/`, against The Engine, with the full §10
standard — a build-fresh `chess-core`, a `chess-solver` whose Oracle is honest in
the checkers sense, `chess-wasm`, the tutor panel, the hybrid opponent behind the
WebGPU gate, the rig adapter with a recorded baseline, the guide, and the frame.

**Constraints:**
- Every Tier-1 standard in `docs/BUILDING-GAMES.md` §§2–8 and §4c, plus §10's
  adversarial checklist. Nothing shared changes: `git diff --stat` on
  `crates/adversary-*`, `src/harness/{match-runner,scorer,tournament}.ts` and
  `src/game-frame.ts` must be empty at landing (Dots and Furrow set that bar).
- **No new runtime dependency.** The workspace licence allowlist admits GPL-3.0
  nowhere (`croft-pwa/.github/scripts/dep_gate.py:106-112`), the sourcing rule for
  code that is not ours is *vendor it + CI drift check* (`CroftC/.claude/DECISIONS.md`
  § workspace/dependency-sourcing), and the only maintained MIT move generator has
  not released since 2024. See Reasoning → "Build-fresh".
- **Integer-only on every hashed and compared path.** Evaluation, search values,
  the repetition keys — `native == wasm` is a claim the shelf makes to users.
- The honesty gate: chess is not solved from the opening; `exact` is claimed only
  for a proven terminal reached inside the search, and the tutor's wording is bound
  to it (`coachFor` pins both branches).
- No opening book, no endgame tablebase, no Stockfish in this plan. Each is a
  named follow-up in `TODO/chess.md`, with the reason.

---

## Reasoning

### The rules — what "chess" means to a deterministic core

Source: FIDE Laws of Chess (handbook E01, 2023 edition), read 2026-08-30, cited by
article below. Where FIDE gives a *player* a choice (claiming a draw), the core
must decide, because there is no arbiter and no claim button on a tap-first board.
The decisions, in the order a reader will meet them:

| Rule | FIDE | The core's decision | Why |
|---|---|---|---|
| Piece movement, check, checkmate | Art. 3, 5.1 | As written. A move that leaves the mover's king attacked is not generated. | The only reading. |
| Castling | 3.8.2 | King moves two squares toward the rook; rights lost when either has moved; not through, from or into check; path clear. **Encoded as the king's two-square move.** | 3.8.2.1–2 verbatim. The two-square king move is the standard wire form (UCI). |
| En passant | 3.7.3.1–2 | Legal only on the move immediately after a two-square pawn advance; the ep square is state. | Verbatim. |
| Promotion | 3.7.3.3–5 | Mandatory; to Q/R/B/N; the piece is in the move code (a promotion with no piece is not a move). | 3.7.3.3 says *must exchange* — an "unpromoted" pawn on the last rank is not a position. |
| Stalemate | 5.2.1 | Draw, terminal. | Verbatim. |
| **Threefold repetition** | 9.2 (a *claim*) | **Automatic draw**, terminal, on the third occurrence. Same side to move, same pieces on the same squares, same castling rights, same en-passant *possibility* (9.2.2, 9.2.3.1–2 — an ep square counts only if the capture is actually legal). | A claim needs a claimant. Every consumer chess site auto-draws here or at fivefold; threefold is what players expect, and it terminates king shuffles ~two hundred plies before the 75-move rule would. |
| **50-move rule** | 9.3 (a *claim*) | **Automatic draw**, terminal, when the halfmove clock reaches 100 with no pawn move and no capture. The clock is state. | Same reason. 9.6.2's 75-move rule becomes unreachable and is not implemented. |
| Fivefold / 75-move | 9.6.1–2 | Not implemented — unreachable once 9.2/9.3 are automatic. | They exist to end games where nobody claimed. |
| **Dead position** | 5.2.2 | **Insufficient material**, the standard computable subset: K v K; K+B v K; K+N v K; K+B v K+B with all bishops on one colour. Terminal draw. | 5.2.2 ("no series of legal moves can mate") is not decidable at tap speed in general; the subset is what every engine and every site implements. A blocked-pawn dead position is *not* detected and ends by the 50-move rule. Recorded in `RULES.md`. |
| Checkmate precedes a draw | (implied) | A move that mates is a win even if it is the 100th halfmove or the third repetition. | The known trap: cozy-chess shipped a bug here (its 0.3.3 changelog). Pinned by a vector. |
| Resignation, draw by agreement, clocks, touch-move | Art. 5.1.2, 5.2.3, 6, 4 | Not rules of the core. No clock; no resign verb (see Open Questions). | A one-device game against the engine. |

**Consequence for the state.** The position is `(board, side to move, castling
rights ×4, ep square, halfmove clock, fullmove number)` — exactly FEN's six fields
— **plus the list of position keys since the last irreversible move** (pawn move,
capture, castling-right loss), bounded at 100 entries by the 50-move rule. The key
list is what makes threefold decidable, and it **joins `state_hash`** for the
same reason checkers' no-progress counter did: two boards identical in every FEN
field but with different histories have different legal futures (one is a draw on
the next repetition), so they are different states. `RULES.md` is written first,
and every golden vector cites its section (cribbage's discipline).

### Build-fresh — the central decision, and why it flipped

**First, what the choice is *not* about: the tier.** Tier-1 is defined by three
properties (`BUILDING-GAMES.md` §§2–4): a deterministic Rust core compiled to
wasm, a verifiable `(seed, moves)` record that replays to a stable hash, and the
core deciding legality. A vendored move generator wrapped in our own `Adversary`,
`state_hash` and move code satisfies all three — it is exact rules code, not the
uncontrolled numerics (a physics engine, a solver we do not own) that define
Tier-3 (§11). **Chess is Tier-1 either way.** The decision below is about
licence, sourcing and verification, and the owner asked for it to be made
plainly: build-fresh is *not required* for Tier-1; it is *recommended* for the
four reasons that follow. (Owner, 2026-08-30: "I want this to be a tier 1 app so
you tell me if needed" — answered here.)

The first adversarial plan recommended a **vetted move generator** — chess.js or
`shakmaty` — "recorded as a deviation from build-fresh, because chess rules are not
simpler than an integration" (`plans/2026-07-31-drop4-ai-harness.md:625-644`). That
was the right call in July with zero adversarial cores built. It is the wrong call
now, for four reasons that were checked rather than assumed:

1. **Licence.** `shakmaty` is `GPL-3.0-or-later` (crates.io, 0.30.1, 2026-06-19).
   GPL-3.0 is absent from the workspace's single inbound allowlist
   (`dep_gate.py:106-112` — its copyleft entries are `GPL-2.0-or-later`,
   `LGPL-2.1-or-later` and `MPL-2.0`; `GPL-3.0-only` / `GPL-3.0-or-later` are not
   there, and `shakmaty`'s single-arm expression is not satisfied by the 2.0 entry;
   the allowlist "grows one named package at a time, by PR"). It is legally
   absorbable by AGPL-3.0, so widening is *possible* — but it is a workspace
   decision, not a game plan's. *(Pass 2 corrected "it would be the first GPL
   entry": GPL-2.0-or-later is already listed. The conclusion stands.)*
2. **Sourcing.** For code that is not ours the recorded rule is *vendor it + a CI
   drift check* (`DECISIONS.md` § workspace/dependency-sourcing, 2026-08-09).
   Vendoring a 10k-line move generator to then wrap it in our own `Adversary`,
   `state_hash`, move code and text bridge buys a rules layer we still have to
   understand well enough to test, at the cost of a vendoring harness.
3. **The MIT alternative is stale.** `cozy-chess` 0.3.4 is MIT, `no_std`, fast —
   and last released 2024-04-05, with no MSRV declared, against a workspace pinned
   to Rust 1.97.1. Two years without a release is not disqualifying for a finished
   library, but it is not "vetted and maintained" either.
4. **Perft makes build-fresh the *better-verified* option.** A vetted library is
   itself verified by perft. If our generator reproduces the six standard positions
   to the depths below, it is verified to exactly the same standard — and the
   suite runs on *our* code, under mutation testing, on the pinned toolchain, in
   wasm. That is stronger than trusting a third party's CI.

| position | FEN | CI depth (nodes) | deeper, `#[ignore]` |
|---|---|---|---|
| start | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | 5 → 4,865,609 | 6 → 119,060,324 |
| Kiwipete | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -` | 4 → 4,085,603 | 5 → 193,690,690 |
| pos 3 | `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` | 5 → 674,624 | 6 → 11,030,083 |
| pos 4 | `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` | 4 → 422,333 | 5 → 15,833,292 |
| pos 5 | `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` | 4 → 2,103,487 | 5 → 89,941,194 |
| pos 6 | `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` | 4 → 3,894,594 | 5 → 164,075,551 |

(Source: chessprogramming.org "Perft Results", fetched 2026-08-30. Depths 1..N-1
are asserted too; the table shows the deepest.) The CI column is ~16M nodes total,
which a plain mailbox generator does in a few seconds in release — the same
`--release` the gate already requires. Kiwipete alone covers castling both ways,
castling through attack, en passant, promotion, and checks; pos 4 is the
promotion-with-capture and pinned-piece stress; pos 3 is the pawn-endgame with
en passant discovered check.

**What build-fresh costs, honestly:** roughly 1,500–2,500 lines of Rust across
board, move generation, legality and terminal rules — about checkers-core's size
(1,883 lines). The board representation is **mailbox with a 0x88 or 10×12 padded
array**, not bitboards: it is the representation a reader can check against
`RULES.md`, it mutation-tests cleanly (a bitboard magic table is one giant
equivalent-mutant surface), and its speed is sufficient — the opponent's budget is
nodes, and a mailbox generator's nodes are the same nodes. Phase 0 D2 measures
what the search will need; Phase 4 measures what our generator delivers, in wasm.

**Not chosen, and why:**
- **`shakmaty` as a runtime dependency** — the licence and sourcing points above.
  Also: the wrapper would still need our move code, our `state_hash`, our
  repetition history and our text bridge, so the "integration" is not small.
- **`cozy-chess` as a runtime dependency** — stale; and vendoring + drift check is
  the same harness either way. It **is** used in one place: as a *throwaway*
  differential oracle in Phase 0's spike (`spike/`, its own Cargo project outside
  the workspace, never in `Cargo.lock`), to calibrate search budgets before our
  generator exists and to cross-check perft on random positions once it does.
- **chess.js in TypeScript** — rules in TS would put legality outside the core,
  which §4 ("the core decides legality") and the `?r=` replay property forbid.
- **Bitboards** — faster, and unnecessary at the shelf's budgets; the cost is
  readability under mutation testing.

### The move code

Chess's move is `(from, to, promotion)`. Packed: `from (6 bits) | to << 6 (6 bits)
| promo << 12 (3 bits)` — a **15-bit code, `0..32767`**, a plain JSON number, the
shelf's invariant that lets `?r=` shares and the rig type a move as `number`.

- Squares are `0..63`, a1 = 0, h1 = 7, a8 = 56 (the UCI/LERF convention).
- `promo`: 0 = none, 1 = knight, 2 = bishop, 3 = rook, 4 = queen; 5–7 are
  structurally invalid and rejected at `from_code`. A promotion move always carries
  `promo ≠ 0`; a non-promotion always `0`. A code with `promo ≠ 0` on a non-promotion
  is structurally valid but never in `legal_moves`, so a tampered share diverges
  the hash rather than replaying as a different move (the checkers/othello
  property, `othello-core/src/game.rs:45-48`).
- Castling is the king's `e1→g1` / `e1→c1` (and the black pair). En passant is the
  pawn's diagonal move to the empty ep square. Neither needs a flag: the position
  disambiguates, and `apply` knows what it is applying.
- **Text bridge:** long algebraic in the UCI form — `e2e4`, `e7e8q`, `e1g1` for
  castling. `parse_move` accepts exactly that (case-insensitive promotion letter)
  and returns a legal move or `None`. SAN (`Nf3`, `O-O`) is *not* the wire text —
  it needs disambiguation logic and check suffixes the bridge does not need — but
  the tutor panel and the move list show SAN because that is what a player reads.
  SAN is a **rendering** (`san_of(pos, mv)`), never parsed.

Rejected: the index-into-`legal_moves` encoding (not self-describing; checkers plan
option A) and a 16-bit code with a move-type field (redundant with the position).

### What `exact` means for chess

Chess is unsolved and has no endgame the shelf can afford to solve (checkers' D3
finding applies with more force: pieces cycle, the tree is bounded by the clocks).
So the Oracle takes **checkers' shape, not Othello's**: heuristic alpha-beta
throughout, and a move's facts are `exact` when its value came from a **real
terminal reached inside the search** — checkmate, stalemate, insufficient
material, the 50-move draw or the third repetition — rather than from the static
evaluation at the horizon. Mate-in-N found by the search is exact; "up a pawn" is
never exact.

The graded fraction will be thin (checkers grades 9 of 163 plies) and that is the
honest number; `scoredMoves > 0` must still hold on the CI tournament, which it
will because top-level self-play reaches mates and the clocks. The tutor calls a
move "threw the game" only when both the played move's and the best move's values
are proven, and hedges to "looks risky" otherwise — pinned by the `coachFor` test
with both branches, as in every other game.

### Search shape — quiescence is not optional

Every shelf solver is a depth-capped alpha-beta with a transposition table; chess
adds one thing none of them needed: **quiescence search.** A fixed-depth cutoff in
the middle of a capture sequence values a position after `QxN` and before `RxQ`,
and the horizon effect this produces is not a tuning problem — it is what makes a
depth-4 chess engine hang its queen. Quiescence (search captures and promotions
only, stand-pat at the static evaluation) is the standard remedy and is charged to
the same `NodeBudget`.

The rest follows `docs/AI-PLAYERS.md` → "Search cost" and is **measured, not
copied**:

- **Bound in nodes** (`adversary_solver::NodeBudget`), never ms. Calibrate per
  level by measuring median / p95 / worst / fraction-over-400ms in wasm, at every
  level, on the two Androids — Othello's endgame stall hid behind Expert's midgame.
- **Move ordering:** TT best move first, then MVV-LVA captures, promotions, then
  quiets. Killer moves if the measurement says the budget bites.
- **`deepen`:** Othello −41%, checkers +14%. Chess's static ordering is poor
  without a TT move, so iterative deepening is *expected* to pay — but the plan
  records the expectation and Phase 4 measures it before adopting.
- **Evaluation:** material + piece-square tables, **integer centipawns**, tapered
  by a game-phase integer (0..24 from remaining non-pawn material). Our own
  tables, hand-set from the standard shapes (centre for knights, seventh rank for
  rooks, king safety early / king activity late), recorded beside the constants.
  No floats anywhere on the compared path.
- **Never return a partial iteration, never store a truncated search in the TT,
  never derive `exact` from the position** — the three rules in AI-PLAYERS.

Difficulty is the shared two-knob band: Easy / Medium = `Any` class floor with
high sloppiness; Hard / Expert = `PreserveBestClass`; depth and budget per level
from measurement. `class_of` is chess's own (`live.rs`): a proven mate score is a
class, a centipawn value is class 0 — checkers' `capped_class` shape.

### The Oracle is ours; Stockfish is not it

`TODO/README.md:116-127` already records the objection and it holds: Stockfish
reports centipawns and has no `exact` to give, so a Stockfish-backed Oracle would
report `scoredMoves == 0` forever and the tutor would have nothing honest to bind
to. Also: a third-party engine's numerics are a Tier-3 sim side by the shelf's own
definition (`BUILDING-GAMES.md` §11), which would owe the data/sim directory line
and tolerance probes — a different plan. Where Stockfish *could* fit is as an
optional fifth level ("Grandmaster") in a Web Worker, single-threaded (the lite
build is ~6 MB, no COOP/COEP needed — measured by the lichess/nmrugg builds, not
by us), UCI over `postMessage`, with the tutor still grounded in our Oracle. That
is a `TODO/chess.md` follow-up, gated on a Tier-3 decision and a vendoring
harness, and explicitly out of this plan.

### Colour, orientation, and the seats

- `Side::A` = White (moves first), `Side::B` = Black. The record is A-centric like
  every other versus game; the human's colour is UI state, not record state.
- **Setup rows:** *Play as* (White / Black / Random) and *Difficulty* (Easy …
  Expert), both remembered, exactly checkers' card.
- **Orientation:** the board shows the human's pieces at the bottom. Checkers
  deliberately did not flip ("a second geometry to keep correct", `TODO/checkers.md`)
  and in checkers the convention is weak. In chess it is universal — a player who
  sees their king on rank 8 at the bottom of the screen reads the whole board
  wrong. The cost is one pure function `viewSquare(sq, flipped)` with a unit test
  in both orientations; the core's squares never move. PHASE-GATED to Phase 9 in
  Open Questions with the recommendation to flip.
- **Seats:** "You ♙" and "The Engine ♟" (glyph follows colour); `score` = points of
  material captured (Q 9, R 5, B/N 3, P 1); `sub` carries "your move", "check!",
  "thinking…" as seat states — never a status line in flow above the board (§4c).
- **Verbs:** Undo · Hint · New game… (the frame adds Settings). No *Resign* — see
  Open Questions; the other five versus games have none and New game… is the exit.

### Pieces on screen

Unicode chess glyphs (♔♕♖♗♘♙ / ♚♛♜♝♞♟) are font-dependent: on Android the
"white" glyphs render as outlines whose fill is the background colour, and on some
system fonts ♟ is an emoji. That is a rendering question with a device answer, so
Phase 0 D5 puts both on the two Androids before Phase 9 commits. The recommendation
is a **small inline SVG set of our own** (12 paths, one file under
`src/games/chess/assets/`, coloured by CSS tokens so skins and dark theme work) —
the well-known cburnett set is CC-BY-SA 3.0, which is not on the allowlist
(`CC-BY-4.0` is; `-SA` is not) and would be the shelf's first attribution
obligation on a rendered surface. The board itself is CSS: an 8×8 grid on
`tokens.css`, squares ≥ 44px on a 390px phone (8 × 44 = 352, fits), last move
ringed, the checked king marked, legal destinations glowing from the core's
`legal_moves` — never re-derived in TypeScript.

### Alternatives considered and rejected (the short list)

- **Chess960 as the seed's meaning.** `initial(seed)` could pick a 960 start —
  the natural use of the seed every other versus game ignores. Rejected for v1:
  960 castling (king and rook may not be on e/h files) changes the castling
  encoding and the guide. Recorded as the seed's *reserved* meaning in `RULES.md`
  and a follow-up.
- **Auto-queen promotion.** Simpler UI; wrong game. The picker is an absolutely
  positioned transient over the stage (allowed by §4c); underpromotion exists.
- **A move list panel.** Nice, out of scope; the verifiable record already has the
  moves, and SAN rendering lands in the tutor panel first.
- **PGN import/export.** Not a Tier-1 requirement; the `?r=` record is the export.

---

## Verified Assumptions

**Codebase — read firsthand 2026-08-30:**

- `crates/adversary-core/src/lib.rs:1-4,83-113` — the crate header already names
  chess as a target; `Move: Copy + Serialize + DeserializeOwned + Eq` — a 3-field
  struct serialized as one `u16` satisfies it (checkers precedent,
  `crates/checkers-core/src/game.rs:94-112`).
- `crates/checkers-core/src/game.rs:25-38,523-527` — the packed-code constants
  pattern (`SQUARE_BITS`, `MAX_MOVE_CODE`, reject-above-max at deserialize) and
  `initial(_seed)` ignoring the seed with a reserved-meaning comment. Chess copies
  both.
- `crates/adversary-solver/src/lib.rs:36-100` — `LiveBand {depth, preserve_class,
  sloppiness_pct}` and `select_in_band<M: Copy>(values, class_of, …)`; the RNG is
  untouched at zero sloppiness (load-bearing for deterministic baselines).
  `NodeBudget` (`:101-156`) and `deepen` (`:186`) are the only two search helpers;
  nothing there is chess-shaped and nothing changes.
- `crates/checkers-solver/src/tutor.rs:54-80` — `TUTOR_DEPTH = Expert + 1`,
  `COACH_DEPTH = Hard`, both orderings compile-time assertions; `assess` vs
  `assess_for_move`. Chess copies the split (the tap path must not pay the panel's
  search).
- `crates/checkers-solver/src/search.rs:71-73,365-368,442` — `TRACTABLE_PIECES`
  buys extra plies, never claims; `OPENING_BUDGET_MS` is a *test* bound, not a
  runtime one.
- `crates/xbuild/src/lib.rs:96-97` — the move input channel is `static mut IN:
  [u8; 256]`, shared by dots, furrow and cribbage; every enrolled game's move
  code fits a byte. Chess's 15-bit code does not, so Phase 3 adds a `u16` channel
  (checkers, the other >255 code, is **not** enrolled in xbuild — its cross-build
  claim rests on the wasm C-ABI tests alone; chess does better).
  `crates/xbuild/check.mjs:8` takes one vectors directory per game as a positional
  argument, and `run.sh:24-29` passes them; the vector file shape is
  `{name, note, seed, moves, final_state_hash}` (`crates/dots-core/vectors/02-…json`).
- `crates/checkers-wasm/src/lib.rs:90-468` — the C-ABI surface to mirror:
  `out_len`, `new_game(lo,hi)`, `board_json`, `legal_moves_json`, `current_hash`,
  `result_code`, `render_text`, `play(code)` (0 ok / 1 illegal / 2 over-or-invalid),
  `live_move(level)` (`MOVE_OVER = 0xFFFF_FFFF`), `oracle_best`,
  `oracle_move_values_json`, `assess_json(code)`, `coach_json`, `tutor_json`,
  `mark_assistance`, `outcome_json(declare)`. Chess adds `fen()` and
  `san_json(code)`.
- `src/harness/game-oracle.ts:103-116` — the port over `number` moves and level
  `0..3`. **Nine members** (`newGame`, `board`, `legalMoves`, `play`, `currentHash`,
  `renderText`, `liveMove`, `assess`, `tutor`) — `docs/HARNESS.md:47` says "ten";
  the doc miscounts, the interface is the truth (Pass 2 counted).
  `src/games/checkers/checkers-oracle.ts` (87 lines) is the pass-through adapter
  to copy.
- `src/harness/hybrid-player.ts:14-37,66-70` `TutorFactMove` is `{col, value, quality,
  immediateWin, blocksOpponentWin, idea?}` and `buildBand` maps it to `{col, value,
  idea}` — chess's tutor view is a structural superset,
  carrying the two booleans honestly (`immediateWin` = mate in one; `blocksOpponentWin`
  = false) and its own `idea` (checkers wires `idea` in both `checkers.ts:540` and
  `checkers-oracle.ts:75`).
- `src/registry.ts:106-116` — the versus entry shape (`group: "versus"`, `pitch`,
  `setup` factory, `load`); `src/how-to-registry.ts:12,30`; `build.mjs:165-167`
  (per-game wasm copy); `tools/guide-shots.mjs:358-363` (`SHOTS`);
  `tools/build-wasm.sh:19` `-p` list; `Cargo.toml:14-56` explicit `members`;
  `src/harness/harness-trial-entry.ts:34` `GAMES` **and `:26` the `TrialGame`
  union it is keyed on**; `tests/baselines.test.ts:152` `ANCHORS`; `CHANGELOG.md:7`
  contexts line. **Registration points found by Pass 2 that Pass 1 missed** (each
  scheduled in its phase below): `tests/chrome.test.ts:192` asserts the drawer's
  id list **in order**, so a registry entry without that edit is a red unit
  board; `src/settings.ts:252-315` holds each versus game's remembered level /
  side / tutor preference as pure resolvers over `fun-<game>-*` keys, with
  `tests/settings.test.ts:69` pinning them; `tokens.css:118-122` holds the board
  tokens and `tests/tokens.test.ts:121-123` asserts their contrast pairs;
  `tests/art.test.ts` asserts `icon: true` ⇔ `src/games/<id>/assets/icon.jpg`
  **in both directions**; `src/music.ts:76-91` `BY_GAME` names a game's default
  track (string-keyed with a shelf fallback, so optional); and
  `crates/xbuild/{Cargo.toml,src/lib.rs,check.mjs,run.sh}` — the cross-build
  harness enrols a game by hand in all four (Phase 3). Auto-discovered, no edit:
  `tests/a11y-matrix.spec.ts:79` scans every `status: "playable"` registry entry
  in every skin, and `tools/registry-titles.mjs` reads the page list from
  `src/registry.ts` as text. **Seventeen hand-edited points**, not ten.
- `tests/helpers/board-top.ts` — the frame stability sampler every migrated game
  runs (`boardTopStable(page, selector, action)`; its pure `judgeTops` is
  unit-tested in `tests/helpers/board-top.test.ts`); `tests/checkers.spec.ts`
  (`@smoke` on the render and seat-state tests at `:52,308`, `@long` + `?fast=1` on
  the full game at `:147-151`, the `window.__checkers` E2E hook declared at
  `checkers.ts:50-60`), `tests/checkers-harness.test.ts` (three non-vacuity
  assertions; loads the real wasm from `target/wasm32-unknown-unknown/release/`
  through a fetch shim, which `preunit` → `build:wasm` produces),
  `tests/checkers-tutor.test.ts` (`coachFor` **and** the `MockRuntime` hybrid
  plug-in proof — there is no separate `checkers-hybrid.test.ts`) — the test
  shapes to copy.
- `docs/BUILDING-GAMES.md:213-352` — the frame contract: fixed-count meters, ≤ 4
  own verbs, `setup` / `preferences` rows, transients overlay the stage,
  `snapshot()` / `resume()` for Continue (optional members of `GameModule`,
  `src/contract.ts:46-49`), deep links (`?r=`, `?seed=`) mount the board directly.
  `src/game-frame.ts:17-26` — a `SeatMeter` is `{id, name, glyph, score, sub?,
  state?: "idle" | "active" | "thinking"}`: **`state` is the seat state, `sub` is
  its text** — Reasoning → "Seats" above conflated them; Phase 9 uses both.
  `docs/BUILDING-GAMES.md:410-414` — "run it against the pre-migration page first
  … a stability spec that was never red proves nothing" is written for a
  **migration**; a new game has no pre-migration page (see Open Questions).
- `rust-toolchain.toml` — Rust **1.97.1** pinned, `wasm32-unknown-unknown` target;
  `[workspace.lints]` pedantic minus the cast family, opt-in via
  `[lints] workspace = true`.
- `spike/` exists at the repo root as the home for out-of-workspace Cargo probes
  (cribbage's `spike/cribbage-solve/`, results in `results.txt`).
- `tools/check.sh` — run every verification through it so the exit status is the
  command's (a piped `tail` was how 11 mutants once looked like all of them).
- `crates/othello-solver/src/search.rs:547-610,977-995` — the independent plain
  minimax and the `exact_endgame_agrees_with_an_independent_minimax` test Phase 4
  copies (Pass 1 cited `:141-201`, which is the `Bound` enum and the TT).
- `Cargo.toml:63-75` — `rand` / `rand_chacha` are workspace deps with
  `default-features = false` (no `getrandom`, so a core that uses them still
  cross-builds); `checkers-core` depends on neither. Chess's Zobrist table needs a
  deterministic generator: Phase 2 decides between the two deps and a `const fn`.
- `src/settings.ts:252-315` — the per-game preference shape: `resolveCheckersLevel`
  / `resolveCheckersSide` (pure, unit-tested), `checkersLevel()` defaulting to
  `"Medium"`, `checkersSide()` to the opener, `checkersTutorEnabled()` to `false`;
  keys `fun-checkers-level` / `-side` / `-tutor`. `grep fun-chess src/settings.ts`
  is empty — no key collision.
- `CroftC/.claude/TESTBED.md:60-100` — an owed device check carries
  `[device: SPEC]` on the line that records it; fulfilled by editing the line to
  `[device done YYYY-MM-DD: …]`.

**External — fetched 2026-08-30:**

- FIDE Laws of Chess, handbook E01 (2023): Art. 3.7.3 (en passant, promotion),
  3.8.2 (castling and its four temporary bars), 5.1.1 / 5.2.1 / 5.2.2 (mate,
  stalemate, dead position), 9.2 (threefold, with the same-side / same-rights /
  same-ep-possibility definition), 9.3 (50 moves), 9.6.1–2 (fivefold, 75 moves).
- Perft table: chessprogramming.org "Perft Results" — the six positions and counts
  in the Reasoning table.
- `shakmaty` 0.30.1 (2026-06-19), `GPL-3.0-or-later`, MSRV 1.95 — crates.io API.
- `cozy-chess` 0.3.4 (2024-04-05), MIT, no MSRV, `no_std`, Chess960, Zobrist,
  `generate_moves` callback API; 0.3.3 changelog "checkmate not taking precedence
  over 50 move rule draw" — crates.io API + upstream README.
- Stockfish builds: lite single-threaded ≈ 6 MB, no SharedArrayBuffer; the
  multi-threaded build needs COOP/COEP, which GitHub Pages does not serve —
  npm `stockfish` / lichess `stockfish.wasm` READMEs. Informs the follow-up only.

**Not yet verified (Phase 0):** the node counts a quiescent alpha-beta needs per
depth on chess middlegames (D2); how the two Androids render chess glyphs (D5);
whether a threefold/50-move fixture as a move list from the start position is short
enough to be a readable test (D4 — it may need a FEN start, which means the vectors
need a `from_fen` constructor the record format does not use).

---

## Documentation Impact

Every file this plan makes stale, scheduled in the phase that breaks it.

- `TODO/README.md` → "Next games" entry **1. Chess** (`:110-127`) — moves to
  "Shipped — Tier-1"; its two sub-bullets (the hosting-note correction and the
  Stockfish objection) become history and the objection is carried into
  `TODO/chess.md`. **Phase 14.**
- `TODO/drop4.md:185` — "then **chess** (heavier — vetted move-gen + Stockfish-WASM
  oracle, gated on larger-binary hosting)" is stale on all three counts (build-fresh,
  our Oracle, no hosting gate). Replaced with a pointer to this plan. **Phase 14.**
- `TODO/chess.md` — **new**, the running worklist (what shipped, follow-ups:
  Stockfish level, opening book, Chess960 via the seed, PGN, move list, Resign,
  persona roster). **Phase 14.**
- `plans/2026-07-31-drop4-ai-harness.md` "Phase 9 — chess" (`:625-644`) and its
  open question — historical; **one line added** pointing here, the vetted-lib
  recommendation left as the record of what was thought in July. **Phase 14.**
- `docs/AI-PLAYERS.md` — the generality section (`:633-714`): chess becomes the
  third unsolved-game precedent, and "a future game (chess is the obvious one)"
  (`:711`) becomes past tense; the "one principle" already lists chess. **Phase 14.**
  Search-cost section gains chess's measured `deepen` verdict and budget table.
  **Phase 5.**
- `docs/BUILDING-GAMES.md` §10 — the roster paragraph (`:591-620`: "Furrow is the
  fifth") gains chess as the sixth; the honesty-gate line "(Othello, chess)"
  (`:877`) becomes a reference to a shipped game; the adversarial checklist's
  "Reference implementations" gains chess as the *quiescence + repetition-history*
  variant. A **"Variation — a move that changes the piece, and a state that carries
  history (chess)"** block, in the style of the Furrow/Dots variations. **Phase 14.**
- `docs/HARNESS.md` — "All three games, side by side" table (`:297-307`) gains
  chess — **only from a real WebGPU run**, since that table records the hybrid vs
  `Engine(3)`, not a baseline; the row comes from Phase 10's `ai:trial` run, so
  it is written in Phase 11 from Phase 10's Review Log entry; the adapter list
  (`:46-55`) names `chess-oracle.ts`; `:47` "ten members" is corrected to nine
  while the file is open. **Phase 11.**
- `CLAUDE.md` (fun) — "Adversarial … Three shipped, in order" paragraph extended.
  **Phase 14.**
- `README.md` — shelf inventory gains Chess. **Phase 14.**
- `CHANGELOG.md` — the contexts line gains `chess`; the entry under the current
  month written **before landing** (`CroftC/.claude/CHANGELOGS.md`). **Phase 14.**
- `crates/chess-core/RULES.md` — **new**, written in **Phase 1 before the vectors**.
- **Registration points** (the stale-reference failure mode without being docs):
  `Cargo.toml` members (Phases 1, 4, 7), `crates/xbuild/{Cargo.toml,src/lib.rs,
  check.mjs,run.sh}` (Phase 3), `tools/build-wasm.sh` + `build.mjs` (Phase 7),
  `src/registry.ts` + `tests/chrome.test.ts:192` + `src/settings.ts` +
  `tests/settings.test.ts` + `tokens.css` + `tests/tokens.test.ts` +
  `src/games/chess/assets/icon.jpg` (`tests/art.test.ts`) + `src/music.ts`
  (Phase 9), `src/how-to-registry.ts` + `tools/guide-shots.mjs` (Phase 12),
  `harness-trial-entry.ts` (`GAMES` **and** `TrialGame`) + `tests/baselines.test.ts`
  (Phase 11).
- `crates/adversary-core/src/lib.rs:1-4` — already says "Drop 4, checkers, and
  chess"; becomes true rather than stale. No change.
- `discovery/alpha/thinking/app/ponds/games-pond-authoritative-list.md:143-147`
  (chess: "wrap or build-fresh on a Rust move-gen crate") — a catalog, not a
  status; unchanged.

**Grep evidence (Pass 1):** `grep -rn -i chess TODO CLAUDE.md README.md plans/*.md
docs/*.md` → `TODO/README.md:28,110-127`; `TODO/drop4.md:185`;
`plans/2026-07-31-drop4-ai-harness.md` (24 hits, all the Phase 9 stub and its
research notes); `docs/AI-PLAYERS.md:11,706`; `docs/BUILDING-GAMES.md:876`. All
covered above. Re-run at Phase 14 as the closing gate.

---

## Concurrency Map

```
Sequential spine:
  Phase 0
  → [A core]   1 → 2 → 3
  → [B solver] 4 → 5 → 6
  → [C ship]   7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
```

**All phases sequential.** Reasons, per boundary:

- **Part A is a dependency chain:** legality (1) is what the terminal rules (2)
  are defined over; the cross-build (3) replays what 1–2 produce.
- **Part B needs Part A's crate** (`Cargo.toml` member, `Cargo.lock`), and the
  band/tutor (5) sit on the search (4); the mutation audit (6) runs on the green
  state of both.
- **Part C is a build chain:** wasm (7) → TS wrapper (8) → wired page (9) → AI
  layer (10) → rig adapter (11) → guide shots (12, which need a running page) →
  device pass (13) → docs and landing (14).

**Named near-miss — Phase 0 D2 (the `spike/` calibration) alongside Phase 1.** The
spike is its own Cargo project outside the workspace, so its write-set
(`spike/chess-search/**`) is disjoint from `crates/chess-core/**`, and it does not
touch the workspace `Cargo.lock`. It *could* run in a subagent while Phase 1 is
written. It is still sequential, for the checkers plan's reason: both invoke
`cargo`, which serializes on the `target/` lock anyway, and a spike that reports a
node budget mid-Phase-1 changes nothing Phase 1 does. Recorded so it is not
re-derived.

**Shared-state note applying to every phase:** all phases run in
`worktrees/chess/fun` on `claude/chess`. None invokes `git checkout` / `stash` /
`rebase` in any other worktree; none binds a port except Phases 0 (D5's dev
server), 9, 10 (`ai:trial` serves the built site), 12, 13 (the Playwright server,
started and stopped within the phase); none writes outside the worktree except
`target/`, `dist/` and `test-results/` (git-ignored). Phases 0 (D2, D5), 4 and 13
claim `testbed--samsung` / `testbed--pixel` in `CroftC/.coordination/claims/`
before touching a phone (Pass 1 named only Phase 13; Phase 4's own text already
says "claim per TESTBED"). No phase is dispatched to a subagent, so no re-entry
verification is required.

**Missed-parallelism candidate surfaced by Pass 2 — {11 || 12}, the user
decides.** Phase 11 (rig adapter) writes `src/games/chess/chess-oracle.ts`,
`src/harness/harness-trial-entry.ts`, `tests/chess-harness.test.ts`,
`tests/baselines.test.ts`, `docs/HARNESS.md`; Phase 12 (guide) writes
`src/games/chess/chess-howto.ts`, `src/how-to-registry.ts`, `tools/guide-shots.mjs`,
`assets/guide/chess-*.jpg`. Disjoint. Both depend only on Phase 9 (11 also on 10
for the `idea` wording and the HARNESS row). The shared state is the **build**:
`harness:trial` and `guide:shots` both run `node build.mjs` into the one `dist/`
and both start a server on the default port, so they cannot run *at the same
moment*; as two sequential shells in one session they are safe, and as two
subagents they are not. Recommendation: keep sequential (the map's default) —
the saving is under an hour and the `dist/` race is a real one. Recorded so it is
not re-derived. Phase 10 is not a candidate: it writes `chess.ts`, which Phase 12
screenshots.

---

## Phases

### Phase 0: Discovery

**Goal:** Resolve the unknowns that would re-plan later phases if wrong — the
search budget chess actually needs, the fixture shape for the history-dependent
draws, how pieces render on the shelf's phones — and record the dependency
decision as evidence rather than opinion.

**Discovery tasks:**

- [ ] **D1: Is build-fresh the right call under the workspace's rules?** *(Reading
  only; resolved in Pass 1 and recorded here so execution does not re-open it.)*
  - **Probe:** `dep_gate.py` allowlist (`:103-107`) — GPL-3.0 absent;
    `DECISIONS.md` § dependency-sourcing — vendor + drift for not-ours; crates.io
    for `shakmaty` (GPL-3.0-or-later) and `cozy-chess` (MIT, 2024).
  - **Success criteria:** A recorded decision with the four reasons in Reasoning →
    "Build-fresh". **Met.**
  - **Disposition:** `keep-as-fixture` — the reasoning is the fixture.

- [ ] **D2: How many nodes does a quiescent alpha-beta need per depth on chess
  middlegames, and what does that cost in wasm?**
  - **Probe:** `spike/chess-search/` — its own Cargo project (never a workspace
    member), depending on `cozy-chess 0.3.4` for move generation only. A plain
    alpha-beta + quiescence + MVV-LVA + a simple TT over material + PST, run at
    depths 2..6 on **50 positions**: 25 sampled by random legal play 20–40 plies
    from the start, 25 from a hand-picked set (open tactical middlegames, closed
    positions, a rook endgame, a queen endgame). Record per depth: nodes median /
    p95 / worst, and the same with quiescence off (to show the quiescence tax and
    the horizon blunders it prevents — count queen hangs at depth 3 with and
    without). Then build the same spike to `wasm32-unknown-unknown` and time the
    p95 position at each depth in Chromium **and on the Samsung** — the nps ratio
    native:wasm:phone is the number every later budget is derived from.
  - **Success criteria:** A table `depth → nodes (median, p95, worst)` with and
    without quiescence, and a measured phone nps. A provisional per-level
    `(depth, NodeBudget)` table where Expert's p95 is under 400 ms on the phone.
    **Re-plan trigger:** if no depth ≥ 4 fits 400 ms p95 on the phone, Phase 4's
    level table drops a ply per level and the plan says so in the Review Log.
  - **Disposition:** `throwaway` — the spike stays under `spike/` like cribbage's
    (out of the workspace, out of the gate); the table goes into Verified
    Assumptions and beside the constants in `chess-solver/src/live.rs`. The
    50-position FEN set is `keep-as-fixture` for Phase 4's latency measurement.
  - [device: android=samsung] — the phone half of the timing.

- [ ] **D3: Does iterative deepening pay in chess, on *our* ordering?** *(Deferred
  to Phase 4 by design.)* It depends on the generator's move order and the TT
  move, so a spike on cozy-chess's ordering would measure the wrong engine. Phase
  4 measures it with the D2 position set and records the verdict in
  `docs/AI-PLAYERS.md` beside Othello's and checkers'.

- [ ] **D4: Build the draw-rule fixtures.**
  - **Probe:** Four concrete fixtures, each as `(start FEN, move list in UCI)`:
    (a) threefold — a king-and-rook shuffle that is *live* after the second
    occurrence and `Draw` on exactly the third, plus a variant where a castling
    right is lost between occurrences and therefore does **not** count (9.2.3.2);
    (b) the ep-possibility variant — the same squares, ep capturable in the first
    occurrence only, so it does not count (9.2.3.1); (c) 50-move — a sequence that
    reaches halfmove 99 live and 100 `Draw`, and a capture at 99 that resets it;
    (d) checkmate on the 100th halfmove is a win, not a draw. Confirm each fixture
    is short enough to read (target ≤ 30 moves from a FEN); if a fixture needs a
    FEN start, the core needs a `from_fen` constructor used **only by tests and the
    text bridge**, never by the record format — decide and record.
  - **Success criteria:** The four move lists, each reaching its terminal at the
    exact ply and not before.
  - **Disposition:** `keep-as-fixture` — they become Phase 2 tests.

- [ ] **D5: How do chess pieces render on the two Androids?**
  - **Probe:** A static HTML page under `spike/chess-glyphs/` with the twelve
    Unicode glyphs at 44px in the shelf's two themes, and the same twelve as
    inline SVG paths (a first cut of our own set). Open it on the Samsung and the
    Pixel through the dev server; screenshot both.
  - **Success criteria:** A decision — glyphs or SVG — with the screenshots as
    evidence. If Unicode renders the white pieces as outlines or any piece as an
    emoji on either phone, SVG is chosen (the recommendation either way).
  - **Disposition:** `promote` if SVG — the paths become `src/games/chess/assets/`
    in Phase 9; the HTML is deleted.
  - [device: android x2]

- [ ] **D6: Documentation-reference sweep.** *(Resolved in Pass 1 — see
  Documentation Impact's grep evidence. Re-run at Phase 14 as the closing gate.)*

**Outputs fed back into the plan:** Verified Assumptions gains D2's table and D5's
verdict; Phase 4's level table is seeded from D2; Phase 2's tests are D4's
fixtures; Phase 9's piece rendering is D5's answer; the Review Log records any
re-plan.

**Recording discipline:** D2 produces constants later phases depend on. Record each
**with its measurement and the machine/browser/phone it was measured on**, not just
the value — Phase 4 will re-measure in wasm on our own generator and needs to
diagnose a disagreement against a number, not a memory.

**Read-set:** `docs/AI-PLAYERS.md`, `crates/adversary-solver/src/lib.rs`,
`crates/checkers-solver/src/{search,live,tutor}.rs`, `spike/cribbage-solve/`.
**Write-set:** this plan; `spike/chess-search/**`, `spike/chess-glyphs/**`.
**Shared-state contract:** No workspace `Cargo.toml`/`Cargo.lock` change (the spike
is its own project — verify with `git status --porcelain Cargo.lock` empty). The
dev server for D5 is started and stopped within the phase. Device claims per
TESTBED before D2's phone half and D5.
**Risks:** D2 under-samples closed positions and over-states the budget; mitigated
by the hand-picked half. D5 is a judgement call on a screenshot — record it as one.
**Validation:** Discovery Exemption applies (no TDD, no wiring test). Findings must
be concrete values and images, not "it seems fine".

---

### Part A — the core

### Phase 1: `chess-core` — board, FEN, move generation, legality, the move code

**Goal:** Every legal move of every position, verified by perft.

**Changes:**
- [ ] `crates/chess-core` (workspace member, `[lints] workspace = true`; deps:
  `adversary-core`, `serde`, `sha2`, `hex`, `pond-outcome`): `Square` (0..63),
  `Piece`/`Color`, `Board` as a mailbox (a 64-cell array plus the FEN fields:
  side, castling rights, ep square, halfmove clock, fullmove number).
- [ ] `RULES.md` — **written first**: the table from Reasoning, with FIDE article
  numbers, the move-code layout, the square numbering, the text-bridge grammar, and
  the seed's reserved meaning. Every test below cites a section.
- [ ] `Board::from_fen` / `to_fen` — the test-and-bridge constructor (D4's decision);
  `Board::start()` is `from_fen(START)`. Round-trips pinned on the six perft FENs.
- [ ] `Move {from, to, promo}` with `code()` / `from_code()` (15 bits,
  `MAX_MOVE_CODE`), `Serialize`/`Deserialize` as one `u16`, reject-above-max
  (the checkers pattern).
- [ ] Pseudo-legal generation per piece; `attacked(sq, by)`; castling with all four
  bars (3.8.2.2); en passant; promotion ×4; **legality by make-and-check** (apply,
  test own king attacked, discard). `legal_moves(&Board) -> Vec<Move>` in a
  deterministic order (the order is part of `variant`-free determinism: the band's
  tie-breaks read it).
- [ ] `apply_move(&Board, Move) -> Board`: moves the piece, handles the rook in
  castling, the captured pawn in ep, the promotion piece, castling-right loss (king
  move, rook move, rook captured on its home square), ep-square set/clear, the
  halfmove clock (reset on pawn move or capture), the fullmove number.
- [ ] **Perft** (`perft(&Board, depth) -> u64`) with the six positions asserted at
  the CI depths and the deeper rows under `#[ignore]`. Plus per-move split perft
  (`divide`) as a test helper for locating a divergence. **The CI-depth tests
  carry `#[cfg_attr(debug_assertions, ignore = "release only: ~16M nodes")]`**
  (the repo's recorded mechanism, `CLAUDE.md` → mutation testing) — the release
  gate runs them; `cargo mutants` and any debug run skip them; and depths ≤ 3 on
  all six positions (~150k nodes) stay un-ignored so generation is still exercised
  in debug. Record the release wall-clock of the suite in the Review Log (Pass 1's
  question about the 53 s Rust job: ~16M nodes of a mailbox make-and-check
  generator is single-digit seconds in release; the ≤ 10 s budget below decides).
- [ ] `crates/chess-core/vectors/` — the golden vectors as JSON in the xbuild
  shape (`{name, note, seed, moves, final_state_hash}`; `moves` are the `u16`
  codes), written in Phase 2, **directory created here** so Phase 3's `run.sh`
  argument has a home.

**Call chain:** `Board::start → legal_moves → apply_move → …` (the perft driver is
the first caller of everything).

**Wiring test:** `perft_start_depth_5_is_4_865_609` and
`perft_kiwipete_depth_4_is_4_085_603` — RED with any generation bug, GREEN only when
castling, ep, promotion and check-legality are all right at once.

**Depends on:** Phase 0 (D4's `from_fen` decision).
**Read-set:** `crates/checkers-core/src/{game,board,hash}.rs`,
`crates/othello-core/src/game.rs`, `RULES.md`.
**Write-set:** `crates/chess-core/**`, root `Cargo.toml` members, `Cargo.lock`.
**Shared-state contract:** `Cargo.toml` members — one line, additive.
**Risks:** Perft agrees and a rule is still wrong in a way the six positions do
not exercise (e.g. castling rights after the *opponent* captures your rook on h1).
Mitigation: a differential perft on 200 random positions against the D2 spike's
`cozy-chess` (throwaway, run once, result recorded in the Review Log — it is the
one moment the MIT library earns its place). Second risk: the CI perft run time —
budget ≤ 10 s in release; if it exceeds that, the CI depths drop one and the
deeper rows stay `#[ignore]`.
**Done when:**
1. **Behavioral:** All six positions match the table at CI depth; the differential
   perft reports zero disagreements.
2. **Verification:** `bash tools/check.sh core cargo test -p chess-core --release`;
   no `unwrap` outside tests (`grep -n 'unwrap()' crates/chess-core/src` → tests
   only).
**Validation:** Narrow — the perft suite *is* the validation.

### Phase 2: `chess-core` — terminal rules, `Adversary`, `pond_outcome::Game`, hash, text bridge

**Goal:** A complete game as a pure state machine with a replayable record.

**Changes:**
- [ ] `Position` = `Board` + `history` (position keys since the last irreversible
  move, ≤ 100) — **a fixed-capacity `[Key; 100]` + `len: u8` from the start, not a
  `Vec`** (Pass 2's answer to Pass 1's first question; see Open Questions). `Key`
  is a **Zobrist** hash (`hash.rs`) over piece placement, side, castling rights and
  the *capturable* ep square (9.2.2). **The 781 constants come from a `const fn`
  splitmix64 over a fixed seed, evaluated at compile time** — no `rand` /
  `rand_chacha` dependency in the core (`checkers-core` has neither), no runtime
  table init, and native == wasm by construction. The seed and the generator are
  recorded in `RULES.md` beside the move-code layout so a reader can regenerate
  the table.
- [ ] `result(&Position)`: checkmate (loser = side to move), stalemate,
  insufficient material (the four cases), 50-move (clock ≥ 100), threefold
  (`history` holds the current key ≥ 2 more times). **Checkmate first** — D4(d).
- [ ] `impl Adversary` (`KIND = "chess"`, `initial(seed)` ignores the seed with the
  reserved-meaning comment, `side_to_move`, `legal_moves` empty when terminal,
  `apply`, `result`, `state_hash` = sha256 over the canonical serialization of
  `Position` **including `history`**, `render_text` = ASCII board + FEN + "moves
  are long algebraic, e.g. e2e4", `move_to_text` / `parse_move` in UCI form).
- [ ] `impl pond_outcome::Game` (`KIND = "chess"`, **`VERSION = 1`** — the trait
  requires it, `crates/pond-outcome/src/lib.rs:18-27`) — replay `(seed, moves)`,
  skipping moves not in `legal_moves` so a tampered list diverges
  (`othello-core/src/game.rs:252-276`).
- [ ] `state_hash` is defined over the **logical** history (the `len` keys in
  order), never the container, so the array/ring choice can change later without
  moving a single pinned hash.
- [ ] `san_of(&Position, Move) -> String` — the rendering the panel reads
  (disambiguation by file/rank/both, `x`, `=Q`, `+`/`#`, `O-O`/`O-O-O`). Rendered,
  never parsed.
- [ ] Golden vectors, each citing `RULES.md`: the D4 fixtures (a–d); fool's mate and
  scholar's mate (`WinB`, `WinA`); a stalemate; each insufficient-material case and
  the K+B v K+B *opposite* colours non-case; castling rights lost by a rook
  capture; en passant only for one move; promotion to each piece; a full game
  from the start replayed to a pinned hash; two positions equal in FEN but
  different in `history` hashing differently. The full game and the D4(a)
  threefold game are **also** written to `crates/chess-core/vectors/01-full-game.json`
  and `02-threefold.json` (the xbuild shape) — the vectors Phase 3 replays in wasm.

**Call chain:** `Adversary::initial → legal_moves → apply → result → state_hash`;
`pond_outcome::Game::replay` over a record.

**Wiring test:** A 60-ply recorded game replays through `pond_outcome::verify` to a
pinned `state_hash` and `MatchResult`, and the same record with one move altered
fails verification.

**Depends on:** Phase 1.
**Read-set:** `crates/checkers-core/src/game.rs` (the `Adversary` impl and replay),
`crates/pond-outcome/src/lib.rs`.
**Write-set:** `crates/chess-core/**`.
**Shared-state contract:** none beyond the write-set.
**Risks:** The repetition definition — the ep-possibility clause is the one every
implementation gets wrong first (an ep *square* is set after every double push;
it only counts if a capture is legal). Pinned by D4(b). Second: the `history`
in `Position` makes `Clone` heavier for the search — **resolved by Pass 2 as the
fixed array above** (an 808-byte memcpy per node, no heap; a `Vec` would be an
allocation per node at every one of Phase 4's ~10⁵–10⁶ nodes per move). Phase 4
still measures; the number goes beside the constants.
**Done when:**
1. **Behavioral:** every vector green; the wiring test's tamper case fails
   verification.
2. **Verification:** `bash tools/check.sh core cargo test -p chess-core --release`.
**Validation:** Narrow.

### Phase 3: native == wasm cross-build

**Goal:** The determinism claim, checked by the harness that exists for it.

**Changes:**
- [ ] The two Phase 2 vectors (`crates/chess-core/vectors/01-full-game.json`,
  `02-threefold.json`) with natively recorded hashes; `npm run test:xbuild`
  replays them in `wasm32` and asserts equality.
- [ ] **Enrol chess in the harness — four hand edits** (Pass 2; the harness
  auto-discovers nothing): `crates/xbuild/Cargo.toml` gains `chess-core = { path =
  "../chess-core" }`; `src/lib.rs` gains `chess_replay_hash(seed_lo, seed_hi, len)`
  over a **new `static mut CHESS_IN: [u16; 512]`** with `chess_in_ptr` /
  `chess_in_cap` — the shared `IN: [u8; 256]` cannot carry a 15-bit code, and 256
  bytes as LE pairs is 128 plies, shorter than a repetition game; `check.mjs`
  takes a seventh positional `<chess-vectors>` and pushes a `chess ${v.name}`
  case per file (the cribbage loop's shape, seed as two `u32` halves, moves
  written as `Uint16Array`); `run.sh` passes `crates/chess-core/vectors`.
- [ ] `crates/chess-core` builds for `wasm32-unknown-unknown` with no `std` feature
  it cannot have (no `getrandom`, no floats, no time).

**Wiring test:** the xbuild scenario itself, run through `npm run test:xbuild`.
**Depends on:** Phase 2 (the vectors directory and the two files).
**Read-set:** `crates/xbuild/{run.sh,check.mjs,src/lib.rs,Cargo.toml}`.
**Write-set:** `crates/xbuild/{Cargo.toml,src/lib.rs,check.mjs,run.sh}`,
`Cargo.lock` (xbuild's new dep).
**Shared-state contract:** `crates/xbuild/**` is shared harness code — additive
only (a new export, a new loop, a new argument); every existing case still runs.
`tests/gate-reachability.test.ts` already covers `run.sh` (it is wired to
`test:xbuild`), so no new reachability edit.
**Risks:** none known beyond the buffer width; cribbage reported "nothing to
report" at this phase.
**Done when:** `bash tools/check.sh xbuild npm run test:xbuild` green.
**Validation:** Narrow.

---

### Part B — the solver

### Phase 4: `chess-solver` — evaluation and search

**Goal:** A depth-capped, node-budgeted alpha-beta with quiescence and a
transposition table, whose `exact` flag means a proven terminal.

**Changes:**
- [ ] `crates/chess-solver` (deps: `adversary-core`, `adversary-solver`,
  `chess-core`, `rand`, `rand_chacha`): `eval.rs` — material + PST, integer
  centipawns, tapered by a 0..24 phase; mate scores as `MATE - ply` so a shorter
  mate is preferred; **every constant an `i32`**.
- [ ] `search.rs` — negamax alpha-beta; **quiescence** (captures + promotions,
  stand-pat, charged to the same `NodeBudget`); TT keyed on the Zobrist `Key`
  with depth and bound flags (exact / lower / upper — the sound version, not the
  D3-probe shortcut the checkers plan warned about); ordering TT-move → MVV-LVA →
  promotions → quiets; `Scored { value, exact }` where `exact` is true iff the
  value came from a terminal reached in the search (`chess_core::result` returned
  `Some`), propagated up only when *every* child on the principal path was proven
  — checkers' `search.rs` shape.
- [ ] Draw handling inside the search: a repetition or the 50-move clock inside
  the tree returns the draw score with `exact = true`; repetition detection uses
  the `history` the position carries plus the search path.
- [ ] `move_scores(board, depth, budget)`, `move_values`, `best_move`; never a
  partial iteration, never a truncated TT store.
- [ ] **In-phase measurement (the D3 deferral):** on D2's 50 positions, in wasm,
  at each provisional level: median / p95 / worst ms and the fraction over 400 ms;
  then the same with `adversary_solver::deepen` — adopt it only if nodes fall,
  record the number either way beside the constants and in `docs/AI-PLAYERS.md`.
  **Re-plan trigger:** any level's p95 > 400 ms on the Samsung → drop that level's
  depth/budget (a constant), log it.
- [ ] Tests: mate-in-1 / mate-in-2 / mate-in-3 puzzles found at sufficient depth
  with `exact = true`; a hanging-queen position where depth-3 *without* quiescence
  blunders and *with* it does not (the reason the feature exists, as a test);
  an **independent plain minimax** cross-check at depth 3 on 20 positions
  (Othello's discipline — the only thing that makes the alpha-beta a claim);
  `zero_budget_never_returns_partial`.

**Call chain:** `chess-wasm::live_move → chess_solver::live::choose →
search::move_scores → eval` (Phase 7 completes the chain; here the test driver is
the caller).

**Wiring test:** `mate_in_two_is_found_and_exact` through `move_scores` at
Expert's depth.

**Depends on:** Phase 3; Phase 0 D2 (the position set and provisional budgets).
**Read-set:** `crates/checkers-solver/src/{search,eval}.rs`,
`crates/othello-solver/src/search.rs:547-610,977-995` (the minimax cross-check
and its test),
`crates/adversary-solver/src/lib.rs`.
**Write-set:** `crates/chess-solver/**`, root `Cargo.toml` members, `Cargo.lock`.
**Shared-state contract:** `Cargo.toml` members — additive. The wasm timing needs
a scratch export (reverted before the phase ends — `git status` shows only the
solver) and the Samsung (claim per TESTBED).
**Risks:** The window sentinels — `TODO/README.md`'s open thread: every shelf
solver's `i32::MIN + 1` window has only ever been compiled with overflow checks by
`cargo mutants`. Chess opens its window at `-MATE_BOUND..MATE_BOUND` (a value well
inside `i32`), and this phase runs `cargo test -p chess-solver` **in debug once**
and records the time — closing the thread for this crate on day one. Second: a TT
keyed without the halfmove clock returns a draw-score for a position that is not
yet a draw; the key includes the clock bucket where it matters (≥ 90).
[device: android=samsung] — the wasm latency table.
**Done when:**
1. **Behavioral:** the puzzles are found and exact; the minimax cross-check agrees
   on all 20; the latency table is recorded with the `deepen` verdict.
2. **Verification:** `bash tools/check.sh solver cargo test -p chess-solver
   --release`, plus the one debug run.
**Validation:** Moderate — tests plus the wasm measurement on a phone.

### Phase 5: `chess-solver` — the difficulty band and the tutor

**Goal:** Four honest levels and an engine-grounded coach.

**Changes:**
- [ ] `live.rs` — `Level {Easy, Medium, Hard, Expert}` with `depth()` and
  `budget()` from Phase 4's table; `class_of(value)`: `+1` proven mate for the
  mover, `-1` proven mate against, else `0` (checkers' `capped_class` shape —
  centipawns are not a class); `live_band(level)` → `LiveBand`; `choose(board,
  level, rng)` over `adversary_solver::select_in_band`; an immediate mate is always
  taken.
- [ ] `tutor.rs` — `assess` (panel: `TUTOR_DEPTH = Expert + 1`) and
  `assess_for_move` (tap path: `COACH_DEPTH = Hard`), the compile-time orderings;
  `TutorMove { code, san, value, regret, quality, exact, immediate_win (mate in
  one), blocks_opponent_win (false), gives_check, captures (piece or none),
  promotes, castles }` — a structural superset of `TutorFactMove`; `MoveClass`
  from regret with **`Blunder` only when both values are proven**; `coach_line`
  bound to `exact` ("that threw the game" vs "looks risky") — the `coachFor` test
  asserts both branches.
- [ ] Tests: `expert_never_drops_a_proven_class` (over a mate-in-2 set, 200 seeds);
  `easy_beats_random_but_loses_to_expert` (self-play, small N — the order check,
  not a strength claim); `zero_sloppiness_does_not_consume_the_rng`; `coachFor`
  both branches.

**Call chain:** `chess-wasm::{live_move, coach_json, tutor_json} → live::choose /
tutor::assess*`.
**Wiring test:** `expert_vs_easy_self_play_terminates_and_expert_wins_most` through
`choose` at both levels over the real `Adversary` loop.
**Depends on:** Phase 4.
**Read-set:** `crates/checkers-solver/src/{live,tutor}.rs`.
**Write-set:** `crates/chess-solver/src/{live,tutor,lib}.rs`.
**Risks:** Easy that is not fun (too random or too strong) — the shelf has no
measurement for "fun"; record the sloppiness and depth chosen and leave tuning to
`TODO/chess.md`, as cribbage did.
**Done when:** all tests green; `bash tools/check.sh solver cargo test -p
chess-solver --release`.
**Validation:** Narrow.

### Phase 6: Mutation-test the core and the solver

**Goal:** The check on the check, before the crates have consumers.

**Changes:**
- [ ] **Commit the green state first** (CLAUDE.md's rule — before *every* round).
  `cargo mutants -p chess-core --in-place` then `-p chess-solver --in-place`
  (**`--in-place` because this worktree has `node_modules`** — the scratch copy
  fails with `File exists (os error 17)` otherwise, and `--in-place` refuses `-j`,
  so it is one job; cribbage's finding, `CLAUDE.md`), through `tools/check.sh`
  so the log is whole. Triage every survivor into *equivalent* (the packed-code
  `|`/`^` sites, the same as checkers' documented ones) or *real gap*, close the
  gaps with tests that pin behaviour, not implementation. Record the triage in the
  Review Log with counts.
- [ ] Restore with `git checkout HEAD -- <path>` **only after** `git status
  --porcelain <path>` is empty for the files being restored.

**Depends on:** Phases 2, 5. **Write-set:** tests in both crates; the plan.
**Risks:** run time — the perft tests are the slow ones, and `cargo mutants`
builds **debug**. Phase 1 already marks the CI-depth perfts
`#[cfg_attr(debug_assertions, ignore)]`, so the mutants run skips them by
construction and the depth ≤ 3 perfts (un-ignored) plus the vectors still
mutate-test generation. **The blind spot to check in the report:** a survivor
inside a branch only depth ≥ 4 reaches (a castling-through-check bar that only
Kiwipete at depth 4 exercises) is a real gap to close with a targeted vector,
not an equivalent mutant — cribbage's crib-table generator had 30 such
survivors for exactly this reason.
**Done when:** every survivor is triaged and named.
**Validation:** the mutants report, read in full.

---

### Part C — ship it

### Phase 7: `chess-wasm` — the C-ABI binding

**Goal:** The engine in the browser, holding one game, never panicking.

**Changes:**
- [ ] `crates/chess-wasm` mirroring `checkers-wasm`'s surface (Verified
  Assumptions) plus `fen()` and `san_json(code)`; `board_json` carries the 64
  cells, side, castling rights, ep square, halfmove clock, `in_check`, the last
  move **and its SAN (`lastSan`, computed at `play` time from the pre-move
  position and kept in the session — Pass 2's answer to Pass 1's third question:
  the seat `sub` reads "Nf3+" from the one call it already makes)**, captured
  material per side, and `result`; `legal_moves_json` the codes **with**
  `from`/`to`/`promo` unpacked so the UI never re-derives them. `san_json(code)`
  stays for the one caller that names a move *not yet played* — the Hint ring.
- [ ] `play(code)` returns 0 / 1 illegal / 2 over-or-invalid; `live_move`,
  `coach_json`, `tutor_json`, `assess_json` at the Phase 5 budgets;
  `outcome_json(declare)`.
- [ ] `tools/build-wasm.sh` `-p chess-wasm`; `build.mjs` copies
  `chess_wasm.wasm → dist/chess.wasm`.
- [ ] C-ABI tests: a game through the exports to a pinned hash; the promotion code
  round-trip; `assess_json` and `tutor_json` agree on `exact` for the same move
  (checkers' agreement test); every export on a terminal game returns its "over"
  sentinel rather than panicking.

**Call chain:** `src/games/chess/chess-wasm.ts → dist/chess.wasm exports`.
**Wiring test:** the exports test above, run natively (`cargo test -p chess-wasm`)
— and `npm run build:wasm` producing `dist/chess.wasm`.
**Depends on:** Phase 5.
**Read-set:** `crates/checkers-wasm/src/lib.rs`, `tools/build-wasm.sh`, `build.mjs`.
**Write-set:** `crates/chess-wasm/**`, `Cargo.toml` members, `Cargo.lock`,
`tools/build-wasm.sh`, `build.mjs`.
**Risks:** binary size — a TT sized for native is too big for wasm memory on a
phone; size it by a constant measured here (checkers' `Table::new()` is the shape)
and record `dist/chess.wasm`'s bytes in the Review Log.
**Done when:** `npm run build:wasm` emits `dist/chess.wasm`; the C-ABI tests are
green.
**Validation:** Narrow.

### Phase 8: The typed `Chess` wrapper + the verifiable outcome

**Goal:** A TypeScript surface the page and the rig share.

**Changes:**
- [ ] `src/games/chess/chess-wasm.ts` — `Chess` class over the exports
  (`newGame`, `board`, `legalMoves`, `play`, `liveMove(level)`, `assess`,
  `coach`, `tutor`, `fen`, `san`, `currentHash`, `renderText`, `outcome`);
  `Level` union `"Easy" | "Medium" | "Hard" | "Expert"`.
- [ ] `src/games/chess/chess-outcome.ts` — `verifyRecord` replaying `(seed,
  moves)` through the wasm; the `?r=` share format; the human-facing label from
  the A-centric result.
- [ ] `tests/chess-unit.test.ts` (vitest over the real wasm, the checkers shim —
  `readFile("target/wasm32-unknown-unknown/release/chess_wasm.wasm")` behind a
  `globalThis.fetch` override, `tests/checkers-unit.test.ts:19-31`; `preunit`
  builds it, which is why Phase 7's `build-wasm.sh` entry is a precondition):
  play a game, replay it, tamper it.

**Call chain:** `chess.ts (Phase 9) → Chess → wasm`.
**Wiring test:** `tests/chess-unit.test.ts` — a recorded game verifies and a
tampered one does not, through `verifyRecord`.
**Depends on:** Phase 7.
**Read-set:** `src/games/checkers/{checkers-wasm,checkers-outcome}.ts`,
`tests/checkers-unit.test.ts`.
**Write-set:** `src/games/chess/{chess-wasm,chess-outcome}.ts`,
`tests/chess-unit.test.ts`.
**Done when:** `bash tools/check.sh unit npm run unit -- chess` green.
**Validation:** Narrow.

### Phase 9: Playable `/chess/` — the frame, the board, the taps

**Goal:** A person can play a full game against The Engine on a phone.

**Changes:**
- [ ] `src/games/chess/chess.ts` — `chessModule` + `chessSetup` (rows: *Play as*
  White / Black / Random; *Difficulty*); `GameFrameSpec` with two seats (You / The
  Engine, glyph by colour, `score` = captured material, **`state`** = `"active"` /
  `"thinking"` / `"idle"` per `SeatMeter`, **`sub`** = the text: "your move" ·
  "check!" · "Nf3+" from `board().lastSan`), verbs Undo · Hint · New game…; `mode`
  chip = level; `snapshot()` / `resume()` (seed + moves + human side + level;
  `summary.line` like "Move 14 · you're up a knight"); the `declare global {
  Window.__chess }` E2E hook (checkers' `:50-60` shape) set on mount, deleted on
  unmount.
- [ ] `src/settings.ts` — `ChessLevel` / `ChessSide` types, `resolveChessLevel` /
  `resolveChessSide` (pure), `chessLevel()` (default `"Medium"`), `chessSide()`
  (default `"white"`, with `"random"` as a third stored value resolved at New
  game), `chessTutorEnabled()` (default off), keys `fun-chess-{level,side,tutor}`;
  `tests/settings.test.ts` gains the resolver cases (the checkers block at `:69`).
- [ ] `tokens.css` — the chess board tokens (`--chs-light`, `--chs-dark`,
  `--chs-a`, `--chs-b` for the piece fills, `--chs-legal`, `--chs-check`,
  `--chs-last`), and `tests/tokens.test.ts` gains their contrast pairs beside the
  `chk-*` rows at `:121-123` (piece on **both** square colours — chess pieces
  stand on light squares too, which checkers' men never do). `styles.css` uses
  only `var()` (the no-raw-hex unit test).
- [ ] `tests/chrome.test.ts:192` — insert `"chess"` in the drawer id list at the
  position the registry gives it (after `"checkers"`, the versus group's order).
- [ ] `src/music.ts` `BY_GAME` — name a track for chess from the shelf library
  (optional; unnamed falls back to `SHELF_TRACK`). See Open Questions.
- [ ] The board: an 8×8 CSS grid in the stage, oriented to the human (D5's pieces
  as SVG or glyphs, coloured by tokens); tap a piece → the core's legal
  destinations glow; tap a destination → `play`; a promotion destination opens
  the **picker** (four pieces, ≥ 44px each, absolutely positioned over the stage,
  Escape/scrim cancels); last move ringed; the checked king marked; The Engine's
  move shown with a beat; on a decisive end the mating move shown with fanfare
  before the result screen. Files and ranks labelled at the edges (a11y: each
  square is a button with an `aria-label` like "e4, white knight").
- [ ] Keyboard: arrows move a focus ring over the squares, Enter/Space taps
  (checkers' pattern).
- [ ] Undo takes back a pair of plies (yours and The Engine's) and marks
  assistance; Hint asks `coach_json` and rings the suggestion (marks assistance);
  hints-off → "I'm stuck" ends + reports, per §6.
- [ ] `src/registry.ts` entry in `SHIPPED` (`id: "chess"`, `group: "versus"`,
  `status: "playable"`, `emoji: "♞"`, `icon: true`, `pitch`, `setup: chessSetup`,
  `load: chessModule`); `src/games/chess/assets/{icon,splash}.jpg` —
  `tests/art.test.ts` asserts `icon: true` ⇔ the file exists, both directions, so
  the flag and the JPEG land in the same commit.
- [ ] `tests/chess.spec.ts` — the browser suite: a full game against Easy to a
  result screen (`@long`, `?fast=1` — the seam that collapses the engine's beats,
  so the test asserts rules, not pacing; `checkers.spec.ts:147-151`); the render
  and seat-state tests tagged `@smoke`; castling by tapping the king two squares;
  a promotion through the picker; en passant offered; a `?r=` share re-verifies;
  the **frame stability spec** (`tests/helpers/board-top.ts`) — **RED by
  construction, since a new game has no pre-migration page** (see Open
  Questions): the first commit of this phase mounts the board with the turn
  text as an in-flow line above it, the sampler records the jump on the
  engine's reply, the line moves into the seat `sub`, the sampler goes GREEN,
  and the delta is written in the Review Log; axe clean in both themes; 44px
  squares at 390px. `tests/a11y-matrix.spec.ts` picks chess up automatically
  from the registry — no edit, but one more game in a per-game budget.

**Call chain:** `main.ts → registry → chessModule.mount → frame.update(spec) →
Chess (wasm)`.
**Wiring test:** `tests/chess.spec.ts` "plays a game to the result screen and the
share re-verifies" — through the real page, both engines.
**Depends on:** Phase 8; Phase 0 D5.
**Read-set:** `src/games/checkers/checkers.ts` (1,018 lines — the versus archetype
with a multi-tap move), `src/games/othello/othello.ts` (the worked frame example),
`docs/BUILDING-GAMES.md` §4c, `docs/RESPONSIVE-DESIGN.md`.
**Write-set:** `src/games/chess/{chess,chess-howto(stub)}.ts`,
`src/games/chess/assets/**`, `src/registry.ts`, `src/settings.ts`, `src/music.ts`,
`tokens.css`, `styles.css` (a chess block), `tests/chess.spec.ts`,
`tests/chrome.test.ts`, `tests/settings.test.ts`, `tests/tokens.test.ts`.
**Shared-state contract:** `src/registry.ts`, `src/settings.ts`, `src/music.ts`,
`tokens.css`, `styles.css` and the three shared tests — every edit additive (a
new entry, a new block, a new row); no existing game's line changes. The
Playwright server, within the phase. `localStorage` keys are `fun-chess-*` only.
**Risks:** The promotion picker is the one modal-like thing; §4c allows an
overlay in the stage, and the `<dialog>` sheet is the one recorded modal
exception — the picker is an overlay, not a dialog, and it must be
keyboard-reachable. Second: orientation — one `viewSquare` function, unit-tested
both ways, is the entire mitigation; every DOM query in the spec goes through
board coordinates, never grid indices. [device: android x2] — the tap flow,
the picker at 44px, the glyphs (fulfilled in Phase 13).
**Done when:**
1. **Behavioral:** a full game on a phone-width viewport reaches a result screen
   whose share re-verifies; castling, en passant and promotion are all playable by
   tap.
2. **Verification:** `bash tools/check.sh e2e npx playwright test tests/chess.spec.ts`
   both engines; `npm run typecheck && npm run lint`.
**Validation:** Moderate — the spec plus playing it in a browser by hand.

### Phase 10: The tutor panel + the experimental hybrid opponent

**Goal:** Coaching without a model; a persona behind the WebGPU gate.

**Changes:**
- [ ] The tutor panel (opt-in preference, off by default): "Explain my options"
  lists the band in SAN with `ideaFor` ("takes the knight", "gives check",
  "promotes", "castles", "mate in 2" when exact); blunder flag and hint reasons
  bound to `exact`; reading state painted **before** the deep call.
- [ ] `ideaFor` set in **both** `chess.ts` and `chess-oracle.ts` (Phase 11) so the
  UI and the rig say the same thing.
- [ ] The hybrid opponent: the WebGPU probe + "Experimental: local AI opponent"
  toggle + download disclosure, reusing `hybrid-player.ts` / `ai-runtime.ts` /
  `banter.ts` **unchanged**; persona per Open Questions; canned lines; falls
  back to The Engine on any failure.
- [ ] `tests/chess-tutor.test.ts` — `coachFor` both branches;
  `tests/chess-hybrid.test.ts` — `MockRuntime` proves the plug-in on CI (an
  out-of-band pick falls back; a malformed reply falls back).

**Call chain:** `chess.ts → Chess.tutor() → buildBand → HybridPlayer.pick →
AIRuntime`.
**Wiring test:** `tests/chess-hybrid.test.ts` "a hybrid move is always in the
band" through `chessModule` with `MockRuntime`.
**Depends on:** Phase 9.
**Read-set:** `src/games/checkers/checkers.ts:129-140,480-620`,
`src/harness/{hybrid-player,ai-runtime,banter}.ts`, `tests/checkers-tutor.test.ts`
(the `MockRuntime` plug-in proof lives there for checkers — the template for
`chess-hybrid.test.ts`, which is a new file by choice, not by precedent).
**Write-set:** `src/games/chess/chess.ts`, `tests/chess-{tutor,hybrid}.test.ts`.
**Risks:** `banter.ts` rejects any digit or board noun — chess banter that says
"e4" or "the queen" is filtered; the canned lines must avoid both. Recorded, not
worked around.
**Done when:** both tests green; a real WebGPU run (`AI_TRIAL_MODE=hybrid npm run
ai:trial`) recorded in the Review Log as validated-not-gated.
**Validation:** Moderate.

### Phase 11: Chess meets the harness

**Goal:** "The Engine never blunders" as a number.

**Changes:**
- [ ] `src/games/chess/chess-oracle.ts` — the pass-through adapter (nine members;
  level `0..3` → `Level`); `idea` on tutor moves.
- [ ] `src/harness/harness-trial-entry.ts` — `"chess"` added to the `TrialGame`
  union (`:26`; `GAMES` is `Record<TrialGame, …>`, so the union is the type
  error that forces the entry) and `GAMES.chess` with a prompt that describes
  chess and the UCI move form.
- [ ] `tests/chess-harness.test.ts` — self-play tournament over the real wasm with
  the three non-vacuity assertions (`blunders === 0`, `scoredMoves > 0`,
  `abortedGames === 0`).
- [ ] `tests/baselines.test.ts` `ANCHORS.chess` — the Report recorded with the date.
- [ ] `docs/HARNESS.md` — the adapter list, the "ten members" → nine correction,
  and the side-by-side table's chess row **from Phase 10's real WebGPU run**
  (the table is a hybrid-vs-engine record, not a baseline — if Phase 10's run
  was skipped, the row is omitted and the omission is said in the Review Log).

**Wiring test:** `tests/chess-harness.test.ts` itself — the rig grades chess with
**no rig change** (`git diff --stat src/harness/{match-runner,scorer,tournament}.ts`
empty is asserted in the Review Log).
**Depends on:** Phase 10.
**Read-set:** `src/games/checkers/checkers-oracle.ts`,
`tests/checkers-harness.test.ts`, `tests/baselines.test.ts`, `docs/HARNESS.md:33-97`.
**Write-set:** `src/games/chess/chess-oracle.ts`, `harness-trial-entry.ts`,
`tests/chess-harness.test.ts`, `tests/baselines.test.ts`, `docs/HARNESS.md`.
**Risks:** `scoredMoves` near zero — chess's exact fraction could be thinner than
checkers'. If the 2-game CI tournament grades nothing, raise the tutor budget for
`assess_json` (the checkers fix) before lowering the bar; a 0 here is a finding,
not a pass.
**Done when:** `HARNESS_TRIAL_GAME=chess npm run harness:trial` prints a Report;
`npm run unit` grades chess; `npm run baselines` reproduces the anchor.
**Validation:** Moderate.

### Phase 12: "How to play" + guide shots

**Goal:** The guide, leading with what a new player gets wrong.

**Changes:**
- [ ] `src/games/chess/chess-howto.ts` (pure data): the goal; "tap a piece, then
  where it goes — you cannot leave your king in check, so the board only offers
  legal moves"; castling by moving the king two squares; en passant ("yes, that
  is a real move"); promotion and the picker; the draws (stalemate, threefold,
  50 moves, insufficient material) in one honest paragraph; the levels and the
  tutor; the verifiable record.
- [ ] `src/how-to-registry.ts`; `tools/guide-shots.mjs` `SHOTS` (`chess-board`,
  `chess-promotion`, `chess-result`); the sync tests.

**Wiring test:** the guide sync test + `npm run guide:shots` producing the three
images and the how-to page rendering them.
**Depends on:** Phase 9.
**Write-set:** `src/games/chess/chess-howto.ts`, `src/how-to-registry.ts`,
`tools/guide-shots.mjs`, `assets/guide/chess-*.jpg`.
**Risks:** re-encoding other games' JPEGs — `git checkout --` the rest after
`guide:shots` (CLAUDE.md), after checking `git status --porcelain` shows only
JPEGs.
**Done when:** the how-to page for chess renders with three shots; sync tests green.
**Validation:** Narrow.

### Phase 13: The device pass

**Goal:** The owed device checks fulfilled on the phones they name.

**Changes:**
- [ ] Claim `testbed--samsung` and `testbed--pixel`; seat the queue
  (`bash /Users/cpettet/git/chasemp/CroftC/.claude/bin/device-queue.sh --have
  samsung,pixel` — the script lives in the workspace root, three levels above
  this worktree, not in `fun/`) and take chess's items plus any older owed check
  the phones fulfil.
- [ ] On both phones: a full game by tap; the promotion picker at 44px; the
  glyphs/SVG in both themes; Expert's move latency felt and timed against Phase 4's
  table; the share link opened cold.
- [ ] Edit each `[device: …]` line in this plan to `[device done 2026-MM-DD: …]`.

**Depends on:** Phases 9–12.
**Shared-state contract:** the two claim files; released at phase end.
**Done when:** every `[device:` tag in this plan reads `[device done`.
**Validation:** Broad — the phones are the validation.

### Phase 14: Docs, changelog, gate, land

**Goal:** Record what landed, and land it.

**Changes:**
- [ ] Everything in Documentation Impact scheduled here: `TODO/README.md`,
  `TODO/drop4.md:185`, `TODO/chess.md` (new), the one-line pointer in
  `plans/2026-07-31-drop4-ai-harness.md`, `docs/AI-PLAYERS.md`,
  `docs/BUILDING-GAMES.md` §10 (roster, the honesty line, the new Variation
  block), `CLAUDE.md`, `README.md`, `CHANGELOG.md` (contexts + entry).
- [ ] Review Log entries for every phase, newest first, with the numbers.
- [ ] `bash tools/check.sh gate npm run gate` (Rust + xbuild + binding + typecheck
  + lint + unit + build + e2e — `package.json` `test`); `bash
  /Users/cpettet/git/chasemp/CroftC/.claude/bin/workspace-audit.sh` (Pass 1 wrote
  `../.claude/…`, which from `worktrees/chess/fun` resolves to nothing).
- [ ] `TODO/README.md:19` — the target heading is "Shipped — Tier-1 Croft-native
  (playable)"; the chess entry leaves "Next games" (`:82`) and the list below it
  renumbers.
- [ ] Rebase onto `origin/main`, push, open the PR (`land: chess — …`) — **ask
  before merging**, per COORDINATION; landing claims `landing-on-main` for the
  registry edit.

**Wiring test:** the closing grep sweep (Documentation Impact) returns only lines
this plan wrote.
**Depends on:** Phase 13.
**Done when:** gate green on CI (all three jobs), PR open, audit clean.
**Validation:** Broad.

---

## Open Questions

- `[CONFIRMED: BLOCKING — owner, 2026-08-30, "accept all"]` **Build-fresh `chess-core`, or a vetted generator?**
  *Recommendation: build-fresh, for the four reasons in Reasoning — licence
  (GPL-3.0 is not on the allowlist), sourcing (not-ours means vendor + drift
  check), staleness of the MIT option, and perft making our own code the
  better-verified one. Blocking because it structures Phases 1–3 and the crate
  list; if the owner would rather widen the allowlist for `shakmaty`, Phases 1–2
  become a vendoring harness + wrapper and the plan is re-passed.*

- `[CONFIRMED: BLOCKING — owner, 2026-08-30, "accept all"]` **Threefold repetition and the 50-move rule as
  automatic draws (no claim)?** *Recommendation: yes — a claim needs a claimant;
  every consumer chess site auto-draws; it terminates the shuffles. The
  alternative (fivefold + 75-move, the FIDE automatic pair) is also deterministic
  but lets a dead position run ~150 extra plies against a bored engine. Blocking
  because the `history` in the state and the hash depend on it (Phase 2).*

- `[CONFIRMED: PHASE-GATED (Phase 9) — owner, 2026-08-30, "accept all"]` **Flip the board for a human playing
  Black?** *Recommendation: flip — chess's convention is universal and the cost is
  one tested function. Checkers' deferral was about checkers. Gated on Phase 9
  because nothing before it renders a board.*

- `[CONFIRMED: PHASE-GATED (Phase 9) — owner, 2026-08-30, "accept all"]` **Unicode glyphs or our own SVG set?**
  *Resolved by D5's screenshots; the recommendation is SVG (rendering consistency,
  and no CC-BY-SA attribution surface). Gated on Phase 9.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **A Resign verb?** *Recommendation: no, for v1 — none
  of the five versus games has one, New game… is the exit, and a resigned game's
  record would need a terminal the replay cannot reach (a new outcome shape).
  Tracked in `TODO/chess.md` with that reason.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **The hybrid persona's name.** *Recommendation: "Ash"
  — the roster is trees (Rowan, Alder) plus Chip; a tree name that also reads
  austere. Inlined in `chess.ts` like the others until the roster thread lands.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **Should the seed mean Chess960 later?** *Recommendation:
  reserve it in `RULES.md` now (the comment `initial(_seed)` carries), build
  nothing. A follow-up in `TODO/chess.md`.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **The "Grandmaster" Stockfish level.** *Recommendation:
  out of this plan, recorded as a Tier-3-shaped follow-up with the `exact`
  objection and the vendoring requirement, so the next person does not re-derive
  either.*

*Added by Pass 2 (2026-08-30):*

- `[CONFIRMED: PHASE-GATED (Phase 2) — owner, 2026-08-30, "accept all"]` **The repetition history as a
  fixed-capacity array from the start, not a `Vec` measured later?**
  *Recommendation: yes — `[Key; 100]` + `len`. Pass 1's first question to Pass 2.
  The search calls `Adversary::apply` (a new `Position`) at every node; a `Vec`
  is a heap allocation per node, an array is an 808-byte copy with none. The
  hash is defined over the logical list, so the container is free to change and
  no pinned vector moves. Phase 4 still measures `Clone` cost and records it.
  Gated on Phase 2 because that is where `Position` is written; the change is
  already reflected in Phase 2's bullets on the recommendation.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **How is a new game's frame stability spec ever
  RED?** *Pass 1's fourth question. `BUILDING-GAMES.md:410-414` and the §4c
  checklist say "run it against the pre-migration page first"; that is written
  for a migration, and a new game has no pre-migration page — a spec that fails
  because `/chess/` does not exist proves nothing about stability.
  Recommendation: RED by construction (Phase 9's bullet now says so): the first
  mount puts the turn text in flow above the board, the sampler records the jump
  on the engine's reply, the text moves to the seat `sub`, GREEN, delta in the
  Review Log. This is the checklist's intent (the sampler must be seen to see
  movement) satisfied honestly; Phase 14's `BUILDING-GAMES.md` edit adds one
  sentence to `:414` saying what a new game does.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **`board_json` carries the last move's SAN?** *Pass
  1's third question. Recommendation: yes — `lastSan`, computed once at `play`
  time from the pre-move position. The seat `sub` then says "Nf3+" from the call
  the UI already makes per render; `san_json(code)` stays only for the Hint ring,
  which names a move not yet played. Reflected in Phase 7.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **A default music track for chess?** *`src/music.ts`
  `BY_GAME` is optional (an unnamed game plays `SHELF_TRACK`). Recommendation:
  name one from the existing library rather than ship the shelf default — every
  other versus game names one; the choice is taste and takes a minute in Phase 9.*

- `[CONFIRMED: ADVISORY — owner, 2026-08-30, "accept all"]` **Run Phases 11 and 12 in parallel?** *Recommendation:
  no — see the Concurrency Map's candidate note. Disjoint files, but both build
  into the one `dist/` and both serve on the default port.*

---

## Review Log

### Pass 2: Gap Analysis — 2026-08-30

**Found:**
- **Seven more registration points than the "ten" Pass 1 counted**, every one
  a red board or a silent miss if skipped: `tests/chrome.test.ts:192` asserts the
  drawer's id list in order; `src/settings.ts` + `tests/settings.test.ts` hold
  each versus game's remembered level / side / tutor preference (the plan said
  "both remembered" and named no file); `tokens.css` + `tests/tokens.test.ts`
  contrast pairs; `tests/art.test.ts` asserting `icon: true` ⇔
  `src/games/<id>/assets/icon.jpg` in both directions; `src/music.ts` `BY_GAME`
  (optional); `harness-trial-entry.ts:26` `TrialGame` union (the `GAMES` record
  is keyed on it); and `crates/xbuild` in four files.
- **Phase 3 could not have been executed as written.** xbuild enrols a game by
  hand in `Cargo.toml`, `src/lib.rs`, `check.mjs` and `run.sh`; its one move
  channel is `[u8; 256]`, and a 15-bit chess code does not fit. Write-set was "the
  xbuild scenario file(s) for chess"; the vectors also had no named home
  (`crates/chess-core/vectors/` in the `{name, note, seed, moves,
  final_state_hash}` shape check.mjs reads).
- **Phase 2's Zobrist constants "from a fixed seeded ChaCha20 table" needed a
  dependency Phase 1's crate list did not have** (`rand` + `rand_chacha`;
  `checkers-core` carries neither). Resolved with a `const fn` splitmix64 table —
  no dep, compile-time, native == wasm by construction.
- `impl pond_outcome::Game` omitted the required `VERSION` const.
- **Five factual errors in citations**: `dep_gate.py:103-107` → `:106-112`, and
  "it would be the first GPL entry" is false — `GPL-2.0-or-later` is on the
  allowlist (the argument survives: `GPL-3.0-*` is absent and `shakmaty`'s
  single-arm expression is not satisfied by the 2.0 entry); `othello-solver
  search.rs:141-201` is the `Bound` enum and TT, the minimax is at `:547-610` with
  its test at `:977-995`; `AI-PLAYERS.md:706` → `:711`; `BUILDING-GAMES.md:876`
  → `:877`; and `GameOracle` has **nine** members, not ten (`game-oracle.ts:103-116`
  — `docs/HARNESS.md:47` miscounts; Phase 11 corrects it while the file is open).
- **Two script paths that resolve to nothing from this worktree**: Phase 13's
  `bash .claude/bin/device-queue.sh` and Phase 14's `bash ../.claude/bin/
  workspace-audit.sh` — both live in `CroftC/.claude/bin/`, three levels up.
- Phase 6's "a `cargo mutants` config that skips `perft_*`" is not the repo's
  mechanism; `#[cfg_attr(debug_assertions, ignore)]` is (`CLAUDE.md`, from the
  cribbage audit), and `--in-place` is required in a worktree with `node_modules`.
  Moved the `cfg_attr` to Phase 1 where the tests are written, and named the
  blind spot it creates (a branch only depth ≥ 4 reaches).
- Phase 9 conflated the frame's seat `state` (`"idle" | "active" | "thinking"`,
  `game-frame.ts:25`) with its `sub` text; Phase 14's `TODO/README.md` target
  heading and the `npm run test` composition (`test:binding` was missing from the
  list) were imprecise; Phase 10's `MockRuntime` template is
  `tests/checkers-tutor.test.ts`, not a `checkers-hybrid.test.ts` (none exists).
- `docs/HARNESS.md`'s side-by-side table is a real-WebGPU record, so its chess
  row can only come from Phase 10's `ai:trial` run — the Phase 11 doc bullet now
  says so, and says what to write if that run was skipped.
- **Pass 1's five questions, answered:** (1) history container — fixed array
  from Phase 2, hash over the logical list (new PHASE-GATED question, reflected
  in Phase 2); (2) perft next to the 53 s job — ~16M nodes of mailbox
  make-and-check is single-digit seconds in release, the ≤ 10 s budget stands,
  and Phase 1 now records the measured wall-clock; (3) `board_json` SAN — yes,
  `lastSan` at `play` time (Phase 7); (4) stability spec RED for a new game — RED
  by construction, the checklist's wording is migration-shaped (new ADVISORY
  question; Phase 9 bullet; one sentence owed to `BUILDING-GAMES.md:414` in
  Phase 14); (5) baseline determinism — confirmed: the anchor is a Report over
  moves chosen by `select_in_band` with a seeded ChaCha20 RNG and a nodes-not-ms
  budget (`adversary-solver/src/lib.rs:87-100`), so the `history` hash changes
  nothing the Report sees; `tests/baselines.test.ts:152-170` records checkers on
  the pinned toolchain the same way.

**Concurrency:**
- Disjointness confirmed: the map is all-sequential and every write-set overlap
  found (Phases 1/4/7 on `Cargo.toml` + `Cargo.lock`; Phase 3 on `Cargo.lock`
  via xbuild's new dep; Phases 9/10 on `chess.ts`) is already on the spine.
- Shared-state contracts sharpened to invariants: Phase 3 (`crates/xbuild/**`
  additive, every existing case still runs); Phase 9 (six shared files, every
  edit additive, `localStorage` keys `fun-chess-*` only); the every-phase note
  now names the ports (Phases 0, 9, 10, 12, 13) and the device claims (Phases 0,
  4, 13 — Pass 1's note named only 13).
- Missed-parallelism candidate {11 || 12} surfaced: disjoint write-sets, but both
  build into one `dist/` and serve on one port. Recommended sequential; recorded
  in the map and as an ADVISORY question for the user to decide.
- No re-entry verification added — no phase is dispatched to a subagent, and the
  candidate above is recommended against.

**Changed:**
- Verified Assumptions: `dep_gate.py` lines and the GPL-2.0 correction;
  `game-oracle.ts` nine members; the seventeen registration points with their
  lines; `TutorFactMove` fields; the test shapes (tags, `?fast=1`, the fetch
  shim, `__checkers`, the `MockRuntime` home); `SeatMeter` fields; the
  migration-shaped stability rule; new entries for xbuild's buffer and vector
  shape, `othello-solver` minimax lines, the workspace `rand` deps, and
  `settings.ts`'s resolver shape.
- Reasoning → "Build-fresh" point 1: the allowlist's actual copyleft entries.
- Documentation Impact: `AI-PLAYERS.md:711`, `BUILDING-GAMES.md:877`,
  `HARNESS.md` bullet expanded (real-run row, "ten" → nine), registration-point
  list extended per phase.
- Phase 1: `cfg_attr(debug_assertions, ignore)` on the CI-depth perfts, depth ≤ 3
  un-ignored, wall-clock recorded; `crates/chess-core/vectors/` created.
- Phase 2: fixed-capacity history; `const fn` splitmix64 Zobrist table with the
  seed in `RULES.md`; `VERSION = 1`; hash over the logical list; the two vectors
  written in xbuild's shape; risk text updated.
- Phase 3: the four xbuild edits with the `[u16; 512]` channel; write-set,
  read-set, shared-state contract and dependency rewritten to match.
- Phase 4: minimax read-set lines.
- Phase 6: `--in-place`; the `cfg_attr` mechanism; the depth ≥ 4 blind spot.
- Phase 7: `lastSan` in `board_json`; `san_json` scoped to the Hint ring.
- Phase 8: the fetch-shim load path and why Phase 7 is its precondition.
- Phase 9: `state` vs `sub`; the `__chess` hook; `settings.ts`, `tokens.css`,
  `tests/chrome.test.ts`, `src/music.ts`, `icon: true` ⇔ file; `@smoke` / `@long`
  / `?fast=1`; RED-by-construction stability; a11y matrix auto-enrolment;
  write-set and shared-state contract extended.
- Phase 10: read-set names the `MockRuntime` template.
- Phase 11: nine members; `TrialGame` union; the HARNESS row's provenance.
- Phase 13: absolute path to `device-queue.sh`.
- Phase 14: absolute path to `workspace-audit.sh`; `test:binding` in the gate
  list; the `TODO/README.md` target heading.
- Concurrency Map: ports and claims per phase; the {11 || 12} candidate.
- Open Questions: five added (one PHASE-GATED, four ADVISORY); none re-opened.
- Status line.

**Confirmed:**
- Every other file:line in Verified Assumptions and the Phases opened and read
  as cited: `adversary-core/src/lib.rs`, `checkers-core/src/game.rs` (and the
  1,883-line size), `adversary-solver/src/lib.rs`, `checkers-solver/src/{tutor,
  search,live}.rs`, `checkers-wasm/src/lib.rs` (all sixteen exports at the lines
  given), `checkers-oracle.ts` (87 lines, `idea` at `:74-79`), `checkers.ts:540`
  (1,018 lines), `registry.ts:106-116`, `how-to-registry.ts:12,30`,
  `build.mjs:165-167`, `guide-shots.mjs:357-363`, `build-wasm.sh:19`,
  `Cargo.toml:14-56`, `baselines.test.ts:152`, `CHANGELOG.md:7`,
  `rust-toolchain.toml` (1.97.1), `spike/` (five projects, cribbage's
  `results.txt`), `tools/check.sh`, `TESTBED.md:63-102`, `TODO/README.md:110-127`,
  `TODO/drop4.md:185`, the July plan's `:18` and `:625-644`, `DECISIONS.md:66-81`,
  `pond-outcome`'s `Game` trait, `xbuild`'s wiring into `test:xbuild` and the
  gate-reachability guard, `docs/RESPONSIVE-DESIGN.md` exists, `[device: …]`
  tags conform to TESTBED rule 2.
- The build-fresh decision and its four reasons hold after the GPL-2.0
  correction; the honesty gate, the 15-bit code, quiescence, nodes-not-ms and
  the Stockfish objection are unchanged by anything found.
- The "Depends on" fields are accurate after the changes: Phase 3 now names the
  vectors it needs from Phase 2; Phase 8's dependency on Phase 7 has its reason
  (`preunit` builds the wasm the shim reads); nothing circular.
- The spine order is right: no phase consumes anything a later phase produces.
  Shipping any prefix leaves a coherent tree (a core without a solver, a solver
  without a binding, a binding without a page — each is green on its own gate).
- The Concurrency Map's named near-miss (D2 beside Phase 1) still holds for the
  reason given.

### Pass 1: Plan development — 2026-08-30

**Research done before writing:** the shelf's adversarial standard
(`BUILDING-GAMES.md` §10, §4c, both checklists; `AI-PLAYERS.md` in full;
`HARNESS.md` "Adding your game"); the checkers plan (the proven-terminal `exact`,
the packed code, the coach/tutor split, the Concurrency Map near-misses) and the
cribbage plan (the phase shape, `RULES.md`-first, the mutation audit as a phase);
`adversary-core`, `adversary-solver`, `checkers-{core,solver,wasm}` source; the
ten registration points; FIDE Laws E01 (Arts. 3, 5, 9); the perft reference
table; crates.io for `shakmaty` and `cozy-chess`; the workspace licence allowlist
and dependency-sourcing decision; the Stockfish build facts.

**The decisions this pass made, and where they came from:**
- Build-fresh, reversing the July recommendation — from the allowlist, the
  sourcing rule, and perft (Reasoning → "Build-fresh").
- Threefold and 50-move automatic; insufficient material as the computable subset
  of dead position; checkmate precedes a draw — from FIDE 9.2/9.3/5.2.2 and the
  cozy-chess 0.3.3 bug.
- The 15-bit `(from, to, promo)` code; UCI as the text bridge; SAN rendered only.
- `exact` = proven terminal (checkers' shape); quiescence mandatory; `deepen`
  measured in Phase 4, not assumed; nodes not ms.
- Stockfish is not the Oracle, and where it could go.
- Orientation follows the human (gated); own SVG pieces (gated on D5).

**What Pass 2 should look for:** whether Phase 2's `history` vector makes the
search's `Position: Clone` too heavy and Phase 4 needs a ring buffer from the
start; whether the perft CI budget (~16M nodes) is acceptable next to the
existing 53 s Rust job; whether `board_json` should carry SAN for the last move
so the seat `sub` can say "Nf3+" without a second call; whether the frame's
stability spec can be run RED before Phase 9 exists (it is run against the
*placeholder* page for a new game — confirm the checklist's intent); and whether
`tests/baselines.test.ts` needs the chess anchor to be deterministic across the
`history` hash (it does — the RNG is untouched at zero sloppiness, but the anchor
must be recorded on the pinned toolchain).
