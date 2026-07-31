# wyrdle-core — rules & determinism contract

The deterministic heart of the `fun.croft.ing` daily word game (Wyrdle). This
doc is the source of truth for the scoring rules, the seed→answer map, the state
hash, and the answer-pack contract. The engine has **no RNG on the runtime
path**, so a game replays exactly from `(seed, guesses)` and native == wasm.

## The word

A `Word` is a fixed **5-letter** (`WORD_LEN`) lowercase word, stored as five
`0..26` letter indices (`a`=0 … `z`=25). It serializes to/from a bare lowercase
`a-z` string, so an outcome record's move list reads as words in the `?r=` share.

## Guess scoring — correct / present / absent

`score(answer, guess)` returns a `[Mark; 5]` using the **standard two-pass**
algorithm, which is what makes repeated letters correct:

1. **Pass 1 (greens).** For each position, if `guess[i] == answer[i]`, mark it
   `Correct`. Otherwise, add `answer[i]` to a per-letter "remaining" tally.
2. **Pass 2 (yellows/greys).** For each non-`Correct` position in order, if the
   guess letter still has a remaining tally, mark it `Present` and decrement the
   tally; else mark it `Absent`.

So a guess never shows more `Present`/`Correct` marks for a letter than the
answer actually contains. Canonical pinned cases (see `tests/golden.rs`):

| answer | guess | pattern |
|--------|-------|---------|
| `ALLOY` | `LOLLY` | 🟨🟨🟩⬛🟩 |
| `ABBEY` | `KEBAB` | ⬛🟨🟩🟨🟨 |

`Mark` also carries an emoji (`🟩🟨⬛`) for the share grid and a text label
(`correct`/`present`/`absent`) — the UI must never rely on colour alone.

## Word lists — the seed→answer map

Two committed, license-clean lists under `data/` are embedded at compile time
(provenance + licences: `games/wyrdle/PROVENANCE.md`):

- `allowed.txt` — every legal 5-letter guess, sorted. `is_allowed(word)` is a
  binary search (lexicographic string order == letter-index order because `a-z`
  maps order-preserving to `0..26`).
- `answers.txt` — the curated common answer pool, frequency-ordered.

The answer for a seed is a **pure integer map**: `answer_for(seed) =
answers[seed % answers.len()]`. No RNG — the seed alone fixes the answer, so
`(seed, guesses)` replays exactly.

## State hash

Lowercase-hex SHA-256 over, in order: the domain tag `b"wyr\x00"`, `WORD_LEN`
(`u32` LE), `MAX_GUESSES` (`u32` LE), the answer's 5 letter bytes, the guess
count (`u32` LE), then each guess's 5 letter bytes. Patterns are derived from
`(answer, guess)`, so they are **not** hashed — the hash is fully determined by
`(seed→answer, guesses)`. Integer fields are little-endian `u32`, so the hash is
byte-identical on native and `wasm32`.

## Answer daily-pack contract (see `pack.rs`)

The daily schedule is a `pond-docformat` envelope (`kind = "wyrdle-answer-pack"`,
version 1) holding `{ seeds, fixture }`: a deterministic seeded shuffle of answer
indices (a year of non-repeating, non-sequential dailies) plus one `fixture`
(seed + its one-guess winning line) for the win-path test. There is **no solver**
— a word game is trivially winnable (the answer is itself a legal guess), so the
pack keeps the machinery (envelope, seeds+fixture, byte-identical regen,
wasm-embedded, daily indexing) without a winnability search.
