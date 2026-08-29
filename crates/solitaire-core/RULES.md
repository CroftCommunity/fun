# Solitaire (Klondike draw-1) — P1 rules document + tie-break / ordering tables

**Status:** P1 (the determinism foundation), master-plan Phase 4. First deliverable of the per-pond
build discipline: the rules document + tie-break/ordering tables come **before** the engine, and the
engine is grown red-first against them. The property P1 establishes is **verifiable outcomes**: a
`(seed, move list)` triple fully determines every subsequent state, and replaying the move list
reproduces the same **state hash** — on native and (via `solitaire-wasm`) on wasm.

Variant fixed by the owner (2026-07-27): **Klondike, draw-1.** Residual sub-details pinned here against
the canonical Klondike ruleset rather than assumed (owner may override): **unlimited stock passes** (no
redeal limit — the standard draw-1 default), and **no score tracked** in P1 (comparison is win /
cleared-clean, per the follow-chain discipline; scoring is a deferred owner balance decision).

## Deck and coordinates

- A standard **52-card deck**: 4 suits — clubs `♣`, diamonds `♦`, hearts `♥`, spades `♠` — each with 13
  ranks Ace(1) … King(13). **Colour:** `♣ ♠` are **black**, `♦ ♥` are **red**.
- Canonical suit order (for the hash and the deal): `♣=0, ♦=1, ♥=2, ♠=3`. Rank is `1..=13`.
- A card is `Card { suit: 0..=3, rank: 1..=13 }`. A **card index** `0..=51` is `suit*13 + (rank-1)` —
  the canonical serialization of a card.

## Zones

- **Stock:** a face-down pile; the draw source.
- **Waste:** a face-up pile; cards drawn from the stock land here, top playable.
- **Foundations:** four piles, one per suit, built **up** from Ace to King in the card's own suit. The
  win condition is all four foundations complete (all 52 cards on foundations).
- **Tableau:** seven piles. A pile holds an ordered list of cards, each **face-up or face-down**.

## The deterministic deal (`new_game(seed)`)

The seed's only consumer is the shuffle; the deal is then a fixed procedure over the shuffled deck.

1. **Build the ordered deck** `0..=51` (card index order above).
2. **Shuffle** with one `ChaCha20Rng` seeded from the `u64` seed — the same determinism primitive
   `trio-tumble-core` and `alpha/Proofs/lineage-groups` use. The shuffle is an in-place **Fisher–Yates from
   the top index down**: for `i` from `51` down to `1`, draw `j = rng.gen_range(0..=i)` and swap
   `deck[i]` and `deck[j]`. This fixed order is what makes the deal cross-build-stable; changing it is a
   determinism break.
3. **Deal the tableau:** for pile `p` in `0..7`, deal `p+1` cards to pile `p` (pile 0 gets 1 … pile 6
   gets 7), taking cards from the **front** of the shuffled deck. The **deal order** is column-major by
   round in the canonical Klondike way: round `r = 0..7`, and in each round deal one card to every pile
   `p` with `p >= r`. Within the engine this is equivalent to and implemented as the simpler
   "pile 0 gets 1, …, pile 6 gets 7 in sequence" **only if** the same cards land in the same places —
   so the canonical **round-robin** deal order is the normative one and the tie-break the engine
   implements verbatim. In each pile the **last card dealt is face-up**; all earlier cards are
   face-down.
4. **Stock:** the remaining `52 - 28 = 24` cards stay in deck order, all **face-down**, top of stock =
   front of the remaining deck.
5. **Waste** and all **foundations** start empty. `draws` (RNG values consumed) is recorded and folded
   into the state hash.

## Moves and the turn

A move is one of a small, explicit set. A move is **legal** iff its predicate holds; an illegal move is
**rejected** and the state is unchanged. After any move that exposes a face-down card at the top of a
tableau pile, that card is **auto-flipped face-up** (a deterministic post-step, not a separate move).

### Legal-move predicates (the tie-break tables)

- **T1 — Draw (`Draw`):** move the top card of the **stock** to the **waste**, face-up (draw-1).
  - If the stock is **non-empty**: always legal; one card moves stock→waste.
  - If the stock is **empty** and the waste is **non-empty**: **recycle** — the entire waste returns to
    the stock, face-down, in **reversed order** (so the next draws replay the waste from its bottom),
    consuming no RNG. Unlimited passes (no redeal limit in P1).
  - If both stock and waste are empty: illegal.
