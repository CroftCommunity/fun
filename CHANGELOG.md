# Changelog — fun.croft.ing

The shelf deploys on every landing, so sections are months and entries carry their
landing date (`CroftC/.claude/CHANGELOGS.md` § Rule 2). An entry is written on the
branch, before it lands (Rule 3): what changed for someone who plays, not what happened
in the repo.

Contexts: shelf · solitaire · trio-tumble · bubble · wyrdle · 2048 · drop4 · othello · checkers · dots · furrow · align · blockdoku · looseends · color-sort · orchard-drop · cribbage

## 2026-08

- 2026-08-29 **cribbage:** a settings panel opened while the engine was still moving no
  longer snaps shut when its move lands (the same re-render defect Dots had; the shared
  fix now covers cribbage). (`plans/2026-08-29-plan-cribbage-vs-engine.md`, post-landing)
- 2026-08-29 **cribbage:** the game ends showing exactly the hands that were counted —
  a win by a count no longer turns over a hand nobody counted. Found by the mutation
  audit. (`plans/2026-08-29-plan-cribbage-vs-engine.md`, Phase 4)
- 2026-08-29 **cribbage:** new game — two-hand, six-card cribbage to 121 against The
  Engine, on one device. Tap two cards to throw, peg to 31, the show counted in order
  with the breakdown shown; turn on "Count my own hands" to count yourself (an
  under-count is the engine's by muggins). A win is worth 1, a skunk 2, a double skunk
  3; the value is on the end screen and in the re-verifying share. Four levels; Expert
  throws by exact expectation and cannot see your hand — the shelf tests that.
  (`plans/2026-08-29-plan-cribbage-vs-engine.md`)
