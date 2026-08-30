# chess-core — the rules, as this crate implements them

The authority for every golden vector and edge test in `chess-core`; tests cite
these sections (`RULES §5` style). Source: FIDE Laws of Chess, handbook E01
(2023 edition), read 2026-08-30; where FIDE gives a *player* a choice (claiming
a draw) this core decides, because a tap-first board against an engine has no
arbiter and no claim button. The decision table and its reasoning live in
`plans/2026-08-30-plan-chess-vs-engine.md` → Reasoning; this file is the
implementation-facing statement.

## §1 Board and squares

An 8×8 board. Squares are indices `0..64`, **a1 = 0, b1 = 1, … h1 = 7, a2 = 8,
… h8 = 63** (`square = rank * 8 + file`, the UCI/LERF convention). White plays
toward rank 8, Black toward rank 1. The board is a mailbox: a `[u8; 64]` cell
array (§2) plus the five FEN fields — side to move, castling rights, en-passant
square, halfmove clock, fullmove number.

## §2 Pieces, cells, and FEN

Cell encoding: `0` empty; `1..=6` white Pawn, Knight, Bishop, Rook, Queen,
King; `9..=14` the same for black (`piece | 8`). No other value is a cell.

`Board::from_fen` accepts a standard FEN of six fields, or four (clocks
omitted, defaulting to `0 1` — the published Kiwipete perft FEN has no clocks).
It is **strict about meaning, not just shape**: exactly eight ranks; each rank's
pieces-plus-digits summing to exactly eight; exactly one king per side; a
castling right present only when its king **and** its rook stand on their home
squares (§5 — a right that cannot be exercised from the placement is a lie in
the input, not a state); an en-passant square only on the correct rank (3 for
white-just-moved is wrong — the square is *behind* the pawn: rank index 2 when
Black is to move… stated concretely: the ep square is on rank index 2 (`a3..h3`)
only when **Black** is to move, and on rank index 5 (`a6..h6`) only when
**White** is to move); side to move `w`/`b`; clocks numeric. Anything else is
an `Err(FenError)`, never a panic. `Board::to_fen` prints the six-field form;
`to_fen(from_fen(s)) == s` for any six-field input this crate accepts.

The en-passant field follows **plain FEN**: it records the square behind any
double push, capturable or not (X-FEN's only-if-capturable refinement is *not*
used here). Whether the possibility is real matters to repetition (§10), which
tests capturability itself.

`Board::start()` is `from_fen` of the standard start:
`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`.

## §3 The move code

A move is `(from, to, promo)` packed into one integer:
`code = from | to << 6 | promo << 12` — 15 bits, `0..=20479` (`MAX_MOVE_CODE` =
`4 << 12 | 63 << 6 | 63`). `promo`: `0` none, `1` knight, `2` bishop, `3` rook,
`4` queen; `5..=7` are structurally invalid. `from_code` rejects any code above
`MAX_MOVE_CODE` or with `promo > 4` — reject, never mask into a different move.
A promotion move always carries `promo ≠ 0` (§7); every other move carries `0`.
A structurally valid code that is not in `legal_moves` is not legal (replay
skips it and the record's hash diverges — the tamper story every shelf game
shares). Castling is encoded as the king's two-square move (`e1g1`, `e1c1`,
`e8g8`, `e8c8`) — the standard UCI wire form, **not** cozy-chess's
king-takes-rook spike convention. En passant is the pawn's diagonal move to the
empty ep square. Serde form: the bare `u16` code, so a record is a plain JSON
number array.

## §4 Movement (FIDE Art. 3)

Standard piece movement: pawns push one (or two from their start rank, both
squares empty) and capture diagonally forward one; knights leap; bishops, rooks
and queens slide until blocked; kings step one. A piece never moves through an
occupied square (knights excepted), never onto a friendly piece, and captures
by landing on an enemy piece (pawns: only diagonally; the forward push never
captures). En passant (§6) is the one capture that does not land on its victim.

## §5 Castling (FIDE 3.8.2)

The king moves two squares toward the rook; the rook crosses to the square the
king passed (`e1g1` with `h1` rook → rook to `f1`; `e1c1` with `a1` rook → rook
to `d1`; mirrored for Black). Rights: `K`, `Q`, `k`, `q`. A right is **lost
permanently** when its king moves (both rights), when that rook moves, or when
that rook is captured **on its home square** (3.8.2.1) — and by nothing else. A
castle is **temporarily barred** (3.8.2.2) when any square between king and
rook is occupied, or when the king's current square, crossed square, or landing
square is attacked by the opponent. The rook's squares may be attacked; only
the king's three matter. Each bar removes exactly that wing's castle; the other
wing is judged independently.

## §6 En passant (FIDE 3.7.3.1–2)

Immediately after a pawn advances two squares, an enemy pawn standing beside it
(same rank, adjacent file) may capture it as if it had advanced one. Legal
**only on that very next move**; afterwards the possibility is gone. The
captured pawn is removed from its own square, not the landing square.

