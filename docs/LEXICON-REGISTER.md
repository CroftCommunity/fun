# The `ing.croft.fun.*` register

fun mints one record type, and today it is **a shape, not a published lexicon**: the
record lives in the player's browser (`src/record.ts`, plan
`plans/2026-08-29-plan-color-sort-redesign.md` D9 — owner: "keep the state local to the
browser but shaped for a later lexicon if we so choose"). This file exists because the
shape carries a `$type` NSID, and minting an NSID is cheap and permanent whether or not a
PDS ever sees it. Rule and reasoning: `CroftC/.claude/LEXICONS.md`.

Every entry answers **Holds**, **Why ours**, and **Ecosystem check** — the last being
which existing types were actually opened and looked in.

Namespace: `ing.croft.*` is the reverse of **croft.ing**, which the project controls.
**Not yet published** — `_lexicon.croft.ing` answers with the registrar's parking wildcard,
not a TXT; the fix is an explicit TXT at that name and the schema records, per LEXICONS.md
§ 2 and its runbook. Stage, not destination: recorded in `TODO/color-sort.md`.

> **Note on the audit.** Checks 41–42 find lexicons by their schema files; this type has
> no schema file yet (a `lexicons/ing.croft.fun.progress.json` arrives with rule 2), so
> the finder does not see it. This register is kept by the rule, not by the check.

---

## ing.croft.fun.progress

**Holds:** one record per game per player — `game` (the shelf id), `did` (bound on sign-in,
null while anonymous), `stats` (`solved`, `strictSolved`, `streak`, `maxStreak`, `lastDay`,
`bestLevel`, `played`), `inProgress` (the deal being played: mode, level or UTC day, seed,
the move list, par once known, solved, strict), `updatedAt`. Persisted through a substrate
seam (`localSubstrate` over `localStorage` today; a memory one in tests; an atproto one
would be the third) — a substrate never reaches for storage on its own, forage's rule.

**Why ours.** A game's progress is app state that *belongs to the person* — the reason it
is a record shape at all — but nothing in the ecosystem models a puzzle player's stats or a
resumable deal. Its two consumers are ours (the Daily gate reads `played`; Continue reads
`inProgress`), and until a second app wants to read a Croft game's streak there is nobody
to share a type with. When there is, the right move is a proposal to `community.lexicon.*`
(see LEXICONS.md § 3), not a wider `ing.croft.*` type.

**Ecosystem check (2026-08-30):**

| Where | What was opened | Why it does not fit |
|---|---|---|
| `app.bsky.*` (`bluesky-social/atproto` `lexicons/app/bsky`) | the thirteen groups: actor, ageassurance, bookmark, contact, draft, embed, feed, graph, labeler, notification, richtext, unspecced, video | nothing models play, a score, progress or per-app state; `actor.profile` is a singleton and public; `feed.post` would publish every solve to a timeline |
| `com.atproto.*`, `chat.bsky.*`, `tools.ozone.*` | by name | infrastructure, messaging, moderation — no user-state record |
| `community.lexicon.*` (the archived GitHub tree and its Tangled successor, `lexicon.community/lexicons`) | all seven namespaces: `app` (profiles, listings, localization), `bookmarks`, `calendar` (event, rsvp), `interaction` (like), `location` (address, geo, h3, fsq), `payments` (web monetization), `preference` (`ai` — consent to AI use of public data) | no game, score, progress, streak or generic per-app state type. `preference.ai` is the closest in *kind* (a per-person preference record) and the farthest in *meaning* — consent, not state; adopting it would be the bookmarks trap LEXICONS.md warns of (fields fit, behaviour does not) |
| `ing.croft.*` already minted | `croftpwa.note`; `bluebird.config`, `.search`, `.follow`, `.like` | `bluebird.config` is per-app config for a different app; a shelf-wide "config" type would put every game's progress in one record and every game's write would race the others |
| the wider ecosystem | `gamesgamesgamesgamesgames/happyview` (a lexicon-driven AppView framework for games) | defines no game NSIDs; it consumes whatever lexicons an app brings, so it is a consumer to keep in mind, not a type to adopt |

**What is deliberately not in it.** The verifiable outcome (`pond-outcome`, `?r=`) is a
separate, already-shipped document with its own envelope and hash; the record points at
nothing and carries no result — a solve's proof is the outcome, the record is the tally.

**Stage.** Unpublished; local only. `did` is bound on sign-in and nothing is sent anywhere
(`src/signin/index.ts` `handleCallback`). Rules 2 (publish) and 3 (socialize) are owed and
filed in `TODO/color-sort.md`; rule 4 (validate on the way in) is met locally by
`resolveRecord` in `src/record.ts`, which refuses a wrong `$type`, a wrong `game`, or a
malformed `stats` block — and would need the schema file to validate against once one exists.
