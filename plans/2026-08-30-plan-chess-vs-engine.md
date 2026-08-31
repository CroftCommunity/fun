# Chess vs the engine — the sixth adversarial game, and the first whose rules are the weight

**Status:** READY TO EXECUTE — Pass 1 (plan development) 2026-08-30; Pass 2 (gap
analysis) 2026-08-30; Pass 3 (quality gates) 2026-08-30. Every open question is
owner-confirmed and none is BLOCKING-unresolved; the two PHASE-GATED items gate Phases 2
and 9 and are already reflected in those phases. **Phase 0 executed 2026-08-30**
(D1 / D2-desktop / D3-deferral / D4 / D6 closed; D2's Samsung half and D5's
two-Android half owed, `[device: …]` tags on their task lines) — **Phase 1 executed 2026-08-30** (perft green at CI depth on all six positions; differential perft 200/0) — **Phase 2 executed 2026-08-30** (terminals, both trait impls, hash, SAN, vectors; gate green) — **Phase 3 executed 2026-08-30** (both chess cases green in wasm) — **Phase 4 executed 2026-08-30** (search green, deepen adopted ≥ d4, budgeted ladder 0/50 over 400 ms in Chromium; Samsung half owed) — **Phase 5 executed 2026-08-30** (band + tutor green; Expert v Easy 20/20, Easy v random 14/20) — **Phase 6 executed 2026-08-30** (core 674: 60→23 all equivalent; solver 422: 302→69, real gaps closed and hand-verified) — **Phase 7 executed 2026-08-30** (binding green, 205 KB wasm, 1.06 MiB memory) — **Phase 8 executed 2026-08-30** (wrapper + outcome, 6/6 over the real wasm) — **Phase 9 executed 2026-08-30** (playable /chess/, 30/30 both engines, a11y auto-enrolled) — **Phase 10 executed 2026-08-30** (tutor + hybrid green, 38/38 both engines; the real-WebGPU run moves to Phase 11's `harness:trial`, the game-parameterised runner) — **Phase 11 executed 2026-08-30** (adapter + anchor 6/163, rig diff empty; real WebGPU run 52 model moves / 0 fallbacks / 0 blunders) — **Phase 12 next.**
Worktree `worktrees/chess/fun`, branch `claude/chess`.
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

**Pass 3 spot-checks — read firsthand 2026-08-30 (each one changed a phase):**

- `tests/how-to.test.ts:10-46` iterates `Object.entries(GUIDES)` only — a playable
  game with **no** guide entry is not red anywhere. So nothing forces Phase 9 to ship a
  `chess-howto` stub, and the "No stubs" guardrail says it must not; the stub is gone
  from Phase 9's write-set and the guide is wholly Phase 12's.
- `tests/chrome.test.ts:192` asserts the drawer ids in **`SHIPPED` array order** — the
  shipping order, not a per-group order (`"drop4", "othello", "checkers", "dots",
  "furrow", …, "cribbage"`; `src/chrome.ts` reads no `group`). The last shipped entry is
  cribbage at `src/registry.ts:195`, so chess's entry is appended after it and `"chess"`
  is inserted between `"cribbage"` and `"placeholder"` — Pass 2's "after `"checkers"`,
  the versus group's order" would have been a red board.
- `build.mjs:165-167` copies `target/wasm32-unknown-unknown/release/<game>_wasm.wasm →
  dist/<game>.wasm` when **`node build.mjs`** runs; `npm run build:wasm`
  (`tools/build-wasm.sh:19`) only writes `target/…`. Phase 7's Done-when named the wrong
  command for `dist/chess.wasm`; it now asserts both artefacts by the command that makes
  each.
- `.github/workflows/deploy.yml:31,82,141,223,294-296` — the jobs are `build`, `rust`,
  `wasm`, `e2e` (a browser × shard matrix that `needs: [wasm]`) and `deploy`, which
  `needs: [build, rust, e2e]`. "All three jobs" in Phase 14 is now the named set.
- `src/harness/tournament.ts:45,95-100` — `Report.abortedGames`, `llmMoves` and
  `fallbackMoves` exist and the rendered Report prints the fallback rate. The checkers
  plan's Pass 3 flagged `HybridDecision.source` as computed-and-discarded; it is counted
  now, so Phase 10's real-WebGPU run records the two counts instead of re-flagging it.
- `crates/checkers-wasm/src/lib.rs` reports no depth-reached anywhere (`ORACLE_DEPTH`
  at `:48` is a constant); `docs/AI-PLAYERS.md:319` — "a named level depth is a ceiling,
  not a promise. Once deepening is in … report the depth actually reached." Chess is the
  first shelf solver *expected* to adopt `deepen`, so Phases 4 and 7 carry `depth` and
  `nodes` on the tutor/oracle JSON (additive fields the checkers shape lacks).
- `#[cfg_attr(debug_assertions, ignore = "…")]` has two precedents to copy:
  `crates/cribbage-core/src/score.rs:319` and `crates/cribbage-solver/src/crib_table.rs:126`.
  `mutants.toml` lives at the **workspace root** (a copy in a crate is silently ignored —
  its own header says so).
- `crates/xbuild/check.mjs:8,12-19` — the usage comment, the destructured argument list
  and the usage error string all enumerate the six vector directories by name; Phase 3's
  seventh argument touches all three (Pass 2 named only the loop). The per-game loops
  iterate `readdir(dir)` with **no empty-directory guard** (`:150` is the shape): a
  vectors directory with zero `.json` files runs zero cases and reports green —
  `CroftC/.claude/VERIFICATION.md` shape 3. Phase 3 adds the guard for its own directory.
- `package.json:18` `smoke` = `playwright test --project=chromium --grep @smoke`;
  `tools/harness-trial.mjs:11-12` documents `HARNESS_TRIAL_GAME=<id>`;
  `tools/ai-trial.mjs:9` documents `AI_TRIAL_MODE=hybrid`. Phase 9–11's commands match.
- `TODO/README.md:155-171` — the open thread that no shelf solver's window sentinel has
  ever been compiled with overflow checks outside a mutation run; Phase 4's one debug
  run is the closer for this crate and is now a named Verification command, not a Risk
  aside.
- `TODO/drop4.md:185` reads "then **chess** (heavier — vetted move-gen + Stockfish-WASM
  oracle, gated on larger-binary hosting)" — false from Phase 1's first commit, not from
  the landing. Moved to Phase 1 with `TODO/README.md:110-112`'s "Needs a vetted move
  generator".
- `plans/2026-08-29-plan-cribbage-vs-engine.md` carries **no Pass 3 entry** — its Review
  Log is execution entries only (`:714-858`). The depth model for this pass is the
  checkers plan's `### Pass 3: Quality Gates — 2026-08-04`.

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

**Verified by Phase 0 execution (2026-08-30, `spike/chess-search`):** the D2 node
and latency table (in D2's task entry — native M-series Mac + desktop Chromium
≈ 2.6M nps; depth 5 quiescent p95 = 682k nodes / 254 ms Chromium, 0/50 over
400 ms; quiescence costs 2.5–3× nodes at every depth); the seven D4 draw
fixtures, including the two repetition exclusions (9.2.3.1–2) and
mate-precedes-the-clock — with the earliest-seen-cycle-member finding Phase 2's
tests must encode; cozy-chess's king-takes-rook castling encoding as a
spike-only quirk. *Pass 3 settled D4's `from_fen` half during planning:* five of
the six perft positions Phase 1 asserts are FENs, so `Board::from_fen` exists
whatever D4 finds — test-and-bridge only, never the record format.

**Still not verified (owed to the device pass):** the phone halves — the
Samsung nps ratio that converts D2's node budgets to phone milliseconds, and how
the two Androids render chess glyphs (D5). Both carry `[device: …]` tags on
their task lines; both gate Phase 9/13 tuning, not Phases 1–8.

---

## Documentation Impact

Every file this plan makes stale, scheduled in the phase that breaks it.

- `TODO/README.md` → "Next games" entry **1. Chess** (`:110-127`) — moves to
  "Shipped — Tier-1"; its two sub-bullets (the hosting-note correction and the
  Stockfish objection) become history and the objection is carried into
  `TODO/chess.md`. **Phase 14** for the move; **Phase 1** for the one sentence the
  first build-fresh commit makes false ("Needs a vetted move generator", `:110-112`
  → "build-fresh, verified by perft — plan …"). *(Pass 3 split.)*
- `TODO/drop4.md:185` — "then **chess** (heavier — vetted move-gen + Stockfish-WASM
  oracle, gated on larger-binary hosting)" is stale on all three counts (build-fresh,
  our Oracle, no hosting gate). Replaced with a pointer to this plan. **Phase 1**
  *(Pass 3: moved from Phase 14 — the line is false from the first commit that
  builds `chess-core`, and a claim made false in Phase 1 is fixed in Phase 1).*
- `TODO/chess.md` — **new**, the running worklist (what shipped, follow-ups:
  Stockfish level, opening book, Chess960 via the seed, PGN, move list, Resign,
  persona roster). **Phase 14.**
- `plans/2026-07-31-drop4-ai-harness.md` "Phase 9 — chess" (`:625-644`) and its
  open question — historical; **one line added** pointing here, the vetted-lib
  recommendation left as the record of what was thought in July. **Phase 14.**
- `docs/AI-PLAYERS.md` — the generality section (`:633-714`): chess becomes the
  third unsolved-game precedent — **Phase 14** for the paragraph that records what
  shipped; but "a future game (chess is the obvious one)" (`:711`) is false the day a
  chess Oracle exists, so that one sentence is **Phase 5** *(Pass 3 split)*, in the
  same edit as the search-cost section's chess `deepen` verdict and budget table
  (**Phase 5**, unchanged); the "one principle" already lists chess.
