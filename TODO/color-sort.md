# color-sort — open items

Filed 2026-08-30 at the landing of `plans/2026-08-29-plan-color-sort-redesign.md`
(phases A–D complete). The plan's Status line answers "what shipped"; this file is what
remains, per `CroftC/.claude/TRACKING.md`.

- [ ] **`ing.croft.fun.progress` — LEXICONS.md rules 2 and 3.** The type is registered
  (`docs/LEXICON-REGISTER.md`, ecosystem check done) and unpublished by design: local only
  until an atproto substrate is chosen. Before that substrate ships: (2) a schema file,
  `_lexicon.croft.ing TXT` and the schema record per the LEXICONS.md runbook — shared with
  bluebird and croft-pwa, one account whose handle is `croft.ing`; (3) raise "a puzzle
  player's stats and resumable deal" with `community.lexicon.*` first, since a second game
  app is the likely reader, and record the outcome either way.
- [ ] **Publishing substrate.** `src/record.ts` has the seam (`RecordSubstrate`); an atproto
  substrate would write the record with the DPoP client (`putRecord` was deliberately not
  carried in the port — `src/atproto/oauth/client.ts`). Owner's call; not a default.
- [ ] **Mock E open questions** (`mocks/e-color-sort.html` § Open decisions): Q1 pour
  timings on a real phone; Q3 whether the "N to go" counter also earns a place on the
  poster; Q4 the offer's copy (Design › Copy); Q5 the ball skin's lift during hops.
- [ ] **MOCKS.md rule 6** proposed to the workspace (`CroftC` PR) — the parity contract
  that this game proved out.