## §7 Promotion (FIDE 3.7.3.3–5)

A pawn reaching the last rank **must** promote, as part of the same move, to a
queen, rook, bishop or knight of its colour — the choice unrestricted by
captured pieces. A push or capture to the last rank therefore yields exactly
four moves in `legal_moves` (one per piece), each with `promo ≠ 0`; no move to
any other rank carries `promo ≠ 0`, and there is no fifth option.

## §8 Legality and check (FIDE 3.9)

A move is legal iff, after it is applied, the mover's own king is not attacked.
This crate generates pseudo-legal moves and filters by make-and-check; there is
no other legality path. Consequences the tests pin: a pinned piece may move
along its pin line and not off it; a king may not capture a defended piece; a
move that gives check is generated like any other; a move that leaves or places
the mover's king in check is never in `legal_moves`.

## §9 Decisive and stale terminals (FIDE 5.1.1, 5.2.1)

Checkmate: the side to move has no legal move and its king is attacked — the
**mover loses**. Stalemate: no legal move and the king is not attacked — a
draw. Terminal positions return an empty `legal_moves`.

## §10 Draws by rule (FIDE 9.2, 9.3, 5.2.2 — decided automatic)

- **Threefold repetition (9.2), automatic here.** A position repeats when the
  same side is to move, the same pieces of the same colour stand on the same
  squares, **and the possible moves are the same** — castling rights equal
  (9.2.3.2), and an en-passant *possibility* counts only if the capture is
  actually legal (9.2.3.1). The third occurrence (the initial position counts
  as its first) ends the game as a draw at that ply, not later. In a shuffle
  cycle the **earliest-seen** position reaches three occurrences first —
  measured in Phase 0 against a reference engine; the fixtures encode it.
- **50-move rule (9.3), automatic here.** A draw the moment the halfmove clock
  (§11) reaches 100 — 50 moves by each side with no pawn move and no capture.
- **Checkmate precedes both**: a move that mates is a win even if it is the
  100th halfmove or a third occurrence.
- **Insufficient material** (the computable subset of FIDE 5.2.2's dead
  position): K v K, K+B v K, K+N v K, and K+B v K+B with **all** bishops on one
  square colour. Terminal draw the moment the material reduces to one of these.
  A blocked-pawn dead position is *not* detected; the 50-move rule ends it.
- Fivefold and the 75-move rule (9.6) are unreachable once 9.2/9.3 are
  automatic, and are not implemented. Resignation, agreement, and clocks are
  not rules of this core.

## §11 Clocks and counters

The **halfmove clock** counts plies since the last pawn move or capture; both
reset it to 0, every other move increments it. The **fullmove number** starts
at 1 and increments after Black moves. The **repetition history** is the list
of position keys since the last irreversible move (pawn move, capture, or a
castling-rights change), bounded ≤ 100 entries by the 50-move rule; it is part
of the position (§10) and joins the state hash — two boards identical in every
FEN field but with different histories have different legal futures.

## §12 The text bridge

`move_to_text` / `parse_move` speak **UCI long algebraic**: `from``to` with a
lowercase promotion letter appended (`e2e4`, `e7e8q`, `e1g1`). `parse_move` is
strict per the shared trait: unparseable or illegal → `None`. SAN (`Nf3`,
`O-O`, `exd8=Q+`) is a **rendering only** (`san_of`), for the tutor panel and
move list — never parsed. `render_text` gives the ASCII board, the FEN, and one
line naming the move grammar.

## §13 Determinism and ordering

`legal_moves` returns a deterministic order: ascending `from`, then ascending
`to`, then ascending `promo`. The order is part of the crate's contract — the
difficulty band's tie-breaks and the replay tests read it. No floats anywhere;
every hashed integer serializes little-endian; `native == wasm`.

## §14 The seed

`initial(seed)` ignores the seed today — every game opens from the standard
start. The seed is **reserved for Chess960** (a follow-up recorded in
`TODO/chess.md`); nothing else may repurpose it.

## §15 The Zobrist table

The repetition keys (§10, §11) and the future transposition-table keys come
from **781 constants** generated at compile time by a `const fn` splitmix64
(Steele–Lea–Flood mixing constants `0x9E3779B97F4A7C15`,
`0xBF58476D1CE4E5B9`, `0x94D049BB133111EB`) over the fixed seed
**`0xC40F_7C55_2026_0830`**. Table order: 12 piece-square tables of 64 (white
P N B R Q K, then black, square-major within each), the side-to-move key, the
four castling keys (`K Q k q`), the eight en-passant file keys (`a..h`). The
ep file is folded in **only when the capture is actually legal** (§10). Two
values pin the whole table — a reader can regenerate it, and a changed seed is
a deliberate red across every vector rather than a silent re-hash:

- `KEYS[0]   = 0x76E9_A102_2C52_26D8`
- `KEYS[780] = 0x45D0_CCC9_5E0D_7B5B`