- `docs/BUILDING-GAMES.md` §10 — the roster paragraph (`:591-620`: "Furrow is the
  fifth") gains chess as the sixth; the honesty-gate line "(Othello, chess)"
  (`:877`) becomes a reference to a shipped game; the adversarial checklist's
  "Reference implementations" gains chess as the *quiescence + repetition-history*
  variant. A **"Variation — a move that changes the piece, and a state that carries
  history (chess)"** block, in the style of the Furrow/Dots variations. **Phase 14.**
  The one sentence owed to `:414` (what a *new* game does to see its stability spec
  red — the ADVISORY question below) is **Phase 9** *(Pass 3: moved from Phase 14 —
  Phase 9 is where the RED-by-construction run happens and the delta is measured, so
  the sentence is written from evidence, not from memory of it).*
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
  check.mjs,run.sh}` (Phase 3 — in `check.mjs` the usage comment at `:8`, the
  destructured argument list at `:12-14` and the usage error string at `:16` all
  enumerate the directories by name and all gain the seventh; Pass 3),
  `tools/build-wasm.sh` + `build.mjs` (Phase 7),
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

**Pass 3 re-check (2026-08-30).** Write-sets re-read after this pass moved five doc
edits between phases (Phase 1 gains `TODO/drop4.md` + `TODO/README.md`; Phase 5 gains
`docs/AI-PLAYERS.md:711`; Phase 9 gains `docs/BUILDING-GAMES.md:414` and loses the
`chess-howto` stub; Phase 4's latency harness moves from a scratch export inside the
crate to `spike/chess-latency/`). No two phases became disjoint enough to unbunch and
no new overlap appeared: `docs/AI-PLAYERS.md` is now written by Phases 5 and 14,
`docs/BUILDING-GAMES.md` by 9 and 14, `TODO/README.md` by 1 and 14 — all already on
the spine. The map stays **all sequential**; the contracts above are invariants
(what each phase will and will not touch), not mechanisms; and with no subagent
dispatch there is still no re-entry verification to write. **The checkpoint rule
that makes a mid-plan failure locatable:** every phase ends in its own commit,
subject `chess: phase N — …` (Phase 6 commits *before* each mutation round as well),
so `git log --oneline` names the last green phase and `git diff HEAD` is exactly the
phase in flight.

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

- [x] **D1: Is build-fresh the right call under the workspace's rules?** *(Reading
  only; resolved in Pass 1 and recorded here so execution does not re-open it.)*
  - **Probe:** `dep_gate.py` allowlist (`:103-107`) — GPL-3.0 absent;
    `DECISIONS.md` § dependency-sourcing — vendor + drift for not-ours; crates.io
    for `shakmaty` (GPL-3.0-or-later) and `cozy-chess` (MIT, 2024).
  - **Success criteria:** A recorded decision with the four reasons in Reasoning →
    "Build-fresh". **Met.**
  - **Disposition:** `keep-as-fixture` — the reasoning is the fixture.

- [x] **D2 (desktop halves): RESOLVED 2026-08-30; the phone half stays owed.**
  Measured over the 50 positions (16 lines + 9 endgame FENs + 25 seeded
  random-play boards; `spike/chess-search`, fresh 16 MiB TT per search):

  | depth | q-ON nodes med / p95 / worst | q-OFF nodes med / p95 / worst | Chromium q-ON ms med / p95 / worst |
  |---|---|---|---|
  | 2 | 982 / 3.6k / 6.1k | 125 / 267 / 339 | 0.7 / 1.7 / 2.3 |
  | 3 | 3.6k / 26k / 32k | 1.6k / 5.2k / 5.4k | 1.7 / 9.4 / 11.7 |
  | 4 | 20k / 142k / 248k | 6.6k / 30k / 54k | 7 / 52 / 86 |
  | 5 | 90k / 682k / 881k | 51k / 358k / 441k | 32 / 254 / 352 |
  | 6 | 409k / 4.5M / 5.2M | 150k / 2.0M / 2.4M | (not run — d5 already brackets the bar) |

  Native (this Mac, M-series): d5 q-ON p95 153 ms; Chromium ≈ 2.6M nps, ~1.7×
  slower than native. **0/50 over 400 ms at depth 5 in desktop Chromium**, so the
  re-plan trigger (no depth ≥ 4 fits the phone bar) is not close to tripping even
  at a 3–4× phone slowdown for depth 4. **Provisional level table for Phase 4:**
  Easy d2 · Medium d3 · Hard d4 · Expert d5, Expert under a ~500k `NodeBudget`
  (trims the p95 tail: 682k → budget bite on ~1 in 20 positions). Quiescence
  costs ~2.5–3× nodes at every depth — the tax is now a number.
  **The hang probe returned a null result** (0/50 hangs at depth 3 with *and*
  without quiescence, ≥ 700cp swing metric): the sampled positions do not
  discriminate, so it is recorded as exactly that — not as evidence against
  quiescence. Consequence for Phase 4: its "depth-3-without-quiescence blunders"
  test must use a **constructed** tactical position, not a sampled one.
  Spike quirk recorded for Phase 1: cozy-chess encodes castling king-takes-rook
  (`e1h1`); chess-core uses standard UCI `e1g1`.
  *(Original probe spec follows.)*
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
  - **Disposition:** `n/a` — D3 produces no code in Phase 0; the measurement is
    Phase 4's, on Phase 4's crate, under Phase 4's TDD *(Pass 3: every task declares
    one, including the deferred one)*.

- [x] **D4: Build the draw-rule fixtures.** — **RESOLVED 2026-08-30.** Seven
  fixtures, all validated by `spike/chess-search` (`fixtures` subcommand, cozy-chess
  supplying mate/stalemate/50-move and the spike counting repetition over cozy's
  `same_position`, which implements exactly FIDE 9.2's definition): (a) threefold
  live at ply 7, draw at exactly ply 8; (a') the lost-castling-right visual
  repetition at ply 8 does **not** count; (b) the en-passant-capturable ply-1
  occurrence does **not** count, live at ply 9; (c) clock 99 live / 100 draw, a
  pawn move and a capture at 99 both reset to 0; (d) mate on the move that reaches
  clock 100 is a **win**. All start from a FEN (decision recorded: the fixtures are
  FEN-anchored; `from_fen` exists for the perft suite regardless). Longest fixture:
  13 plies — well under the 30-move readability target. **Two findings Phase 2's
  tests must carry:** (1) in a shuffle cycle the *earliest-seen* position reaches
  three occurrences first, so (a') and (b) draw at ply 10 via the position after
  ply 2 — the naive "the salient position repeated thrice" expectation is wrong by
  two plies; (2) cozy-chess encodes castling king-takes-rook (`e1h1`,
  Chess960-style) — a spike-only quirk to translate when these fixtures are
  re-expressed against chess-core's standard `e1g1` wire form. Move lists in
  `spike/chess-search/src/main.rs` (`FIXTURES`), which is the keep-as-fixture
  artifact Phase 2 transcribes.
  - **Probe:** Four concrete fixtures, each as `(start FEN, move list in UCI)`:
    (a) threefold — a king-and-rook shuffle that is *live* after the second
    occurrence and `Draw` on exactly the third, plus a variant where a castling
    right is lost between occurrences and therefore does **not** count (9.2.3.2);
    (b) the ep-possibility variant — the same squares, ep capturable in the first
    occurrence only, so it does not count (9.2.3.1); (c) 50-move — a sequence that
    reaches halfmove 99 live and 100 `Draw`, and a capture at 99 that resets it;
    (d) checkmate on the 100th halfmove is a win, not a draw. Confirm each fixture
    is short enough to read (target ≤ 30 moves from a FEN). *(Pass 3 resolved the
    `from_fen` half during planning rather than deferring it: Phase 1's perft suite
    needs `Board::from_fen` for five of its six positions whatever D4 finds, so the
    constructor exists either way — used **only by tests and the text bridge**, never
    by the record format. D4 decides only whether these four fixtures start from a
    FEN or from the opening, and records which.)*
  - **Success criteria:** The four move lists, each reaching its terminal at the
    exact ply and not before.
  - **Disposition:** `keep-as-fixture` — they become Phase 2 tests.

- [ ] **D5 (page built; the device half is the open part): OWED.** The probe page
  is `spike/chess-glyphs/index.html` — Unicode natural glyphs, CSS-coloured
  filled glyphs, and a first-cut own-SVG set, at 44px, light/dark toggle. No
  Android was attached on 2026-08-30 (adb shows none), so the decision waits for
  a phone; it gates Phase 9, not Phases 1–8. **D5: How do chess pieces render on
  the two Androids?**
  - **Probe:** A static HTML page under `spike/chess-glyphs/` with the twelve
    Unicode glyphs at 44px in the shelf's two themes, and the same twelve as
    inline SVG paths (a first cut of our own set). Open it on the Samsung and the
    Pixel through the dev server; screenshot both.
  - **Success criteria:** A decision — glyphs or SVG — with the screenshots as
    evidence. If Unicode renders the white pieces as outlines or any piece as an
    emoji on either phone, SVG is chosen (the recommendation either way).
  - **Disposition:** `promote` if SVG — the paths become `src/games/chess/assets/`
    in **Phase 9**, where they get TDD like any promoted code (the `viewSquare`
    orientation tests and the tokens contrast rows are the tests that reach them);
    `throwaway` if Unicode — the page is deleted and Phase 9 renders glyphs. *(Pass 3:
    both branches named, so the disposition is declared whichever way D5 goes.)*
  - [device: android x2]

- [x] **D6: Documentation-reference sweep.** *(Resolved in Pass 1 — see
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
- [x] `crates/chess-core` (workspace member, `[lints] workspace = true`; deps:
  `adversary-core`, `serde`, `sha2`, `hex`, `pond-outcome`): `Square` (0..63),
  `Piece`/`Color`, `Board` as a mailbox (a 64-cell array plus the FEN fields:
  side, castling rights, ep square, halfmove clock, fullmove number).
- [x] `RULES.md` — **written first**: the table from Reasoning, with FIDE article
  numbers, the move-code layout, the square numbering, the text-bridge grammar, and
  the seed's reserved meaning. Every test below cites a section.
- [x] `Board::from_fen` / `to_fen` — the test-and-bridge constructor (settled in Pass
  3: the perft suite needs it); `Board::start()` is `from_fen(START)`. Round-trips
  pinned on the six perft FENs — both directions: `to_fen(from_fen(s)) == s` for each
  string, and `from_fen` of a malformed string (seven ranks; a rank summing to nine;
  a castling right with no rook on its square) is an `Err`, never a panic.
- [x] `Move {from, to, promo}` with `code()` / `from_code()` (15 bits,
  `MAX_MOVE_CODE`), `Serialize`/`Deserialize` as one `u16`, reject-above-max
  (the checkers pattern).
- [x] Pseudo-legal generation per piece; `attacked(sq, by)`; castling with all four
  bars (3.8.2.2); en passant; promotion ×4; **legality by make-and-check** (apply,
  test own king attacked, discard). `legal_moves(&Board) -> Vec<Move>` in a
  deterministic order (the order is part of `variant`-free determinism: the band's
  tie-breaks read it).
- [x] `apply_move(&Board, Move) -> Board`: moves the piece, handles the rook in
  castling, the captured pawn in ep, the promotion piece, castling-right loss (king
  move, rook move, rook captured on its home square), ep-square set/clear, the
  halfmove clock (reset on pawn move or capture), the fullmove number.
- [x] **Perft** (`perft(&Board, depth) -> u64`) with the six positions asserted at
  the CI depths and the deeper rows under `#[ignore]`. Plus per-move split perft
  (`divide`) as a test helper for locating a divergence. **The CI-depth tests
  carry `#[cfg_attr(debug_assertions, ignore = "release only: ~16M nodes")]`**
  (the repo's recorded mechanism, `CLAUDE.md` → mutation testing) — the release
  gate runs them; `cargo mutants` and any debug run skip them; and depths ≤ 3 on
  all six positions (~150k nodes) stay un-ignored so generation is still exercised
  in debug. Record the release wall-clock of the suite in the Review Log (Pass 1's
  question about the 53 s Rust job: ~16M nodes of a mailbox make-and-check
  generator is single-digit seconds in release; the ≤ 10 s budget below decides).
- [x] `crates/chess-core/vectors/` — the golden vectors as JSON in the xbuild
  shape (`{name, note, seed, moves, final_state_hash}`; `moves` are the `u16`
  codes), written in Phase 2, **directory created here** so Phase 3's `run.sh`
  argument has a home.
- [x] **RED first, item by item (Pass 3 — the order a reader writes this phase).**
  `RULES.md` → the FEN round-trip tests → `from_fen`/`to_fen` → the move-code tests →
  `Move` → the depth-1/2/3 perfts on all six positions → generation and `apply_move` →
  the depth-4/5 perfts → whatever is still wrong. Every test is watched RED before its
  code exists; the perfts are RED by construction (a generator that does not exist
  counts nothing). **The constants are data and get tests before they are typed:**
  `from_code(MAX_MOVE_CODE)` round-trips and `MAX_MOVE_CODE + 1` is rejected at
  deserialize (the serde boundary pair, checkers' `game.rs:523-527`); `promo` 4 is
  accepted and 5 rejected at `from_code`; square 63 round-trips and 64 does not
  construct.
- [x] **The edges perft cannot name (Pass 3 — mutation resistance).** Perft is an
  aggregate: a bar mutated away would still change the count, but only a `divide`
  hunt would say *which* rule. So every rule with a branch also gets a direct test on
  a hand-built FEN, **both sides of the branch**, each citing its `RULES.md` section:
  castling — each of the four bars alone (the right lost; a piece on the path; the king
  in check; the crossed square attacked; the landing square attacked) removes exactly
  that castle from `legal_moves` while the other wing's castle stays; castling rights —
  lost by a king move, by each rook's own move, and by each rook being captured on its
  home square, and **not** lost by anything else (a rook that leaves and returns has
  already lost it — the state, not the square, is the truth); en passant — legal on
  the move immediately after the double push and gone one move later, and a double
  push nobody can capture still records its ep square in FEN; promotion — a push to
  the last rank yields exactly four moves and nothing else in `legal_moves` carries
  `promo ≠ 0`; the halfmove clock — reset by a pawn move, reset by a capture,
  incremented by a quiet piece move; a pinned piece may move along the pin line and
  not off it; a king may not capture a defended piece; a move that gives check is
  generated and a move that leaves the mover in check is not.
- [x] **When a perft disagrees, the log names the subtree (Pass 3 — diagnostics).**
  The CI-depth assertions run through `divide`: on a mismatch the failure message
  prints the per-move split beside the reference total, so the divergent first move
  is in the log and not reconstructed by hand. The differential perft records in the
  Review Log the first disagreeing FEN if there is one, and "200 positions, 0
  disagreements" if there is not — a count either way, never "agreed".
- [x] **Docs this phase makes false (Pass 3 — moved from Phase 14):**
  `TODO/drop4.md:185` ("vetted move-gen + Stockfish-WASM oracle, gated on
  larger-binary hosting") → one line pointing at this plan; `TODO/README.md:110-112`
  "Needs a vetted move generator …" → "build-fresh, verified by perft — see the plan".
  The entry stays under "Next games" until Phase 14 moves it.

**Call chain:** `Board::start → legal_moves → apply_move → …` (the perft driver is
the first caller of everything).

**Wiring test:** `perft_start_depth_5_is_4_865_609` and
`perft_kiwipete_depth_4_is_4_085_603` — RED with any generation bug, GREEN only when
castling, ep, promotion and check-legality are all right at once.

**Depends on:** Phase 0 (D2's spike is the differential oracle in Risks; nothing
else — `from_fen` is settled).
**Read-set:** `crates/checkers-core/src/{game,board,hash}.rs`,
`crates/othello-core/src/game.rs`, `RULES.md`.
**Write-set:** `crates/chess-core/**`, root `Cargo.toml` members, `Cargo.lock`,
`TODO/drop4.md`, `TODO/README.md` (one sentence each — Pass 3).
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
2. **Verification:** `bash tools/check.sh core cargo test -p chess-core --release`
   **and** `bash tools/check.sh rust npm run test:rust` — the per-crate command runs
   neither `fmt --check` nor `clippy -D warnings` on the pinned toolchain, and CI's
   `rust` job runs both (Pass 3; every Rust phase names the gate, as the checkers plan
   did). No `unwrap`/`expect` outside tests: `grep -n 'unwrap()\|expect(' \
   crates/chess-core/src` read in full, every hit under `#[cfg(test)]` (a grep whose
   output is read is a check; a `grep -c` is not). The release wall-clock of the suite
   goes in the Review Log against the ≤ 10 s budget.
**Validation:** Narrow — the perft suite *is* the validation, plus the one-shot
differential perft in Risks (Pass 3: Narrow holds because nothing outside the crate
is touched; the differential run is what makes "the six positions" a claim about
positions the six do not exercise).

### Phase 2: `chess-core` — terminal rules, `Adversary`, `pond_outcome::Game`, hash, text bridge

**Goal:** A complete game as a pure state machine with a replayable record.

**Changes:**
- [x] `Position` = `Board` + `history` (position keys since the last irreversible
  move, ≤ 100) — **a fixed-capacity `[Key; 100]` + `len: u8` from the start, not a
  `Vec`** (Pass 2's answer to Pass 1's first question; see Open Questions). `Key`
  is a **Zobrist** hash (`hash.rs`) over piece placement, side, castling rights and
  the *capturable* ep square (9.2.2). **The 781 constants come from a `const fn`
  splitmix64 over a fixed seed, evaluated at compile time** — no `rand` /
  `rand_chacha` dependency in the core (`checkers-core` has neither), no runtime
  table init, and native == wasm by construction. The seed and the generator are
  recorded in `RULES.md` beside the move-code layout so a reader can regenerate
  the table.
- [x] `result(&Position)`: checkmate (loser = side to move), stalemate,
  insufficient material (the four cases), 50-move (clock ≥ 100), threefold
  (`history` holds the current key ≥ 2 more times). **Checkmate first** — D4(d).
- [x] `impl Adversary` (`KIND = "chess"`, `initial(seed)` ignores the seed with the
  reserved-meaning comment, `side_to_move`, `legal_moves` empty when terminal,
  `apply`, `result`, `state_hash` = sha256 over the canonical serialization of
  `Position` **including `history`**, `render_text` = ASCII board + FEN + "moves
  are long algebraic, e.g. e2e4", `move_to_text` / `parse_move` in UCI form).
- [x] `impl pond_outcome::Game` (`KIND = "chess"`, **`VERSION = 1`** — the trait
  requires it, `crates/pond-outcome/src/lib.rs:18-27`) — replay `(seed, moves)`,
  skipping moves not in `legal_moves` so a tampered list diverges
  (`othello-core/src/game.rs:252-276`).
- [x] `state_hash` is defined over the **logical** history (the `len` keys in
  order), never the container, so the array/ring choice can change later without
  moving a single pinned hash.
- [x] `san_of(&Position, Move) -> String` — the rendering the panel reads
  (disambiguation by file/rank/both, `x`, `=Q`, `+`/`#`, `O-O`/`O-O-O`). Rendered,
  never parsed.
- [x] Golden vectors, each citing `RULES.md`: the D4 fixtures (a–d); fool's mate and
  scholar's mate (`WinB`, `WinA`); a stalemate; each insufficient-material case and
  the K+B v K+B *opposite* colours non-case; castling rights lost by a rook
  capture; en passant only for one move; promotion to each piece; a full game
  from the start replayed to a pinned hash; two positions equal in FEN but
  different in `history` hashing differently. The full game and the D4(a)
  threefold game are **also** written to `crates/chess-core/vectors/01-full-game.json`
  and `02-threefold.json` (the xbuild shape) — the vectors Phase 3 replays in wasm.
- [x] **RED first, the data included (Pass 3).** The Zobrist table is 781 constants
  and gets its test before the `const fn` is written: no key is zero, no two keys are
  equal, and the **first and last keys equal the two literal values written in
  `RULES.md`** beside the seed — so a reader can regenerate the table and a changed
  seed is a deliberate red, not a silent re-hash of every vector. The insufficient-
  material subset is data too: each of the four cases is a test, **and each named
  non-case** (K+B v K+B on opposite colours; K+R v K; K+P v K; K+N+N v K — not in the
  subset, live, and `RULES.md` says why; K+B+N v K) stays live.
- [x] **The boundaries, named (Pass 3 — mutation resistance).** Threefold: the second
  occurrence is live and the **third** is `Draw` (D4a), the castling-right variant
  does not count (D4a′), the ep-possibility variant does not count (D4b). The clock:
  halfmove **99** live, **100** `Draw` (D4c), a capture at 99 resets to 0 and the game
  runs on, a checkmate delivered on the 100th halfmove is a `Win` (D4d). Checkmate
  before stalemate: a position that is both "no legal moves" and "in check" is mate,
  the same with no check is stalemate. The history bound: an irreversible move clears
  `len` to 0; 99 reversible plies leave `len = 99` and live; the 100th is the clock's
  draw, so `len` never exceeds the array — pinned as a test of the *invariant*, not
  guarded by an `unwrap` path. `state_hash`: two same-FEN positions with different
  histories differ (already listed) **and** two positions with the same logical
  history and any container state are equal.
- [x] **The gaps CLAUDE.md says the mutation audit finds first, closed now (Pass 3).**
  *A trait impl that only delegates:* the terminal / replay / hash tests call
  `<Position as Adversary>::…`, never the free functions — plus one explicit pair:
  `Adversary::legal_moves` on the opening has 20 entries and on a mated position is
  empty. *`render_text`:* the ASCII board for a hand-built FEN is asserted **exactly**
  (the whole string, glyph for glyph), not `contains`. *`san_of`:* no disambiguation /
  by file / by rank / by both; `+` vs `#`; `exd6` for ep; `exd8=Q#`; `O-O` / `O-O-O`.
  *`parse_move`:* `e7e8q` and `E7E8Q` parse to the same move; `e7e8` (a promotion with
  no piece) is `None`; a well-formed illegal move (`e2e5`) is `None`. *Replay:* a
  tampered move, a truncated list, and a move appended after the terminal all fail
  `verify`, each for its own reason — three tests, not one.
- [x] **A hash mismatch names its ply (Pass 3 — diagnostics).** The vector tests
  assert the pinned hash *and*, on failure, print the FEN and the move index at which
  the replay first diverged — the record a Phase 3 wasm disagreement is read against.

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
2. **Verification:** `bash tools/check.sh core cargo test -p chess-core --release`
   and `bash tools/check.sh rust npm run test:rust` (Pass 3 — fmt + clippy on the
   pinned toolchain, the same as CI).
**Validation:** Narrow.

### Phase 3: native == wasm cross-build

**Goal:** The determinism claim, checked by the harness that exists for it.

**Changes:**
- [x] The two Phase 2 vectors (`crates/chess-core/vectors/01-full-game.json`,
  `02-threefold.json`) with natively recorded hashes; `npm run test:xbuild`
  replays them in `wasm32` and asserts equality.
- [x] **Enrol chess in the harness — four hand edits** (Pass 2; the harness
  auto-discovers nothing): `crates/xbuild/Cargo.toml` gains `chess-core = { path =
  "../chess-core" }`; `src/lib.rs` gains `chess_replay_hash(seed_lo, seed_hi, len)`
  over a **new `static mut CHESS_IN: [u16; 512]`** with `chess_in_ptr` /
  `chess_in_cap` — the shared `IN: [u8; 256]` cannot carry a 15-bit code, and 256
  bytes as LE pairs is 128 plies, shorter than a repetition game; `check.mjs`
  takes a seventh positional `<chess-vectors>` and pushes a `chess ${v.name}`
  case per file (the cribbage loop's shape, seed as two `u32` halves, moves
  written as `Uint16Array`); `run.sh` passes `crates/chess-core/vectors`.
- [x] `crates/chess-core` builds for `wasm32-unknown-unknown` with no `std` feature
  it cannot have (no `getrandom`, no floats, no time).
- [x] **RED first, and green must be seen to grade something (Pass 3).** The RED:
  `run.sh` passes `crates/chess-core/vectors` and `check.mjs` reads the seventh
  argument **before** `chess_replay_hash` exists in `src/lib.rs` — the run fails on the
  missing export, which is the wiring test failing for the right reason. Then the
  export, then green. `check.mjs`'s usage comment (`:8`), destructured argument list
  (`:12-14`) and usage error string (`:16`) all gain the seventh directory — three
  places, not one. **Shape-3 guard:** the chess loop fails the run if its directory
  yields zero `.json` files (`VERIFICATION.md` shape 3 — the existing loops have no
  such guard, so a vectors directory that is empty or misnamed is a green run that
  graded nothing; additive, chess's loop only). Green is confirmed by reading the
  whole `check-xbuild.log` for the two `chess …` case lines by name — a count is not
  the check.

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
**Done when:** `bash tools/check.sh xbuild npm run test:xbuild` green, with the two
chess cases present by name in the whole log; `bash tools/check.sh rust npm run
test:rust` green (xbuild's `lib.rs` is workspace Rust and clippy sees it).
**Validation:** Narrow.

---

### Part B — the solver

### Phase 4: `chess-solver` — evaluation and search

**Goal:** A depth-capped, node-budgeted alpha-beta with quiescence and a
transposition table, whose `exact` flag means a proven terminal.

**Changes:**
- [x] `crates/chess-solver` (deps: `adversary-core`, `adversary-solver`,
  `chess-core`, `rand`, `rand_chacha`): `eval.rs` — material + PST, integer
  centipawns, tapered by a 0..24 phase; mate scores as `MATE - ply` so a shorter
  mate is preferred; **every constant an `i32`**.
- [x] `search.rs` — negamax alpha-beta; **quiescence** (captures + promotions,
  stand-pat, charged to the same `NodeBudget`); TT keyed on the Zobrist `Key`
  with depth and bound flags (exact / lower / upper — the sound version, not the
  D3-probe shortcut the checkers plan warned about); ordering TT-move → MVV-LVA →
  promotions → quiets; `Scored { value, exact }` where `exact` is true iff the
  value came from a terminal reached in the search (`chess_core::result` returned
  `Some`), propagated up only when *every* child on the principal path was proven
  — checkers' `search.rs` shape.
- [x] Draw handling inside the search: a repetition or the 50-move clock inside
  the tree returns the draw score with `exact = true`; repetition detection uses
  the `history` the position carries plus the search path.
- [x] `move_scores(board, depth, budget)`, `move_values`, `best_move`; never a
  partial iteration, never a truncated TT store.
- [x] **In-phase measurement (the D3 deferral):** on D2's 50 positions, in wasm,
  at each provisional level: median / p95 / worst ms and the fraction over 400 ms;
  then the same with `adversary_solver::deepen` — adopt it only if nodes fall,
  record the number either way beside the constants and in `docs/AI-PLAYERS.md`.
  **Re-plan trigger:** any level's p95 > 400 ms on the Samsung → drop that level's
  depth/budget (a constant), log it. **The harness is `spike/chess-latency/`** (Pass
  3): its own Cargo project depending on `chess-core` / `chess-solver` by path, built
  to `wasm32-unknown-unknown`, driven by a Node script that prints the table — not a
  scratch export inside the shipped crate. Nothing to revert, `git status` clean by
  construction, `spike/*/target/` already git-ignored, and Phase 13 times the phones
  with the **same** harness so its numbers are comparable to this table. Disposition
  `keep-as-fixture`, like D2's FEN set.
- [x] **What the search reports (Pass 3 — observability).** `move_scores` returns,
  beside the values, the **depth actually reached** and the **nodes consumed** —
  `docs/AI-PLAYERS.md:319`'s rule for the day deepening is in ("a named level depth
  is a ceiling, not a promise"). Phase 7 carries both onto `tutor_json` and
  `oracle_move_values_json` as `depth` / `nodes`, so a Phase 13 "Expert felt slow" is
  read against a number the phone produced. No shelf solver reports this yet; chess
  is the first expected to adopt `deepen`, so it is the first that needs to.
- [x] Tests: mate-in-1 / mate-in-2 / mate-in-3 puzzles found at sufficient depth
  with `exact = true`; a hanging-queen position where depth-3 *without* quiescence
  blunders and *with* it does not (the reason the feature exists, as a test);
  an **independent plain minimax** cross-check at depth 3 on 20 positions
  (Othello's discipline — the only thing that makes the alpha-beta a claim);
  `zero_budget_never_returns_partial`.
- [x] **RED first, the constants included (Pass 3).** The PSTs are data: each table
  has 64 entries; the black table is the white table mirrored
  (`pst_b[sq] == pst_w[mirror(sq)]` for all 64); a centre knight outscores a rim
  knight; `MATE` exceeds the largest material sum so a proven mate always outranks
  material; `phase(start) == 24` and `phase(K v K) == 0`. Each is a test written
  before the table it pins.
- [x] **The edges (Pass 3 — mutation resistance; single-point assertions on
  branching code survive one-line mutations).** *`exact` propagation:* a node with one
  proven child and one heuristic child on the principal path is **not** exact (kills
  the `all`→`any` mutation), and a node whose every child is proven is. *Mate
  preference:* a position with both a mate-in-1 and a mate-in-3 chooses the mate-in-1
  (`MATE - ply`, both directions: the shorter loss is avoided too). *Budget:*
  exhaustion mid-iteration returns the last complete iteration or nothing — never a
  mix of depths across moves (`zero_budget…` is the zero point; this is the edge
  above it); after exhaustion **no** TT store happens (a probe test that counts
  stores, checkers' shape). *The clock bucket:* two identical placements at halfmove
  10 and 98 do not share a draw-valued TT entry. *Quiescence:* a quiet position's
  q-search returns exactly the static eval (stand-pat), and a position with one
  capture returns the better of stand-pat and the capture. *Draws in the tree:* the
  third occurrence counting `history` scores as a draw with `exact = true`; the
  second does not.

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
**Shared-state contract:** `Cargo.toml` members — additive. The wasm timing runs
from `spike/chess-latency/` (its own project, its own lock file; `git status
--porcelain Cargo.lock` stays empty across the measurement) and the Samsung (claim
per TESTBED). *(Pass 3: the scratch export inside the crate is replaced by the spike
so there is nothing to revert.)*
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
   --release`; `bash tools/check.sh solver-debug cargo test -p chess-solver` (the
   one debug run — overflow checks on, closing `TODO/README.md:155-171`'s thread for
   this crate; its wall-clock in the Review Log); `bash tools/check.sh rust npm run
   test:rust`. The latency table and the `deepen` verdict are in the Review Log
   **with the machine, browser and phone** each number came from.
**Validation:** Moderate — tests plus the wasm measurement on a phone.

### Phase 5: `chess-solver` — the difficulty band and the tutor

**Goal:** Four honest levels and an engine-grounded coach.

**Changes:**
- [x] `live.rs` — `Level {Easy, Medium, Hard, Expert}` with `depth()` and
  `budget()` from Phase 4's table; `class_of(value)`: `+1` proven mate for the
  mover, `-1` proven mate against, else `0` (checkers' `capped_class` shape —
  centipawns are not a class); `live_band(level)` → `LiveBand`; `choose(board,
  level, rng)` over `adversary_solver::select_in_band`; an immediate mate is always
  taken.
- [x] `tutor.rs` — `assess` (panel: `TUTOR_DEPTH = Expert + 1`) and
  `assess_for_move` (tap path: `COACH_DEPTH = Hard`), the compile-time orderings;
  `TutorMove { code, san, value, regret, quality, exact, immediate_win (mate in
  one), blocks_opponent_win (false), gives_check, captures (piece or none),
  promotes, castles }` — a structural superset of `TutorFactMove`; `MoveClass`
  from regret with **`Blunder` only when both values are proven**; `coach_line`
  bound to `exact` ("that threw the game" vs "looks risky") — the `coachFor` test
  asserts both branches.
- [x] Tests: `expert_never_drops_a_proven_class` (over a mate-in-2 set, 200 seeds);
  `easy_beats_random_but_loses_to_expert` (self-play, small N — the order check,
  not a strength claim); `zero_sloppiness_does_not_consume_the_rng`; `coachFor`
  both branches.
- [x] **RED first, the level table included (Pass 3).** `depth()` and `budget()` are
  non-decreasing Easy → Expert and Expert's depth is ≥ 4 unless D2's re-plan trigger
  fired (then the recorded value); `TUTOR_DEPTH > Level::Expert.depth()` and
  `COACH_DEPTH == Level::Hard.depth()` are compile-time assertions (checkers'
  `tutor.rs:54,68`). Written before the table.
- [x] **The edges (Pass 3 — mutation resistance).** *`class_of` at three points:* a
  proven mate for the mover → `+1`, a proven mate against → `−1`, and a heuristic
  `+900` → `0` — the third is the edge, since magnitude is not class. *Sloppiness at
  0 and 100* plus the no-floor case (the selector must sometimes pick below the best
  at 100, or it is not sloppiness). *An immediate mate is taken at Easy* — the level
  whose sloppiness would otherwise be allowed to skip it. *`coachFor` three
  branches*, as checkers' test has them (`checkers-tutor.test.ts:41,49,55`): "threw
  the game" only when both values are proven; "looks risky" for a clearly weak
  horizon judgement; silent when there is nothing honest to flag.
- [x] **The qualitative claims get numbers (Pass 3).** Over 20 seeded games each,
  Expert beats Easy ≥ 15 and Easy beats a seeded-random player ≥ 14; the counts go
  in the Review Log, and a miss is a finding about the level table, not a flaky
  test to loosen.

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
chess-solver --release`; `bash tools/check.sh rust npm run test:rust`; the
`docs/AI-PLAYERS.md` edit (`:711` past tense + the chess row in the search-cost
section) is in this phase's commit *(Pass 3: the sentence is false once this Oracle
exists)*.
**Write-set (Pass 3 addendum):** `docs/AI-PLAYERS.md` joins the list above.
**Validation:** Narrow.

### Phase 6: Mutation-test the core and the solver

**Goal:** The check on the check, before the crates have consumers.

**Changes:**
- [x] **Commit the green state first** (CLAUDE.md's rule — before *every* round).
  `cargo mutants -p chess-core --in-place` then `-p chess-solver --in-place`
  (**`--in-place` because this worktree has `node_modules`** — the scratch copy
  fails with `File exists (os error 17)` otherwise, and `--in-place` refuses `-j`,
  so it is one job; cribbage's finding, `CLAUDE.md`), through `tools/check.sh`
  so the log is whole. Triage every survivor into *equivalent* (the packed-code
  `|`/`^` sites, the same as checkers' documented ones) or *real gap*, close the
  gaps with tests that pin behaviour, not implementation. Record the triage in the
  Review Log with counts.
- [x] Restore with `git checkout HEAD -- <path>` **only after** `git status
  --porcelain <path>` is empty for the files being restored.
- [x] **Closing a survivor means watching the new test fail against it (Pass 3;
  `CLAUDE.md` → mutation testing).** Re-apply the mutation by hand, run the new test,
  see RED, restore, see GREEN — twice in one session a test written to kill a mutant
  did not. A survivor is not closed until that has been seen.
- [x] **Read the whole log, not its tail (Pass 3 — `VERIFICATION.md` shape 1).**
  `tools/check.sh` writes the full `cargo mutants` output to `check-<label>.log`; the
  summary line (`N mutants tested: caught / missed / timeout / unviable`) and every
  `MISSED` line are read from that file. The Review Log records the four counts per
  crate and the per-survivor triage; "11 survivors looked like all of them" is the
  incident this bullet exists for.
- [x] After every restore, the **full** `cargo test -p chess-core -p chess-solver
  --release` — not the one test that was mutated — because a bad restore shows up in
  the tests you were not looking at.

**Wiring test:** none — an audit phase adds no call chain (Pass 3 accepts this as
the checkers plan accepted Phase 6's, with the same conversion: this phase is not
done until `bash tools/check.sh rust npm run test:rust` is green on the restored
tree, which is the whole-workspace proof that the audit left nothing behind).
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
- [x] `crates/chess-wasm` mirroring `checkers-wasm`'s surface (Verified
  Assumptions) plus `fen()` and `san_json(code)`; `board_json` carries the 64
  cells, side, castling rights, ep square, halfmove clock, `in_check`, the last
  move **and its SAN (`lastSan`, computed at `play` time from the pre-move
  position and kept in the session — Pass 2's answer to Pass 1's third question:
  the seat `sub` reads "Nf3+" from the one call it already makes)**, captured
  material per side, and `result`; `legal_moves_json` the codes **with**
  `from`/`to`/`promo` unpacked so the UI never re-derives them. `san_json(code)`
  stays for the one caller that names a move *not yet played* — the Hint ring.
- [x] `play(code)` returns 0 / 1 illegal / 2 over-or-invalid; `live_move`,
  `coach_json`, `tutor_json`, `assess_json` at the Phase 5 budgets;
  `outcome_json(declare)`.
- [x] `tools/build-wasm.sh` `-p chess-wasm`; `build.mjs` copies
  `chess_wasm.wasm → dist/chess.wasm`.
- [x] C-ABI tests: a game through the exports to a pinned hash; the promotion code
  round-trip; `assess_json` and `tutor_json` agree on `exact` for the same move
  (checkers' agreement test); every export on a terminal game returns its "over"
  sentinel rather than panicking.
- [x] **The edges (Pass 3 — mutation resistance).** `play` returns each of its three
  values from its own input: a legal code → 0; a well-formed illegal code → 1;
  `MAX_MOVE_CODE + 1` → 2; any code after the terminal → 2. "Every export on a
  terminal game" is enumerated, not sampled: `live_move` → `MOVE_OVER`, `play` → 2,
  `coach_json` / `tutor_json` / `assess_json` → the empty buffer, `result_code` → the
  terminal's code. `board_json`: `lastSan` absent before the first move and `"e4"`
  after `e2e4`; `in_check` false then true across a checking move; `legal_moves_json`
  unpacks a promotion square as four entries with one `from`/`to` and `promo` 1..4.
  `tutor_json` and `oracle_move_values_json` carry Phase 4's `depth` and `nodes`, and
  a test pins that `depth ≤ level.depth()`.
- [x] **Sizes in the Review Log (Pass 3 — observability):** the TT size constant, the
  bytes of `target/wasm32-unknown-unknown/release/chess_wasm.wasm`, and the wasm
  memory the module declares — the three numbers a "does not load on the Pixel"
  would be read against.

**Call chain:** `src/games/chess/chess-wasm.ts → dist/chess.wasm exports`.
**Wiring test:** the exports test above, run natively (`cargo test -p chess-wasm`)
— the exports are the binding's entry point; the same bytes are reached from
TypeScript in Phase 8's shim test — and the two build artefacts below.
**Depends on:** Phase 5.
**Read-set:** `crates/checkers-wasm/src/lib.rs`, `tools/build-wasm.sh`, `build.mjs`.
**Write-set:** `crates/chess-wasm/**`, `Cargo.toml` members, `Cargo.lock`,
`tools/build-wasm.sh`, `build.mjs`.
**Risks:** binary size — a TT sized for native is too big for wasm memory on a
phone; size it by a constant measured here (checkers' `Table::new()` is the shape)
and record `dist/chess.wasm`'s bytes in the Review Log.
**Done when:** `bash tools/check.sh wasm cargo test -p chess-wasm --release` green;
`bash tools/check.sh build-wasm npm run build:wasm` emits
`target/wasm32-unknown-unknown/release/chess_wasm.wasm` and `node build.mjs` copies
it to `dist/chess.wasm` (**two commands, two artefacts** — Pass 3 corrected "`npm run
build:wasm` emits `dist/chess.wasm`", which no command does: `build-wasm.sh` writes
`target/`, `build.mjs:165-167` copies to `dist/`); `bash tools/check.sh rust npm run
test:rust` green.
**Validation:** Narrow — with the three sizes recorded; a binding that loads
natively and not on a phone is Phase 13's to find, and it will have the numbers.

### Phase 8: The typed `Chess` wrapper + the verifiable outcome

**Goal:** A TypeScript surface the page and the rig share.

**Changes:**
- [x] `src/games/chess/chess-wasm.ts` — `Chess` class over the exports
  (`newGame`, `board`, `legalMoves`, `play`, `liveMove(level)`, `assess`,
  `coach`, `tutor`, `fen`, `san`, `currentHash`, `renderText`, `outcome`);
  `Level` union `"Easy" | "Medium" | "Hard" | "Expert"`.
- [x] `src/games/chess/chess-outcome.ts` — `verifyRecord` replaying `(seed,
  moves)` through the wasm; the `?r=` share format; the human-facing label from
  the A-centric result.
- [x] `tests/chess-unit.test.ts` (vitest over the real wasm, the checkers shim —
  `readFile("target/wasm32-unknown-unknown/release/chess_wasm.wasm")` behind a
  `globalThis.fetch` override, `tests/checkers-unit.test.ts:19-31`; `preunit`
  builds it, which is why Phase 7's `build-wasm.sh` entry is a precondition):
  play a game, replay it, tamper it.

- [x] **The edges (Pass 3 — mutation resistance).** `verifyRecord`: a recorded game
  verifies; one move altered fails; the list truncated by one fails (a different
  hash, not a crash); a move appended after the terminal fails; a code above
  `MAX_MOVE_CODE` fails without throwing. The `Level` union maps to `0..3` at all four
  values. `liveMove` on a terminal game returns `null` (the `MOVE_OVER` sentinel
  mapped — `docs/HARNESS.md`'s "trap that cost a day" is a `null` read as a move).

**Call chain:** `chess.ts (Phase 9) → Chess → wasm`.
**Wiring test:** `tests/chess-unit.test.ts` — a recorded game verifies and a
tampered one does not, through `verifyRecord`.
**Depends on:** Phase 7.
**Read-set:** `src/games/checkers/{checkers-wasm,checkers-outcome}.ts`,
`tests/checkers-unit.test.ts`.
**Write-set:** `src/games/chess/{chess-wasm,chess-outcome}.ts`,
`tests/chess-unit.test.ts`.
**Done when:** `bash tools/check.sh unit npm run unit -- chess` green (`vitest run
chess` — the filename filter picks up `chess-unit`; read the log for the file name
so a filter that matched nothing is not a green); `npm run typecheck && npm run
lint` clean.
**Validation:** Narrow.

### Phase 9: Playable `/chess/` — the frame, the board, the taps

**Goal:** A person can play a full game against The Engine on a phone.

**Changes:**
- [x] `src/games/chess/chess.ts` — `chessModule` + `chessSetup` (rows: *Play as*
  White / Black / Random; *Difficulty*); `GameFrameSpec` with two seats (You / The
  Engine, glyph by colour, `score` = captured material, **`state`** = `"active"` /
  `"thinking"` / `"idle"` per `SeatMeter`, **`sub`** = the text: "your move" ·
  "check!" · "Nf3+" from `board().lastSan`), verbs Undo · Hint · New game…; `mode`
  chip = level; `snapshot()` / `resume()` (seed + moves + human side + level;
  `summary.line` like "Move 14 · you're up a knight"); the `declare global {
  Window.__chess }` E2E hook (checkers' `:50-60` shape) set on mount, deleted on
  unmount.
- [x] `src/settings.ts` — `ChessLevel` / `ChessSide` types, `resolveChessLevel` /
  `resolveChessSide` (pure), `chessLevel()` (default `"Medium"`), `chessSide()`
  (default `"white"`, with `"random"` as a third stored value resolved at New
  game), `chessTutorEnabled()` (default off), keys `fun-chess-{level,side,tutor}`;
  `tests/settings.test.ts` gains the resolver cases (the checkers block at `:69`).
- [x] `tokens.css` — the chess board tokens (`--chs-light`, `--chs-dark`,
  `--chs-a`, `--chs-b` for the piece fills, `--chs-legal`, `--chs-check`,
  `--chs-last`), and `tests/tokens.test.ts` gains their contrast pairs beside the
  `chk-*` rows at `:121-123` (piece on **both** square colours — chess pieces
  stand on light squares too, which checkers' men never do). `styles.css` uses
  only `var()` (the no-raw-hex unit test).
- [x] `tests/chrome.test.ts:192` — insert `"chess"` in the drawer id list at the
  position the registry gives it: the list is **`SHIPPED`'s array order** (shipping
  order; `chrome.ts` reads no `group`), chess's entry is appended after cribbage's
  (`registry.ts:195`), so `"chess"` goes between `"cribbage"` and `"placeholder"`.
  *(Pass 3 corrected Pass 2's "after `"checkers"`".)*
- [x] `src/music.ts` `BY_GAME` — name a track for chess from the shelf library
  (optional; unnamed falls back to `SHELF_TRACK`). See Open Questions.
- [x] The board: an 8×8 CSS grid in the stage, oriented to the human (D5's pieces
  as SVG or glyphs, coloured by tokens); tap a piece → the core's legal
  destinations glow; tap a destination → `play`; a promotion destination opens
  the **picker** (four pieces, ≥ 44px each, absolutely positioned over the stage,
  Escape/scrim cancels); last move ringed; the checked king marked; The Engine's
  move shown with a beat; on a decisive end the mating move shown with fanfare
  before the result screen. Files and ranks labelled at the edges (a11y: each
  square is a button with an `aria-label` like "e4, white knight").
- [x] Keyboard: arrows move a focus ring over the squares, Enter/Space taps
  (checkers' pattern).
- [x] Undo takes back a pair of plies (yours and The Engine's) and marks
  assistance; Hint asks `coach_json` and rings the suggestion (marks assistance);
  hints-off → "I'm stuck" ends + reports, per §6.
- [x] `src/registry.ts` entry in `SHIPPED` (`id: "chess"`, `group: "versus"`,
  `status: "playable"`, `emoji: "♞"`, `icon: true`, `pitch`, `setup: chessSetup`,
  `load: chessModule`); `src/games/chess/assets/{icon,splash}.jpg` —
  `tests/art.test.ts` asserts `icon: true` ⇔ the file exists, both directions, so
  the flag and the JPEG land in the same commit.
- [x] `tests/chess.spec.ts` — the browser suite: a full game against Easy to a
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
- [x] **RED first, and the edges (Pass 3).** The pure functions get their tests
  before they exist: `viewSquare(sq, flipped)` — unflipped is the identity at 0 and
  63; flipped maps 0 ↔ 63 and 7 ↔ 56; flipping twice is the identity for all 64
  squares. `resolveChessLevel` / `resolveChessSide` — a stored valid value, `null`,
  and garbage (`settings.test.ts:69-85`'s three cases), and `"random"` is a storable
  side that resolves to `"white"` or `"black"` at New game and is never written back
  as the seat. The browser suite names its branches: the promotion picker plays each
  of the four pieces (four codes, one `from`/`to`), and Escape / the scrim cancels
  with the pawn still on its square and the turn unchanged; an illegal tap changes
  nothing (the checklist's "illegal tap = no change" as an assertion on the hash);
  Undo at move 0 is a no-op, after the engine's reply takes back two plies, and is
  disabled while the engine's seat is `thinking`; the checked king is marked when
  `in_check` and not otherwise.
- [x] **The debugging seams, declared (Pass 3).** `window.__chess` (`game`,
  `refresh`, `seed`); `?seed=` to reproduce a game and `?fast=1` to collapse the
  beats; the stability delta before/after in the Review Log. A Phase 13 report of
  "it did X on the Pixel" reproduces from a seed and a move list, or it is not a
  report.
- [x] `docs/BUILDING-GAMES.md:414` — the one sentence for a **new** game (the
  stability spec is made red by mounting the turn text in flow first; the delta is
  recorded; then it moves into the seat) — written in this phase from this phase's
  measurement *(Pass 3: moved from Phase 14)*.

**Call chain:** `main.ts → registry → chessModule.mount → frame.update(spec) →
Chess (wasm)`.
**Wiring test:** `tests/chess.spec.ts` "plays a game to the result screen and the
share re-verifies" — through the real page, both engines.
**Depends on:** Phase 8; Phase 0 D5.
**Read-set:** `src/games/checkers/checkers.ts` (1,018 lines — the versus archetype
with a multi-tap move), `src/games/othello/othello.ts` (the worked frame example),
`docs/BUILDING-GAMES.md` §4c, `docs/RESPONSIVE-DESIGN.md`.
**Write-set:** `src/games/chess/chess.ts` *(Pass 3 removed the `chess-howto` stub:
`tests/how-to.test.ts` iterates `GUIDES` only, so a game without a guide is not red
anywhere, and "No stubs, ever" — the guide is Phase 12's, whole)*,
`src/games/chess/assets/**`, `src/registry.ts`, `src/settings.ts`, `src/music.ts`,
`tokens.css`, `styles.css` (a chess block), `tests/chess.spec.ts`,
`tests/chrome.test.ts`, `tests/settings.test.ts`, `tests/tokens.test.ts`,
`tests/chess-view.test.ts` (the `viewSquare` unit test), `docs/BUILDING-GAMES.md`
(one sentence at `:414`).
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
   both engines; `bash tools/check.sh a11y npx playwright test tests/a11y-matrix.spec.ts`
   (the auto-enrolment is only proven by running it — read the log for the `chess`
   rows); `bash tools/check.sh unit npm run unit` in full (chrome, settings, tokens,
   art and the `viewSquare` test are all shared-suite edits); `npm run typecheck &&
   npm run lint`. `npm run smoke` is the human's quick check, not the gate.
**Validation:** Moderate — the spec plus playing it in a browser by hand.

### Phase 10: The tutor panel + the experimental hybrid opponent

**Goal:** Coaching without a model; a persona behind the WebGPU gate.

**Changes:**
- [x] The tutor panel (opt-in preference, off by default): "Explain my options"
  lists the band in SAN with `ideaFor` ("takes the knight", "gives check",
  "promotes", "castles", "mate in 2" when exact); blunder flag and hint reasons
  bound to `exact`; reading state painted **before** the deep call.
- [x] `ideaFor` set in **both** `chess.ts` and `chess-oracle.ts` (Phase 11) so the
  UI and the rig say the same thing.
- [x] The hybrid opponent: the WebGPU probe + "Experimental: local AI opponent"
  toggle + download disclosure, reusing `hybrid-player.ts` / `ai-runtime.ts` /
  `banter.ts` **unchanged**; persona per Open Questions; canned lines; falls
  back to The Engine on any failure.
- [x] `tests/chess-tutor.test.ts` — `coachFor` both branches;
  `tests/chess-hybrid.test.ts` — `MockRuntime` proves the plug-in on CI (an
  out-of-band pick falls back; a malformed reply falls back).
- [x] **The edges (Pass 3 — mutation resistance).** `coachFor` three branches
  (threw / hedge / silent — the third is what checkers tests and Pass 1 omitted).
  `ideaFor` one case per idea: a capture names the piece taken; a check says so; a
  promotion; a castle; "mate in N" **only** when `exact`, and a quiet move's plain
  fallback. The hybrid: an in-band reply → `source: "llm"`; out-of-band → fallback; a
  malformed reply → fallback; **a reply naming a legal move that is not in the band →
  fallback** (legal is not offered — the edge a "just check legality" mutation
  survives); the toggle is absent when the WebGPU probe reports a fallback adapter.
  The reading state is painted **synchronously** before `tutor()` resolves (a test
  that reads the DOM before awaiting). The canned banter lines all survive
  `banter.ts`'s filter — asserted in a unit test, every line, since a filtered line
  is silent in production.
- [x] **What the real run records (Pass 3 — observability).** The Report already
  counts `llmMoves` / `fallbackMoves` and prints the fallback rate
  (`tournament.ts:95-100`), so the `AI_TRIAL_MODE=hybrid npm run ai:trial` run goes
  in the Review Log with those two numbers, the model id, and the adapter string —
  the checkers plan's "source is computed and discarded" flag is closed by the rig,
  and the numbers are what close it for chess.

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
**Done when:** `bash tools/check.sh tutor npm run unit -- chess-tutor chess-hybrid`
green with both file names in the log *(Pass 3: the phase had no verification
command)*; `npm run typecheck && npm run lint`; a real WebGPU run
(`AI_TRIAL_MODE=hybrid npm run ai:trial`) recorded in the Review Log as
validated-not-gated, with its `llmMoves` / `fallbackMoves`.
**Validation:** Moderate.

### Phase 11: Chess meets the harness

**Goal:** "The Engine never blunders" as a number.

**Changes:**
- [x] `src/games/chess/chess-oracle.ts` — the pass-through adapter (nine members;
  level `0..3` → `Level`); `idea` on tutor moves.
- [x] `src/harness/harness-trial-entry.ts` — `"chess"` added to the `TrialGame`
  union (`:26`; `GAMES` is `Record<TrialGame, …>`, so the union is the type
  error that forces the entry) and `GAMES.chess` with a prompt that describes
  chess and the UCI move form.
- [x] `tests/chess-harness.test.ts` — self-play tournament over the real wasm with
  the three non-vacuity assertions (`blunders === 0`, `scoredMoves > 0`,
  `abortedGames === 0`).
- [x] `tests/baselines.test.ts` `ANCHORS.chess` — the Report recorded with the date.
- [x] `docs/HARNESS.md` — the adapter list, the "ten members" → nine correction,
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
**Done when:** `bash tools/check.sh harness npm run unit -- chess-harness` green
with all three assertions present in the file (a test with `blunders === 0` alone
grades a vacuous run green — `checkers-harness.test.ts:92-96` is the shape);
`bash tools/check.sh baselines npm run baselines` reproduces `ANCHORS.chess`
number for number; `HARNESS_TRIAL_GAME=chess npm run harness:trial` prints a Report
(validated, not gated — it needs a GPU); `git diff --stat origin/main --
src/harness/match-runner.ts src/harness/scorer.ts src/harness/tournament.ts` prints
**nothing** (the Problem Statement's constraint, read as output rather than
asserted from memory). *(Pass 3: every command through `check.sh`, and `scoredMoves`
read from the Report — a 0 is the finding the Risk names.)*
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
  `chess-promotion`, `chess-result`); the sync tests — **`tests/how-to.test.ts`**
  ("every screenshot it references exists on disk", `:37-45`) is the one that goes
  RED by construction the moment the guide names three shots that do not exist yet,
  and `tests/how-to.spec.ts` is the page that renders them *(Pass 3 named the
  files)*.

**Wiring test:** `tests/how-to.test.ts` RED on registration → `npm run guide:shots`
→ GREEN, and `tests/how-to.spec.ts` rendering the chess guide through `/how-to/`.
**Depends on:** Phase 9.
**Write-set:** `src/games/chess/chess-howto.ts`, `src/how-to-registry.ts`,
`tools/guide-shots.mjs`, `assets/guide/chess-*.jpg`.
**Risks:** re-encoding other games' JPEGs — `git checkout --` the rest after
`guide:shots` (CLAUDE.md), after checking `git status --porcelain` shows only
JPEGs.
**Done when:** `bash tools/check.sh shots npm run guide:shots` green; `git status
--porcelain assets/guide` read in full and only `chess-*.jpg` kept (the rest `git
checkout --` per CLAUDE.md — *after* the porcelain read, never before); `bash
tools/check.sh howto npm run unit -- how-to` green; `bash tools/check.sh howto-e2e
npx playwright test tests/how-to.spec.ts` green.
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
  glyphs/SVG in both themes; Expert's move latency felt **and timed with
  `spike/chess-latency/`** against Phase 4's table (the same harness, so the two
  columns are comparable — Pass 3); the share link opened cold. Each finding is
  recorded with the phone, the seed and the move list — the `__chess` /`?seed=`
  seams are what make a phone report reproducible on a laptop.
- [ ] Edit each `[device: …]` line in this plan to `[device done 2026-MM-DD: …]`.

**Depends on:** Phases 9–12.
**Shared-state contract:** the two claim files; released at phase end.
**Done when:** every `[device:` tag in this plan reads `[device done`.
**Validation:** Broad — the phones are the validation.

### Phase 14: Docs, changelog, gate, land

**Goal:** Record what landed, and land it.

**Changes:**
- [ ] Everything in Documentation Impact still scheduled here after Pass 3's moves:
  `TODO/README.md` (the entry's move to Shipped — its stale sentence went in Phase
  1), `TODO/chess.md` (new), the one-line pointer in
  `plans/2026-07-31-drop4-ai-harness.md`, `docs/AI-PLAYERS.md` (the generality
  paragraph — `:711` went in Phase 5), `docs/BUILDING-GAMES.md` §10 (roster, the
  honesty line, the new Variation block — `:414` went in Phase 9), `CLAUDE.md`,
  `README.md`, `CHANGELOG.md` (contexts + the entry under `[Unreleased]`, per
  `CroftC/.claude/CHANGELOGS.md`). *(Pass 3: what remains is record-what-landed —
  the roster, the inventory, the shipped status — which cannot be written before it
  lands; every claim this plan makes **false** earlier is fixed in the phase that
  breaks it, the checkers plan's Phase 17 reading of the "trailing docs phase"
  rule. `TODO/drop4.md` is no longer here.)*
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

**Wiring test:** the closing grep sweep (Documentation Impact) —
`grep -rn -i chess TODO CLAUDE.md README.md plans/*.md docs/*.md` — **read in full,
every hit classified** (this plan's own lines; historical done-records that stay
true; a stale claim, which is a miss to fix), never counted. Plus the shared-code
constraint from the Problem Statement as output: `git diff --stat origin/main --
crates/adversary-core crates/adversary-solver src/harness/match-runner.ts
src/harness/scorer.ts src/harness/tournament.ts src/game-frame.ts` prints nothing.
**Depends on:** Phase 13.
**Done when:** `bash tools/check.sh gate npm run gate` green locally; on CI the jobs
`deploy` needs — **`build`, `rust`, `e2e`** (the `e2e` matrix `needs: [wasm]`;
`deploy.yml:294-296` — Pass 3 named them in place of "all three") — green on the PR;
PR open; `workspace-audit.sh` clean.
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

### Phase 11 execution — 2026-08-30

**Green:** `bash tools/check.sh green npx vitest run chess-harness chess-tutor
chess-hybrid` — **18 passed**, `chess-harness` 5 of them: the 15-bit codes
through the port untruncated (every opening code > 255), `liveMove` null only
at a terminal, the self-play tournament with all three non-vacuity assertions
(`blunders === 0`, `scoredMoves > 0`, `abortedGames === 0`), a capture
reaching the band as "takes the <piece>" over the real wasm, and
`page.ideaFor === oracle.ideaFor` — one definition, two importers. RED was
watched: the file failed to resolve `chess-oracle.js` before the adapter
existed. `git diff --stat origin/main -- src/harness/match-runner.ts
src/harness/scorer.ts src/harness/tournament.ts` printed **nothing** (read as
output, `wc -l` = 0). Typecheck and lint clean.

**The anchor:** `HARNESS_BASELINES=1 vitest run tests/baselines.test.ts -t
chess` first ran against a zeroed placeholder and reported the real numbers
(RED), then reproduced them exactly on the second run (GREEN, 174 s):
`Engine(3) vs Engine(3)` · games 2 (0 aborted) · W-D-L **1-0-1** · graded
**6** (skipped 163) · optimal 5 · **preserving 1** · blunders 0 · cost 28.8 s.
`scoredMoves` = 6 is the Risk's number read from the Report — not 0, and the
thinnest fraction on the shelf (checkers' 9/163 is the nearest); the
`preserving 1` is the grader (d6 / 600k) outranking the Expert it grades
(d5 / 150k), recorded next to the numbers.

**The real WebGPU run (validated, not gated)** —
`HARNESS_TRIAL_GAME=chess npm run harness:trial`, system Chrome, adapter
`apple/metal-3`, model `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` (266 MB fetched
once into `.webllm-cache`), 2 games: `Hybrid vs Engine(3)` · W-D-L 0-0-2 ·
graded 3 (skipped 49) · optimal 1 · preserving 2 · blunders 0 · **chosen by
model 52 · by engine fallback 0** (runtime 0 · malformed 0 · out-of-band 0 ·
rescued by retry 0) · hybrid latency median 1192 ms, mean 1341 ms, worst
9861 ms · PASS. These are the `llmMoves` / `fallbackMoves` Phase 10 asked
for; `docs/HARNESS.md`'s side-by-side table carries the row with its date.

**What landed:** `chess-oracle.ts` (a pure pass-through like checkers', with
`ideaFor` and `KIND_NAMES` moved INTO it — `chess.ts` imports and re-exports
`ideaFor`, so the tutor panel and the band cannot drift; the checkers plan's
"phrased in both places" became one place); `harness-trial-entry.ts` gained
`"chess"` in `TrialGame` and `GAMES.chess` with a prompt naming the game and
the opaque-code form; `tests/baselines.test.ts` `ANCHORS` chess entry;
`docs/HARNESS.md` — the port is **nine** members (the doc said ten in two
places since P8; counted and corrected), chess in the adapter and wire-code
lists, the trial command, the engine-vs-engine block, the reading note on the
thin fraction and the first `preserving`, and the hybrid row.

**Cost worth recording:** the CI tournament test (Engine(1) v Engine(1), 2
games) runs **74 s** in `npm run unit`; checkers' is the precedent and its
range is similar. If the unit gate's wall-clock becomes the complaint, this
test and checkers' are the two to look at first.

### Phase 10 execution — 2026-08-30

**Green:** `bash tools/check.sh tutor npm run unit -- chess-tutor chess-hybrid`
— **13 passed** with both file names in the log (`chess-tutor` 9: `coachFor`'s
three branches threw / hedge / silent, `ideaFor` one case per idea with "mate
in N" only when `exact`, every canned line through `acceptBanter`, the view
over the real wasm; `chess-hybrid` 4: in-band → `llm`, malformed → fallback,
**a legal move outside the band → fallback**, and the wiring test through
`chessModule` with `MockRuntime` landing the model's pick on the board).
`tests/chess.spec.ts` **38 passed** (19 × chromium + mobile-webkit): the
tutor panel absent by default and appearing through the settings sheet's
toggle, "Explain my options" listing ≥2 moves each `SAN — idea` with the
"not yet certain" hedge, the local-AI toggle absent under a null adapter and
present (with the download disclosure) under a real one. Typecheck and lint
clean (`check.sh` exit 0 each).

**What landed:** in `chess.ts` — the tutor panel behind `chessTutorEnabled`
(reading state painted synchronously, then `Chess.tutor()` at the tutor
budget, the band built with `ideaFor(m, report.depth)`), the coach line after
the human's move bound to `exact` (`coachFor`), the WebGPU probe → the
"Experimental: local AI opponent" setting row with the download hint, the
hybrid opponent through `HybridPlayer`/`WebLLMRuntime`/`banter.ts`
**unchanged** (`git diff --stat src/harness/` empty), persona **Ash 🌳**,
the canned lines, fallback to The Engine on any failure with
`window.__chess.lastAi` recording the source; `settings.ts` gained
`chessTutorEnabled`/`setChessTutor` on the shared boolean helpers. The
browser tests copy the shelf's mechanics rather than the storage format: the
tutor is enabled through the sheet toggle (the first draft set
`localStorage["fun-chess-tutor"]="true"` and got nothing — the helpers store
`"on"`/`"off"`), and Settings is a sheet only at the phone viewport, so the
spec resizes before pressing the verb.

**The real WebGPU run — not run here, and why:** `npm run ai:trial` is the
Drop 4 page driver (`tools/ai-trial.mjs` goes to `/drop4/` and clicks
`.drop4-ai-toggle-input`; it takes no game). The game-parameterised runner is
`HARNESS_TRIAL_GAME=<game> npm run harness:trial`, which needs Phase 11's
adapter — so the `llmMoves` / `fallbackMoves` / model / adapter record this
phase asked for is produced in Phase 11's entry (still validated-not-gated),
and `docs/HARNESS.md`'s chess row is written from that.

**One typing note for the record:** annotating a cached wasm buffer as
`Buffer | null` widens it to `Buffer<ArrayBufferLike>`, which `BodyInit`
refuses; `Buffer<ArrayBuffer> | null` is what `readFile` actually returns.

### Phase 9 execution — 2026-08-30

**Green:** `tests/chess.spec.ts` **30 passed** (15 tests × chromium +
mobile-webkit, 8.6 s) — the full game to a result screen whose `?r=` share
re-verifies, castling by the king's two-square tap, en passant offered and
taken, a promotion through the picker (all four pieces reachable, Escape
cancels with the hash unchanged), the checked king marked, Undo disabled at
move 0 and taking back a pair, playing Black flipping the board, axe clean in
both themes, 44px squares at 390px with no horizontal overflow, the
stability sampler across the engine's reply, Continue from the bare URL.
`tests/a11y-matrix.spec.ts` picked chess up from the registry with no edit
(its `chess: poster and entry state are clean under every skin` row read in
the log). `npm run unit` in full: **831 passed** (chrome, settings, tokens,
art and the new `chess-view` suite among them); typecheck and lint clean.

**The RED-first stability step, measured:** the first mount put the turn
text in flow above the board as the plan prescribed — and the sampler
reported it **stable (< 1px)** across the engine's reply, because the line's
text is never empty mid-game (it collapses only at the end, where the whole
container is replaced anyway). So the movement the rule guards against did
not occur for this shape; the text moved into the seats' `sub` regardless,
per the frame's own rule ("thinking is a seat state, not a line of text"),
and the sampler stayed green. `docs/BUILDING-GAMES.md:414` gained the
new-game sentence; this is its recorded number: 0.

**Two real bugs the browser suite caught in the first run:** cancelling the
promotion picker left the pawn *selected*, so the next tap on it deselected
instead of re-picking (fixed: cancel puts the piece down); and the
last-move ring token `#2c5f2e` read 2.40:1 on dark squares under the tokens
test (darkened to `#1f3f21`).

**What landed:** `chess.ts` (the versus archetype: seats with captured
material, `sub` = "your move" / "check!" / the last SAN, verbs Undo · Hint
(when hints are on) · New game…, `viewSquare` as the one geometry, the
picker as an absolutely positioned overlay with a first-button focus and
Escape/scrim cancel, arrow-key navigation over the view grid, edge labels
riding on the squares so a flipped board labels itself, `snapshot`/`resume`,
the `window.__chess` hook); the settings block with `"random"` as a stored
side resolved to a seat at New game; the `chs-*` tokens with ten pinned
contrast pairs (pieces read on BOTH square colours — a white piece by its
outline, a black by its fill); the styles block; the registry entry with the
owner's art; music, chrome-ids and the shared tests.

**Pieces are Unicode glyphs for now** (the filled shapes for both sides,
CSS-coloured with an outline) — D5's device answer is still owed; the swap
to an SVG set, if the phones say so, is one function (`pieceNode`).
[device: android x2] — the tap flow, the picker at 44px, the glyphs.

### Phase 8 execution — 2026-08-30

**Green:** `npm run unit -- chess-unit` — `tests/chess-unit.test.ts` **6
passed** over the real `chess_wasm.wasm` through the fetch shim (the file
name read from the log, per the phase's rule); `npm run typecheck` and
`npm run lint` clean. The worktree gained its `node_modules` here (`npm ci`,
219 packages on the pinned Node 22) — Phases 9+ need vitest and Playwright.

**What landed:** `src/games/chess/chess-wasm.ts` — the `Chess` class over
the exports (`fen`, `san(code)`, `legalMoveDetails` with `from`/`to`/`promo`
unpacked, `oracleMoveValues` → `{moves, depth, nodes}`, the tutor reports
with `depth`/`nodes`, the `LEVEL_CODE` map 0..3 exported for the rig, the
unsigned coercion on the `MOVE_OVER` sentinel); `chess-outcome.ts` —
`verifyRecord` counting applied moves so a move the core refuses (a tamper,
or one appended after the terminal — chess's replay poisons rather than
skips) fails without throwing, plus `resultLabel` from the human's seat.

**The edges pinned:** the opening's twenty moves unpacked with `code == from
| to << 6`; the FEN fields on `board()`; `lastSan` null → `"e4"` and the ep
square after it; a whole game replaying to its hash and **four tampers each
failing for its own reason** (altered, truncated, padded after the terminal,
a code above `MAX_MOVE_CODE` without a throw); the share payload
round-tripping as plain numbers; `liveMove`/`oracleBest` null at a terminal;
the level union at all four values.

### Phase 7 execution — 2026-08-30

**Green:** `cargo test -p chess-wasm` 5 debug (8.8 s — the coach/oracle
searches) and 6 release (31 s, the agreement test dominating — checkers'
shape); `npm run build:wasm` emits the artefact and `node build.mjs` copies
it to `dist/chess.wasm` (two commands, two artefacts, as Pass 3 corrected);
`npm run test:rust` green after two lints in the *solver's test code* from the
audit rounds surfaced (per-crate runs had never run clippy on test targets)
and one `struct_excessive_bools` on the wire-shaped `AssessView`, allowed with
its reason like the solver's.

**The three sizes (Pass 3's observability rule):** `dist/chess.wasm` =
**205,347 bytes**; declared memory **17 pages = 1.06 MiB initial, no
maximum** (parsed from the binary's memory section); the transposition table
has **no fixed size constant** — it is a `HashMap` bounded by the search
budget (Expert's 150k nodes → at most ~150k entries per move, freed with the
table each call), which is the number a "does not load on the Pixel" would be
read against.

**What the binding adds beyond checkers' surface:** `fen()`; `san_json(code)`
for a move not yet played (the Hint ring); `board_json` with the 64 cells,
castling bits, ep square, both clocks, `inCheck`, `lastMove` + **`lastSan`**
(computed at `play` time from the pre-move position), `captured` material
points per side, the unpacked `legal` list and `result`; `legal_moves_json`
as `{code, from, to, promo}` objects (a promotion square = four entries);
`oracle_move_values_json` and the tutor reports carrying **`depth` and
`nodes`** (Phase 4's rule — chess is the first shelf binding to report them).
Pinned by tests: the committed threefold vector replayed through `play()` to
its recorded hash; every export's terminal value enumerated; `play`'s three
return values from their own inputs; `lastSan` null → `"e4"`; `inCheck`
across `Qxf7+`; the promotion square as four entries and the queen's code
round-tripping to `e8=Q+`; `depth ≤ level.depth()` on both reports.

### Phase 6 execution — 2026-08-30

**Every round committed green first; every restore after `git status
--porcelain` on the exact files; the whole logs read at their summary lines.**

**chess-core — 674 mutants.** Round 1: 577 caught, 5 timeouts (kills), 32
unviable, **60 missed** (18 min). Triage found ~36 real gaps in exactly the
shapes CLAUDE.md predicts and closed them with 14 tests (Phase 6 (part)
commit): `move_to_text` had **no test caller at all**; SAN's pawn push, quiet
king/bishop letters and the N/B/R promotion suffixes were untested; the
queenside castling-rights causes (a1 rook move, a8 capture) were untested
against the kingside pair; `perft(0)` and `divide` only ran inside a failing
perft's message; the fullmove counter was never asserted after a move; the
Zobrist fold's operation and table order were unpinned (now xor relations
against RULES §15); the history-cap boundary walk the plan demanded was owed
(100 reversible plies — a `<=` in `push_key` panics there); the white-capturer
en-passant arm and the uncapturable-ep-does-not-count direction of 9.2.3.1
had no fixture; the end-of-rank `RankSum` site; kings may not stand
adjacent. **Also found:** the OppositeCheck malformed case from Phase 4 had
silently no-oped against the fmt'd file (python `replace` without assert —
the recurring trap of this session; every later patch asserts its anchor).
Round 2: **614 caught, 23 missed** — the closing tests killed all 37 they
targeted. **The 23 residual are equivalent, by class:** disjoint-bitfield
`|`→`^` (cell_of, `MAX_MOVE_CODE`, `Move::code` ×2, the castling-mask pair);
symmetric delta tables `+`→`-` (knight/king offsets in `attacked` and
`leaper_moves` ×6 — negating a symmetric set is the set); the mod-8 parity
identity in `insufficient_material`; the redundant ep-file clause in
`apply_move` ×4 (the ep square is only ever reached diagonally by a pawn —
a documented defensive redundancy) and the mirrored `ep_capturable` `df`
loop; castle-direction `>`→`>=` twice (never equal); the king-count index
swap (`[1, 1]` is symmetric); the bulk-count `perft` arm (identical value).

**chess-solver — 422 mutants.** Round 1: **98 caught, 302 missed.** The
cause was structural: cargo mutants builds debug and nearly every
search-exercising test was release-gated, so the whole search and the PST
data were unobserved — the plan's named blind spot ("cribbage's crib-table
generator had 30 such survivors"), at full scale; ~170 of the misses were
single-sign deletions in the tables. The remedy the repo prescribes —
debug-affordable tests that reach the code — landed in three commits:
PST file-symmetry and taper endpoints; the nudge's sign through
`heuristic()`; the node-counting contract (40 at depth 1); the table's
`len`/`is_empty`/`nodes`; mate = `MATE` + remaining depth and still exact at
depth 3; a small-board minimax cross-check; `class_of`'s boundary pair; a live
choice at Easy; the black mate-in-one arm; ep-capture and regret facts;
quiescence with a promotion, an en-passant capture and a two-ply chain at the
horizon; a proven draw is not seized by the always-take-a-mate rule; a
full-width quiescence reference on capture-rich boards; `Table::hits()` (the
answer policy is invisible to a result comparison — hits are its only honest
evidence) asserted at depth 4 on small boards and in a release-gated midgame
twin. Round 2: 310 caught, 88 missed. Round 3: **329 caught, 69 missed.**
Then five hand-applied mutations (the plan's rule) each watched RED against
their new test and restored: `table_answer → None`, the qsearch child-window
negation, `best_col ==→!=`, the `Bound::Lower` guard `→ true` (release), and
the castles `&&→||` — whose first assertion had ALSO no-oped and passed under
the mutant (left 7, right 1 once it was real).

**Two measured facts from the rounds, worth more than the counts:**
(1) **at depth 3 the transposition table provably reuses nothing** (5962 vs
5962 nodes on a small board) — two move orders meet only at four plies, so
the strict-depth policy's savings and its bound guards are exercised from
depth 4 up, which is where the tests now sit; (2) **`terminal_value`'s
"mover won" branch was unreachable** (a terminal is always a loss for the
side to move) — removed, not tested around.

**The solver's residual, by class:** move ordering (20 — a speed device; the
audit itself proves "ordering never changes a result"); conservative
path-dependence flags (7 — more entries marked path-dependent means fewer
stores, never a wrong value; the one dangerous direction, `→ false`, was
caught by the leak test); prune-only and tie-break comparators (10); the
redundant ep file clause (4, as in the core); `INFINITY`'s `+`→`*` (a larger
bound is a bound); `Table::disabled → Default` (identical struct); a boundary
value no score can take; and the bound-guard `false` variants, which only
decline to answer. None changes a result; each is named so the next audit
does not re-derive it.

**Gate:** every round's restore was followed by the full crate suites; the
whole-workspace `npm run test:rust` runs at Phase 7's gate on this tree.

### Phase 5 execution — 2026-08-30

**Green:** chess-solver 30/30 release (6.7 s), 17 debug (0.28 s); the gate
(`npm run test:rust`) green. The wiring test
(`expert_vs_easy_self_play_terminates_and_expert_wins_most`, two full games
through `choose` over the real `Adversary` loop) runs on the release gate.

**The strength counts, measured (this M-series Mac, release, seeds 0..20):**
**Expert v Easy 20/20 wins, 0 draws** (bar ≥ 15) · **Easy v a seeded-random
player 14/20 wins, 5 draws, 1 loss** (bar ≥ 14 — met exactly). Recorded per
the phase's rule: a future miss is a finding about the level table, not a
flaky test to loosen. Easy's knobs as shipped: depth 2, 10k nodes, no class
floor, 60% sloppiness — whether that is *fun* is `TODO/chess.md`'s question,
as cribbage left it.

**The level table** (from Phase 4's measured ladder): Easy d2/10k · Medium
d3/40k · Hard d4/100k · Expert d5/150k; Hard/Expert class-preserving; Expert
sloppiness 0 (RNG untouched — pinned). `class_of` is checkers' magnitude
shape over `MATE/2`. **A proven mate is taken at every level** — Easy may be
sloppy between mates, but declining a visible mate reads as broken, not easy;
pinned by the immediate-mate test at Easy across 50 draws.

**The tutor:** `assess` (d6, 600k budget) / `assess_for_move` (Hard's d4/100k,
the tap path) with the compile-time depth orderings; `TutorMove` carries the
shared wire shape (`col`, `value`, `quality`, `exact`, the two booleans) plus
chess's own facts (san, gives_check, captures-as-piece-kind, promotes,
castles) and the report carries `depth`/`nodes` for Phase 7's JSON.
`coach_line` bound to `exact` with the three branches pinned ("threw the
game" only on a two-proof Blunder; "looks risky" on a big unproven regret;
silence otherwise). Blunder-needs-both-proofs pinned at the seam at every
combination, checkers' shape.

**Debug-suite discipline:** six search-heavy tests are release-gated
(`cfg_attr(debug_assertions, ignore)`) so the debug run stays 0.28 s; the
40-game strength counts are `#[ignore]` on-demand (run once above, numbers
here), matching the shelf's opt-in-baselines precedent.

**Docs in this commit (the Pass 3 rule):** `docs/AI-PLAYERS.md` — the Oracle
paragraph now names three unsolved-game precedents with chess's two soundness
refinements, and the deepening table gains the chess column (the first
verdict that differs by depth).

**Clippy note:** `TutorMove`'s five booleans tripped
`struct_excessive_bools`; allowed with the justification comment — the
booleans are the shared wire contract, not a state machine in disguise.

### Phase 4 execution — 2026-08-30

**Green:** chess-solver 17/17 release (3.2 s after the tuning below), 11 debug
(0.35 s — the one debug run with overflow checks on, closing
`TODO/README.md`'s window-sentinel thread for this crate: chess opens its
window at `±(MATE + 512)`, well inside `i32`); chess-core 39/39 after the
phase's one core change; the full gate (`npm run test:rust`) green.

**The deepen verdict, measured (this M-series Mac, native, 50 positions,
unlimited budget):** deepening COSTS at shallow depth and PAYS at search
depth — nodes deepened/fixed: d2 1.465, d3 1.125, **d4 0.818, d5 0.628**.
Adopted: `search_root` deepens 1..=max under the node budget (one table
across iterations; its strict-depth rule keeps that sound, its best-move
memory is what makes deepening pay). Chess is now the third datapoint beside
Othello (−41%) and checkers (+14%), and the first where the verdict differs
BY DEPTH. Recorded for `docs/AI-PLAYERS.md` at Phase 14.

**The latency ladder (budgets from measurement, not the D2 estimate):**
native (M-series) per level med/p95/worst ms: Easy d2 5/53/137 · Medium d3
38/145/287 · Hard d4 199/525/708 · Expert d5+500k 653/797/875 — over the
bar, so the budgets were cut and re-measured. **Chromium (playwright), the
provisional ladder: Easy d2/10k = 6/15/16 · Medium d3/40k = 40/64/66 ·
Hard d4/100k = 132/159/170 · Expert d5/150k = 204/242/258, 0/50 over
400 ms, ~730k nps.** The Samsung half stays owed [device: android=samsung];
if the phone's Expert p95 exceeds 400 ms the recorded lever is the cap
(150k → 100k), a constant.

**Three performance findings, each measured before believed:**
1. **The mobility term was 2× the whole engine.** `heuristic` calling
   `legal_moves` per side per leaf made the release suite 260 s; dropping it
   (material + tables) halved everything. The eval doc records the lever if
   Phase 5 finds play too flat: a cheaper proxy, never `legal_moves` at
   leaves.
2. **Three generations per node → one.** `result()`, ordering and the
   repetition helper each regenerated; `chess_core::result_given(pos,
   &legal)` (new, with `result()` delegating) lets the search generate once.
   ~25% off Expert.
3. **A guessed optimization made things worse.** Sampling later plies to
   cheapen the minimax cross-check (123 s of the suite) took it to 218 s —
   random play does not shed material. The fix that worked: the sweep at
   depth 2 (same window/table/ordering code paths) plus one fixed
   small-branching endgame at depth 3. Suite: 3.2 s.

**One real bug found by a RED, fixed in the core:** the quiescence test's
first fixture was an ILLEGAL position (the side not to move already in
check), and generation happily offered a king capture — the child board was
kingless and `king_square`'s invariant panicked. `from_fen` now rejects such
positions (`FenError::OppositeCheck`, RULES §2 extended, malformed-case
added). The invariant held; the input validation was the gap.

**API additions beyond the spec, recorded:** `chess_solver` re-exports
`NodeBudget` (its own public API takes one); `SearchReport` carries `depth`
and `nodes` (the observability rule); repetition-derived values are never
TT-stored (`path_dep`), with the leak test proving no entry escapes.

**The keep-as-fixture harness:** `spike/chess-latency/` (positions.txt = the
50 D2 FENs via the Phase 0 spike, native driver + `wasm-time.mjs`); Phase 13
times the phones with it, comparable to the tables above.

### Phase 3 execution — 2026-08-30

**RED watched, then green.** The runner edits landed first (check.mjs's usage
comment, destructure and error string — three places; the chess loop with the
empty-directory guard; run.sh's seventh argument) and the run failed on the
missing export (`chess_in_cap is not a function`) while every existing case
still passed — the wiring failing for exactly the right reason. Then the
export: `chess_replay_hash(seed_lo, seed_hi, len)` over the new
`CHESS_IN: [u16; 512]` (the first buffer wider than a byte, per Pass 2) with
`chess_in_ptr` / `chess_in_cap`, xbuild gaining `chess-core` + `pond-outcome`
deps.

**Green, read by name:** `PASS chess full-game` and `PASS chess threefold`
in the whole check-xbuild log; `cross-build determinism: OK`; the Rust gate
green (clippy sees xbuild's lib.rs).

**One safety note beyond the plan:** chess's replay POISONS on an
inapplicable move (Phase 2's deviation), and the poison string is shorter
than a hash — `write_hash` copies 64 bytes unconditionally, so the export
pads the poison to 64 before writing. The pad can only ever FAIL a
comparison, never fake one. (The pre-existing `write_hash("")` call in the
orchard export has the unpadded shape of this hazard; noted for the shelf,
not changed here.)

### Phase 2 execution — 2026-08-30

**Green:** 36 debug tests (0.33 s) + the release run; the declared gate
(`npm run test:rust`, 1968-line log read at PASS, rustc/clippy 1.97) green.
The wiring test runs: a deterministic 60-ply record replays through
`pond_outcome::verify` and each of the three tampers fails for its own,
distinguishable reason. Vectors `01-full-game.json` / `02-threefold.json`
generated by the in-crate `regenerate_vectors` and re-verified by the
non-ignored replay test — Phase 3's inputs exist.

**Zobrist pinned:** seed `0xC40F_7C55_2026_0830`, `KEYS[0] =
0x76E9_A102_2C52_26D8`, `KEYS[780] = 0x45D0_CCC9_5E0D_7B5B`, recorded in RULES
§15 (new section) beside the generator so the table is regenerable. The
pinned-literal test ran RED first (placeholders), then was pinned from the run.

**One deliberate deviation from precedent, recorded:** `replay` does NOT
silently skip an inapplicable move (checkers/othello do). A skipped move at
the END of a record cannot move the final hash, so a padded record would
verify — Pass 3's "appended after the terminal fails" is unmeetable under
silent-skip. Chess's replay poisons the result (`rejected-move-at-{i}`), which
also names the ply in the verification's `actual` field. The older cores'
records are unaffected; worth considering as a shelf-wide follow-up.

**Two fixture lessons from the RED runs:** the three-queens SAN position had
Qd5 already checking the a8 king (an illegal position — moved the king to a7);
and a zsh no-word-split quirk mangled one pinned literal on the way into the
test (`0x___`), caught immediately by the very test being pinned.

**Also:** `ep_capturable` implements 9.2.3.1 by make-and-check of the specific
capture (pins outlaw it correctly); the D4 fixtures transcribed from the spike
all pass against the real core at the same plies the reference engine gave;
`Position` is the fixed `[Key; 100]` + `len` from the start (the confirmed
open question), `PartialEq` and the hash over the logical history only.

### Phase 1 execution — 2026-08-30

**Green, and the wiring tests are the perfts:** `cargo test -p chess-core --release`
— 20 passed, 0 failed, 1 ignored (the on-demand ~500M-node deep rows), **0.29 s**
against the ≤ 10 s budget; depths 1–3 on all six positions also run un-ignored in
debug (0.33 s). The full declared gate (`npm run test:rust` via `tools/check.sh`,
2073-line log read at the PASS line) is green on the pinned 1.97.1 — fmt, clippy
`-D warnings`, workspace tests including the new crate.

**The differential perft: 200 positions, 0 disagreements** (`chess-search-spike
diffperft`, perft(3) per position, chess-core vs cozy-chess, positions travelling
as FEN — a rejected FEN would have been reported distinctly, and none was).

**What the RED cycles caught, recorded because each is a rule lesson:**
- The FEN malformed-case *test* had the en-passant rank semantics backwards
  (`e6` with White to move is the CORRECT rank — Black just pushed); the code and
  RULES §2 agreed and the test was wrong. Caught by watching the run.
- `from_fen`'s one-king-per-side strictness rejected one of my own edge-test
  FENs (no black king) — the strictness working as designed, on its author.
- Perft depths 1–3 matched the published table on the **first run** of the
  implemented generator; the CI depths then passed unchanged — the edge tests
  (castling bars, rights causes and non-causes, ep timing, promotion ×4, clock
  inputs, pins, defended-piece capture) were all green against the same
  generation the perfts verified.

**Gate friction, recorded:** 8 clippy pedantic errors on the first gate run
(missing `# Panics`/`# Errors` docs, two `too_many_lines`, `naive_bytecount`,
single-char bindings, `doc_markdown`) — fixed by splitting `from_fen`
(`parse_placement` + `parse_castling`, king-count folded into placement) and
`pseudo_legal` (per-piece helpers over shared delta tables), and making
`square_text` panic-free. And the PATH trap fired again mid-phase: a bare
`$TOOLCHAIN/cargo clippy` still resolved Homebrew's cargo-clippy 1.98 (the lint
links betrayed it); the verdict that counts is `npm run test:rust`, which
resolves via rustup — exactly why the phase's Done-when names that command.

**Also this phase:** `TODO/drop4.md` and `TODO/README.md` chess entries updated
to the build-fresh plan (the Pass 3 doc moves); `crates/chess-core/vectors/`
created with its README for Phase 3; the owner supplied splash + icon art
mid-phase — converted to `src/games/chess/assets/{splash,icon}.jpg` (512×512;
572×1024 portrait, cribbage's convention), registry-wired in Phase 9.

**Production `expect()` audit (grep read in full):** three `expect("not
possible: …")` sites with recorded reasons (START_FEN, occupied-cell kind ×2)
plus one `unreachable!` (kingless board) — the discipline's allowed shape;
every other hit is under `#[cfg(test)]`.

### Phase 0 execution — 2026-08-30

**Closed:** D1 (reading, in Pass 1), D2's native + Chromium halves, D3 (deferred
to Phase 4 by design), D4 (all seven fixtures), D6 (in Pass 1). **Owed:** D2's
Samsung timing and D5's two-Android glyph check — no device was attached
(`adb devices` empty); the `[device: …]` tags stay on their task lines and the
workspace device queue picks them up from there.

**D2, measured** (spike `spike/chess-search`, cozy-chess 0.3.4 for move
generation only; 50 positions = 16 opening lines + 9 endgame FENs + 25 seeded
random-play boards; fresh 16 MiB TT per search; native = this M-series Mac,
browser = Playwright Chromium): the full table is in D2's task entry. The
headlines: depth 5 quiescent = 90k/682k/881k nodes (med/p95/worst), 254 ms p95
in Chromium at ~2.6M nps, 0/50 over 400 ms; quiescence multiplies nodes 2.5–3×
at every depth; the re-plan trigger is nowhere near tripping. Provisional Phase
4 ladder: Easy d2 · Medium d3 · Hard d4 · Expert d5 + ~500k `NodeBudget`.
The depth-3 hang probe found **0/50 hangs with quiescence off as well as on** —
a null result of a crude metric (≥ 700cp capture swing), recorded as
non-discriminating rather than as evidence against quiescence; Phase 4's
quiescence-earns-its-cost test therefore needs a **constructed** tactical
position, not a sampled one.

**D4, validated by running** (`chess-search-spike fixtures`, all seven PASS):
the fixture list and the two findings are recorded in D4's task entry. The
plan-level lesson: my first expectations for (a') and (b) were wrong by two
plies — in a shuffle cycle the *earliest-seen* position reaches three
occurrences first — caught because the fixtures were executed against a real
rules engine rather than reasoned about. Phase 2 inherits the corrected plies.

**Two mechanical traps hit and recorded:** bare `rustc` on this machine is
Homebrew 1.98.0 while the pin is 1.97.1, and cargo resolves `rustc` from PATH —
the spike's wasm build failed with E0463 until `RUSTC` was set to the rustup
toolchain's binary (the exact trap `tools/build-wasm.sh` documents; the spike
now carries the same discipline). And cozy-chess castles king-takes-rook
(`e1h1`), which cost one panic in the opening lines before it was recognized as
the library's Chess960-style convention rather than a bad line.

**Dispositions honored:** the spike stays under `spike/chess-search/`
(throwaway, out of the workspace and the gate; `spike/*/target/` is already
git-ignored); the 50-FEN set and the seven fixtures are the keep-as-fixture
artifacts (in the spike's source, transcribed by Phases 2/4); the glyph page
awaits its device run before its promote/throwaway branch is taken.

### Pass 3: Quality Gates — 2026-08-30

**TDD ordering:**
- **Every implementation phase now says which test is written before which code,
  data and constants included.** Phase 1 gets a stated RED order (`RULES.md` → FEN
  round-trip → move code → depth-1..3 perfts → generation → depth-4/5 perfts) and
  boundary pairs for its constants (`MAX_MOVE_CODE` / `+1` at deserialize, `promo` 4 /
  5, square 63 / 64). Phase 2's 781 Zobrist constants get a test before the `const fn`
  (distinct, non-zero, first and last keys as literals in `RULES.md`). Phase 4's PSTs
  (mirror symmetry, centre > rim, `MATE` > material, `phase` at 24 and 0) and Phase 5's
  level table (monotonic, the compile-time depth orderings) are tests before tables.
- **Mutation resistance — eight phases specified single-point assertions on branching
  code; each now names its edges.** Phase 1: each castling bar alone; each cause of a
  lost castling right and the non-causes; ep on the next move and gone after; the
  halfmove clock's three inputs; pins; a defended piece. Phase 2: threefold at the 2nd
  (live) / 3rd (draw); the clock at 99 / 100 and a capture at 99; mate on the 100th;
  the named insufficient-material **non-cases** (K+N+N v K, K+R v K, K+P v K, K+B+N v
  K); the history bound as an invariant; `san_of` and `parse_move` case by case; three
  ways a replay fails. Phase 4: `exact` propagation with one heuristic child (the
  `all`→`any` mutation); mate-in-1 over mate-in-3 in both directions; exhaustion
  returns a whole iteration or nothing and stores nothing after; the clock bucket in
  the TT key; stand-pat. Phase 5: `class_of` at `+1` / `−1` / `+900 → 0`; sloppiness
  0 / 100 / no-floor; an immediate mate at Easy; `coachFor`'s **third** (silent)
  branch. Phase 7: `play`'s three values from three inputs; every terminal sentinel
  enumerated; `lastSan` before / after; the promotion unpack. Phase 8: five ways
  `verifyRecord` fails; `liveMove` → `null` on a terminal. Phase 9: `viewSquare` at
  the corners and as an involution; the resolvers' three cases plus `"random"`; the
  picker's four pieces and its cancel; Undo at 0 / after a reply / while thinking.
  Phase 10: `coachFor` × 3, `ideaFor` per idea, the **legal-but-not-offered** reply,
  the synchronous reading state, every canned line through the banter filter.
- **The three gaps `CLAUDE.md` says the mutation audit finds first are closed in Phase
  2, not found in Phase 6:** the trait-delegation gap (tests call
  `<Position as Adversary>::…`), `render_text` asserted exactly, and no convenience
  API without a test caller (`san_of`, `parse_move`, `from_fen` each have one).
- **Two qualitative claims got numbers:** Phase 5's "Easy beats random but loses to
  Expert" → ≥ 14 / 20 and ≥ 15 / 20 seeded games, recorded, a miss being a finding.
- **Wiring tests:** every phase has one that reaches its entry point except Phase 6
  (an audit adds no chain) — converted as the checkers plan converted its Phase 6:
  not done until the whole-workspace `npm run test:rust` is green on the restored
  tree. Phase 3's wiring test is now RED-first (the seventh argument before the
  export exists). Phase 7's wiring statement no longer claims a command that does not
  exist (see Validation calibration).
- **One stub removed.** Phase 9's write-set carried `chess-howto(stub)`; the spot-check
  of `tests/how-to.test.ts` shows nothing forces it (the suite iterates `GUIDES`
  only), and "No stubs, ever" forbids it. The guide is Phase 12's, whole.

**Observability:**
- **Depth reached and nodes consumed** are returned by Phase 4's `move_scores` and
  carried by Phase 7's `tutor_json` / `oracle_move_values_json` as `depth` / `nodes`
  (additive; no shelf binding reports them today). `docs/AI-PLAYERS.md:319` asks for
  exactly this once deepening is in, and chess is the first solver expected to adopt
  it. A Phase 13 "Expert felt slow" is read against a number the phone produced.
- **Failures name their location:** Phase 1's CI-depth perfts run through `divide` so
  a mismatch prints the per-move split; Phase 2's vector tests print the FEN and ply
  of first divergence on a hash mismatch (the record a Phase 3 wasm disagreement is
  read against); Phase 1's differential perft records the first disagreeing FEN or
  the literal "200 positions, 0 disagreements".
- **Sizes recorded in Phase 7:** the TT constant, the wasm bytes, the declared
  memory — the three numbers a phone load failure would be read against.
- **The hybrid's telemetry exists now.** `Report.llmMoves` / `fallbackMoves` and the
  printed fallback rate (`tournament.ts:95-100`) close the checkers plan's Pass 3
  flag; Phase 10's real run records both counts, the model id and the adapter
  string.
- **Recording discipline extended:** Phase 4's latency table and `deepen` verdict
  carry the machine / browser / phone per number; Phase 6 records the four
  `cargo mutants` counts per crate plus the per-survivor triage, read from the whole
  log file.

**Debugging readiness:**
- **Checkpoint rule made explicit in the Concurrency Map:** one commit per phase,
  subject `chess: phase N — …`, Phase 6 committing before every round — so
  `git log --oneline` names the last green phase and `git diff HEAD` is the phase in
  flight.
- **The latency harness moved out of the shipped crate.** Phase 4's "scratch export,
  reverted before the phase ends" became `spike/chess-latency/` (own project, own
  lock, `spike/*/target/` already ignored): nothing to revert, `git status` clean by
  construction, and Phase 13 times the phones with the **same** harness so the
  columns compare.
- **Phase 9 declares its seams** (`window.__chess`, `?seed=`, `?fast=1`) and Phase 13
  requires every phone finding to carry phone + seed + move list — a report that
  cannot be replayed on a laptop is not a report.
- **Phase 4's debug run is a named command** (`check.sh solver-debug cargo test -p
  chess-solver`), not a Risk aside — it is the closer for `TODO/README.md:155-171`'s
  overflow thread on this crate.
- **Phase 6 adds the three rules that make a mutation audit trustworthy:** a survivor
  is closed only when the new test has been seen to fail against the re-applied
  mutation; the log is read from the file, not the tail; the full suite runs after
  every restore.

**Validation calibration:**
- Reviewed all 15 phases against scope (Phase 0 under the Discovery Exemption; the
  other 14 declare a strategy). No tier changed; three phases had **no verification
  command** and now do (Phase 10 `check.sh tutor npm run unit -- chess-tutor
  chess-hybrid`; Phase 12 `guide:shots` + `how-to` unit + `how-to.spec.ts`; Phase 6
  the whole-workspace Rust gate after restore). Final: **Narrow** 1, 2, 3, 5, 7, 8,
  12 · **Moderate** 4, 9, 10, 11 · **Broad** 13, 14 · audit 6.
- **Every Rust phase names the gate.** `cargo test -p <crate>` runs neither `fmt
  --check` nor `clippy -D warnings`; CI's `rust` job runs both on the pinned
  toolchain. Phases 1–5 and 7 now run `bash tools/check.sh rust npm run test:rust`
  as well (the checkers plan's Pass 3 finding, applied).
- **Verification shapes fixed (`CroftC/.claude/VERIFICATION.md`):** every command in a
  Done-when now runs through `tools/check.sh` (shape 1 — Phases 7, 10, 11, 12 had
  bare commands); Phase 3's xbuild loop gains an empty-directory guard for its own
  vectors (shape 3 — the existing loops run zero cases and report green on an empty
  or misnamed directory, `check.mjs:150`); the grep sweeps (Phase 1's `unwrap`,
  Phase 14's chess sweep) are "read in full, every hit classified", never `-c`;
  Phase 8/10/12's `vitest run <filter>` are read for the file name so a filter that
  matched nothing is not a green.
- **Three factual corrections in Done-when / Changes.** Phase 7: "`npm run build:wasm`
  emits `dist/chess.wasm`" — no command does that; `build-wasm.sh` writes `target/`,
  `build.mjs:165-167` copies to `dist/` at `node build.mjs` (two commands, two
  artefacts). Phase 9: `"chess"` goes between `"cribbage"` and `"placeholder"` in
  `tests/chrome.test.ts:192` (the list is `SHIPPED` array order, `registry.ts:195`;
  Pass 2's "after `"checkers"`" would have been a red board). Phase 14: "all three
  jobs" → the set `deploy` needs is `build`, `rust`, `e2e` (`deploy.yml:294-296`),
  with `e2e` itself needing `wasm`.
- Phase 11 and 14 now assert the Problem Statement's "nothing shared changes" as
  **output** (`git diff --stat origin/main -- <the six paths>` prints nothing) rather
  than as a Review Log claim.

**Concurrency honesty:**
- Map re-checked after this pass moved five doc edits between phases and one harness
  out of a crate; still **all sequential**, no new overlap and no new disjoint pair
  worth unbunching (`docs/AI-PLAYERS.md` 5+14, `docs/BUILDING-GAMES.md` 9+14,
  `TODO/README.md` 1+14 — all on the spine). Contracts already read as invariants;
  Phase 4's was tightened from "a scratch export, reverted" (a mechanism with a revert
  step) to "the spike's own lock file; `git status --porcelain Cargo.lock` empty
  across the measurement" (checkable). No subagent dispatch, so no re-entry
  verification is owed — stated, not silent. The {11 || 12} candidate stands as Pass
  2 left it (owner: sequential).

**Discovery:**
- All six tasks now declare a disposition: D1 `keep-as-fixture` (met), D2 `throwaway`
  + the FEN set `keep-as-fixture`, **D3 `n/a`** (added — no probe code; the
  measurement is Phase 4's), D4 `keep-as-fixture`, **D5 both branches** (added —
  `promote` into Phase 9 under Phase 9's TDD if SVG, `throwaway` if Unicode), D6
  `throwaway` (closed). One `promote`, with its named follow-up phase.
- **D4's `from_fen` sub-question resolved during planning, not deferred:** five of the
  six perft positions Phase 1 asserts are FENs, so the constructor exists whatever D4
  finds (test-and-bridge only, never the record format). D4 keeps only the fixture-
  length question. Phase 1's "Depends on: D4's `from_fen` decision" corrected.
- D2's recording discipline (measurement + machine, not just the value) now also
  governs Phase 4's re-measurement and Phase 13's phone timing, all through the one
  harness.

**Coherence:**
- Re-read end to end: the plan still solves the stated problem (a build-fresh core
  verified by perft, an honest Oracle, the full §10 standard, nothing shared
  changed), in the same order, for the same reasons. Scope held — every Pass 3
  addition is a test, a number to record, a named command, or a moved doc edit; no
  new production surface except the two additive JSON fields (`depth`, `nodes`) that
  `AI-PLAYERS.md` already asks for.
- All thirteen open questions carry owner-confirmed severities ("accept all",
  2026-08-30); none re-opened. The two PHASE-GATED items (Phase 2's history array,
  Phase 9's orientation) are already reflected in those phases' bullets, so nothing
  blocks the start.
- One reference corrected: the cribbage plan has **no** Pass 3 entry (its Review Log
  is execution entries, `:714-858`); the checkers plan's is the depth model and is
  cited as such.

**Documentation impact:**
- **Three claims made false before Phase 14 were scheduled in Phase 14.** Moved to
  the phase that breaks each: `TODO/drop4.md:185` and `TODO/README.md:110-112`'s
  "vetted move generator" → **Phase 1** (false at the first build-fresh commit);
  `docs/AI-PLAYERS.md:711` "a future game (chess is the obvious one)" → **Phase 5**
  (false once a chess Oracle exists; joins the search-cost edit already there);
  `docs/BUILDING-GAMES.md:414`'s new-game sentence → **Phase 9** (written from the
  measured delta, not from memory of it). Write-sets updated.
- **One registration point was under-counted:** `crates/xbuild/check.mjs` enumerates
  the vector directories in three places (`:8`, `:12-14`, `:16`), not one; Phase 3
  and the registration list now say so.
- Phase 14 survives the trailing-docs-phase check on the checkers plan's reading:
  what remains is record-what-landed (roster, inventory, shipped status, the
  `[Unreleased]` changelog entry) that cannot be written before it lands.
- Every remaining Documentation Impact line re-checked against its phase's Changes
  and write-set: all seventeen registration points present (Phase 1: `Cargo.toml`;
  3: xbuild ×4; 7: `build-wasm.sh`, `build.mjs`, `Cargo.toml`; 9: registry,
  chrome test, settings + test, tokens + test, icon + art test, music; 11: trial
  entry ×2, baselines; 12: how-to registry, guide shots); the Phase 14 closing sweep
  is now a read-every-hit gate.

**Confirmed ready:** yes. No unreviewed open questions; no BLOCKING item
unresolved; the two PHASE-GATED items are folded into their phases. Phase 0 next,
under the Discovery Exemption (`execute.md` § Discovery Exemption before starting).

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