- **T2 — Waste → Foundation (`WasteToFoundation`):** legal iff the waste is non-empty and its top card
  either is an Ace (to an empty foundation of its suit) or is exactly one rank above that suit's
  foundation top. Moves the waste top to its suit foundation.
- **T3 — Waste → Tableau (`WasteToTableau { pile }`):** legal iff the waste top can be placed on
  `pile` per the **tableau-build rule** below. Moves the waste top onto `pile`, face-up.
- **T4 — Tableau → Foundation (`TableauToFoundation { pile }`):** legal iff `pile` is non-empty and its
  top (necessarily face-up) card is an Ace or exactly one rank above that suit's foundation top. Moves
  the pile top to its suit foundation.
- **T5 — Tableau → Tableau (`TableauToTableau { from, count, to }`):** move the top `count` face-up
  cards of `from` (an ordered, already-valid alternating-colour descending run — enforced) onto `to`.
  Legal iff: `from != to`; `count >= 1`; the top `count` cards of `from` are all face-up and form a
  valid descending alternating-colour run; and the **bottom** card of that moved run can be placed on
  `to` per the tableau-build rule.

### The tableau-build rule (shared by T3, T5)

A card `c` may be placed on tableau pile `to`:
- if `to` is **empty**: iff `c.rank == 13` (only a **King**, or a King-led run, moves to an empty pile);
- if `to` is **non-empty**: iff the destination top card `d` is face-up, `c.colour != d.colour`
  (alternating colour), and `c.rank == d.rank - 1` (descending by one).

### Foundation-build rule (shared by T2, T4)

A card `c` may go to its suit foundation iff: the foundation for `c.suit` is empty and `c.rank == 1`
(Ace), **or** the foundation's top card has rank `c.rank - 1` (same suit, ascending by one).

### Move-ordering / determinism notes

- Moves are **explicit and addressed** (`from`/`to`/`count` are given), so there is no ambiguity to
  tie-break at play time — the engine never "chooses" a move. `legal_moves(state)` enumerates the legal
  move set in a **canonical order** (Draw; then WasteToFoundation; then TableauToFoundation piles 0..7;
  then WasteToTableau piles 0..7; then TableauToTableau by `from` 0..7, then `count` ascending, then
  `to` 0..7) so the enumeration itself is deterministic and cross-build-stable (the UI highlights from
  this list).
- Auto-flip exposes at most one card per pile per move and consumes no RNG.

## Win / loss

- **Win:** all four foundations reach the King (52 cards on foundations). A clean clear = won without
  using undo/hints (assistance flag, decided at the UI layer; the core just reports the win).
- **Loss / stuck** is not a terminal the core asserts — a game can be abandoned; the core only reports
  `is_won`.

## State hash (the verifiable-outcome anchor)

`state_hash` = lowercase hex of `SHA-256` over the canonical encoding:

```
"sk1\x00"
  || draws(u64 LE)                         // RNG values consumed by the deal
  || for suit in 0..4: foundation_top(u8)  // 0 = empty, else rank 1..=13
  || stock.len(u8) || for each stock card bottom→top: card_index(u8)   // face-down, order matters
  || waste.len(u8) || for each waste card bottom→top: card_index(u8)   // face-up
  || for pile in 0..7:
       pile.len(u8)
       || for each card bottom→top: face_up(u8: 0|1), card_index(u8)
```

Replaying `(seed, moves)` MUST reproduce the identical `state_hash` on every run and every build target.
This is the property `pond-outcome` (P8 verifiable clean-clear) and the follow-chain comparison depend on.

## Golden-vector corpus

`vectors/*.json` — each vector is a hand-authored `(seed, move list)` plus hand-computable step-0
expectations (the dealt board) and, once the engine is green, a recorded `final_state_hash` (a
regression + cross-build determinism anchor; by construction a recorded output, not hand-derived).
Schema mirrors `trio-tumble-core/vectors/README.md`.

## Out of P1 (explicit not-yet set)

Scoring/points; timed play; alternate variants (draw-3, Vegas, Spider); winnable-deal classification /
minimum-move par (needs a solver — a deferred owner decision, agent rec = Trio Tumble only); saves + share
codes (their format is `pond-docformat`, P2/master Phase 5); the outcome record (`pond-outcome`, P8);
undo/hints UX (front-end plan Phase 4); anything network. P1 is a pure, headless, deterministic core.
