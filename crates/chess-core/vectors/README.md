# chess-core golden vectors

Written by Phase 2 of `plans/2026-08-30-plan-chess-vs-engine.md`, in the xbuild
shape (`{name, note, seed, moves, final_state_hash}`; `moves` are the `u16`
codes). Phase 3 points `crates/xbuild` here; the directory exists from Phase 1
so that argument has a home. An empty directory is not a green cross-build —
xbuild's runner guards against grading an empty set (plan, Phase 3).
