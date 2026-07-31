# Wyrdle — follow-ups

Wyrdle ships as a Tier-1 game at `/wyrdle/`: a daily 5-letter word game with a
verifiable `pond-outcome`, two shares (spoiler-free emoji grid + verifiable
`?r=`), tap-or-type input, hints/settings, and a How-to guide. Plan:
`plans/2026-07-31-wyrdle-daily-word-game.md`. Ideas for later, none blocking.

## Gameplay
- **Hard mode.** Revealed hints (greens/golds) must be reused in later guesses;
  reject a guess that drops a known letter. A per-game setting.
- **Practice / unlimited.** A free-play mode that keeps dealing new words without
  waiting for the daily rollover (already reachable via `?seed=`; surface a button).
- **Streaks + stats.** Local-only guess-distribution + streak, kept in
  `localStorage` (no server, consistent with the shelf).
- **Word length / guess budget variants.** The core already parameterizes on
  `WORD_LEN`/`MAX_GUESSES` conceptually; expose 4- and 6-letter modes with their
  own answer pools.

## Answer curation
- **Better commonness signal.** Answers are the top-1500 frequency-ordered
  5-letter words (hermitdave/FrequencyWords MIT) ∩ two dictionaries. Consider
  SCOWL size-buckets (permissive, commercial-OK) for a cleaner "common word"
  cut — parked in W0 only because it ships aspell-binary lists that need
  `word-list-compress` to extract. See `games/wyrdle/PROVENANCE.md`.
- **Exclude awkward answers.** Optionally drop plurals-of-a-present-singular and
  overly obscure entries from the answer pool (keep them in `allowed`).
- **Tune the answer pool + daily count.** 1500-word pool, 365-day schedule; both
  are single constants (`ANSWER_CAP` in the tool; `PACK_COUNT` in the pack test).

## Accessibility / polish
- **High-contrast mode.** An optional palette + per-tile symbols (beyond colour +
  label + lightness) for the strongest colour-blind support, mirroring Wordle's
  high-contrast toggle.
- **Reveal animation.** A per-tile flip on submit (respecting
  `prefers-reduced-motion`), matching the shelf's restrained motion.
- **"Play the same word" share.** A spoiler-free `?seed=` link affordance on the
  result screen, distinct from the answer-revealing `?r=`.
