# Cribbage — rules (the core's contract)

Two-hand, six-card cribbage to **121**. This file is what `cribbage-core` implements and
what its golden vectors lock. Three decisions inside "standard cribbage" were made by the
owner on 2026-08-29 (plan `plans/2026-08-29-plan-cribbage-vs-engine.md`, O1/O2/O4); they
are marked.

## Seats, the seed, and the deal

- Two seats, `A` and `B`, symmetric. **The seed picks the first dealer** (a draw of its
  own, before any deal) — the cut for deal is a ritual with no decision in it.
- Deal `n` (1-based) shuffles a fresh 52-card deck with ChaCha20 seeded from
  `seed ^ (n · 0x9E3779B97F4A7C15)`, top-down Fisher–Yates with `u32` indices (so native
  and wasm consume the stream identically). Cards `0..6` go to the non-dealer, `6..12` to
  the dealer, and card `12` is **the cut**. Hands are sorted by wire code.
- The dealer alternates every deal.

## Cards

Rank 1 (ace, always low) to 13 (king); suit `0..4`. Pegging value = `min(rank, 10)`.
Wire code `suit · 13 + (rank − 1)`, in `0..52`.

## The deal, in order

1. **Discard.** Non-dealer throws two cards to the crib, then the dealer. The crib
   belongs to the dealer. Only then is the cut turned.
2. **The cut.** A jack is **his heels**: 2 to the dealer, scored before pegging.
3. **Pegging.** Non-dealer leads. Each card adds its value to the count, which may not
   pass 31. The card just played scores: fifteen 2, thirty-one 2, pair 2 / pair royal 6 /
   double pair royal 12 (consecutive equal ranks only), and a run of 3+ formed by the
   trailing cards in any order (the longest such window). A seat that cannot play under 31
   while the other seat can declares **go** — that is a move. When **neither** seat can
   play, the last seat to play a card pegs 1 for the go (nothing extra on 31, which
   already scored 2), the count resets, and the *other* seat leads. The core resolves that
   point itself; no move is needed. After a go the other seat keeps playing alone while it
   can. The last card of the deal pegs 1 (unless it made 31).
4. **The show.** Hands are counted in this order, and this order only: **non-dealer's
   hand, dealer's hand, the crib.** Each is scored against the cut: fifteens (2 per
   combination), pairs (2 per pair), runs (length × the product of duplicate ranks), a
   flush (4 for four in hand; 5 with the cut; **the crib needs all five**), and his nobs
   (1 for a jack in hand matching the cut's suit; the cut's own jack never scores nobs).
5. **Claims (O1).** Each hand at the show is scored by a `Claim(n)` **move from its
   owner**. The core grades it: an exact claim scores `n`; an under-claim scores `n` and
   the other seat takes the difference (**muggins**); an over-claim scores the true total
   with no penalty. With manual counting off, the UI submits the true total on the
   player's behalf — the record is identical either way. The engine always claims exactly.
6. **The next deal**, unless the game is over.

## Winning, and the value of a game (O2)

The game ends **the instant** a seat reaches 121 — mid-pegging, on his heels, on a claim,
or by muggins. The non-dealer counts first at the show and can win before the dealer
counts a single point. A win is worth **1**; if the loser is under 91 it is a **skunk**,
worth **2**; under 61 a **double skunk**, worth **3**. The value is computed by the core
and carried in the record's `score`, so it is replayed, never trusted.

## Move codes (the wire)

| move | code |
|---|---|
| `Discard(i)` — the `i`-th pair of the six-card hand (pairs in lexicographic order) | `0..=14` |
| `Play(i)` — the `i`-th card of the hand | `16..=19` |
| `Go` | `20` |
| `Claim(n)` — claim `n` points | `32..=61` (`32 + n`, `n ≤ 29`) |

Any other code is refused. A record is `(seed, moves)`; replaying it through the core
reproduces the final state, and `pond_outcome::verify` re-derives the hash. A move the
position refuses is skipped in replay, so a tampered record diverges.

## What a seat can see (the `View`)

The `GameState` holds both hands, the crib and the cut. A seat's `View` holds its own
hand and kept cards, its own two throws, the cut once both seats have discarded, the
stack and the count, every card played this deal, how many cards the other seat holds,
and — at the show — each hand as it comes face up, in order, the crib last. It never
holds the other seat's hand, its throws, or the cut before the discards. The engine
takes a `View` and nothing else.

## The state hash

Lowercase-hex SHA-256 over the domain tag `cribbage\0`, a version (`1`), and every field of
the position in a fixed order — seed, deal number, dealer, seat to move, phase, scores,
each seat's hand / kept / thrown, the crib, the cut, the stack, the plays, the go flags,
the last player, the graded claims — each integer little-endian, each list
length-prefixed. Golden vectors lock it: `vectors/*.json`.
