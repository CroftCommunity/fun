# Match-3 — story bible & event taxonomy

Narrative direction for `/trio-tumble/`. **Phase 2 ships the scaffold** (a game-event
bus + a skippable beat-overlay with placeholder cards). **Phase 3 fills it** with
the story below and real side-quest video clips. This doc is the source of truth
so Phase 3 is executable without re-deciding intent.

Design constraints inherited from the shelf: the story is **optional and never
blocking** — every beat is one-tap skippable, skips are remembered (we never
nag), and nothing narrative touches the verifiable core or the hashed outcome.
Under `prefers-reduced-motion` beats degrade to a static card (or are suppressed).
No account, no server — beat progress is local (localStorage), same as settings.

## The premise (silly, warm, low-stakes)

**Biscuit** is a small, round, perpetually optimistic dog who lives *under* the
game board — the candy is, as far as Biscuit is concerned, weather. Biscuit can't
play (no thumbs), so Biscuit *needs you to play*, and rewards good play with
unearned, oddly-specific life advice delivered with total confidence. Biscuit is
a mentor who has never once been correct about anything and is beloved anyway.

- **Tone:** dry, affectionate, a little absurd. Fortune-cookie wisdom filtered
  through a dog who thinks the mailman is a recurring boss fight. Never mean,
  never sappy, never a tutorial in disguise.
- **Why a dog:** a wordless, universally-legible companion that carries emotion in
  one drawing; funny without reading; safe for all ages; cheap to animate as short
  loops. The humor lives in the *caption*, so clips can be tiny/placeholder-first.
- **Arc (loose, non-mandatory):** Biscuit is convinced the cascades are messages
  from the sky and is assembling a "prophecy." Each side-quest beat is a new,
  contradictory prophecy. The running joke: it never resolves, and Biscuit is
  fine. Later levels can gate a "chapter" card, but the campaign never *requires*
  watching one.

Placeholder beat copy (Phase 2 uses these strings verbatim; Phase 3 swaps art +
clips, may revise copy):

| Beat key            | Placeholder caption                                                        |
|---------------------|-----------------------------------------------------------------------------|
| `first-clear`       | "Biscuit saw that. Biscuit will remember that. Biscuit forgets things."     |
| `first-cascade-3`   | "Three in a row means rain. Or lunch. The signs are unclear but delicious." |
| `first-special`     | "You have made a Powerful Candy. Do not tell the other candy."              |
| `level-1-complete`  | "Level one, conquered. Biscuit always believed in you, starting just now."  |
| `level-2-complete`  | "Two levels. That's basically a career. Consider retiring at the top."      |
| `comeback`          | "Down to your last swap and you SWUNG it. Biscuit is legally your dog now." |

## Event taxonomy → beats

The game emits **gameplay events** on a small game-scoped bus
(`src/games/trio-tumble-events.ts`). `src/games/trio-tumble-story.ts` maps a subset of those
events to **beats** (a beat = `{key, title, caption, media?}`), each fired **at
most once ever** (a persisted seen-set), so beats feel like discoveries, not
pop-ups. The overlay (`src/games/trio-tumble-overlay.ts`) renders the beat as a
skippable card and consumes the same bus.

### Events emitted by the game (the bus contract)

| Event        | Payload                                  | Emitted when                                   |
|--------------|-------------------------------------------|------------------------------------------------|
| `move`       | `{scoreDelta, cascadeDepth, cleared}`     | after each settled swap                         |
| `cascade`    | `{depth, clearedCells}`                   | a settled move whose cascade depth ≥ 1          |
| `special`    | `{kind}`                                   | a special candy is created                      |
| `level-win`  | `{level, stars, score}`                    | a campaign level is cleared                      |
| `level-lose` | `{level}`                                  | a campaign level runs out of budget/moves        |
| `game-over`  | `{won, mode}`                              | any board ends (existing result path)            |

`cascade.depth` and `clearedCells` come from the **frame-diff** of `playTraced`
(a snapshot whose hole-count rose = one clear phase). The same signal drives the
Phase-1 burst FX and celebration tier, so FX and narrative never disagree.

### Which successes fire a side-quest beat (Phase 2 mapping)

- **`first-clear`** ← first-ever `move` with `cleared > 0`. The "you're playing"
  welcome.
- **`first-cascade-3`** ← first `cascade` with `depth ≥ 3`. Rewards the first
  *chain*, the genre's core delight.
- **`first-special`** ← first `special`. Marks a mechanics milestone.
- **`level-1-complete`**, **`level-2-complete`** ← `level-win` for those levels.
  The onboarding payoff.
- **`comeback`** ← `level-win` where the last move was near budget-exhaustion
  (a "clutch" flag on the event). Rare, high-delight.

Design rules for *what deserves a beat*: rare + earned + emotionally legible.
Never fire on routine moves (annoying), never on failure (kicking someone when
down — a gentle `level-lose` "Biscuit believes in the *next* one" card is Phase-3
optional and still one-tap dismissable). Cap: at most one beat per board so a
lucky run doesn't chain cards.

## Overlay UX (skip with flow)

- A beat card slides in from a corner (Biscuit's "burrow"), **not** a modal over
  the board — play is never hard-blocked. It carries: title, the caption, a media
  slot (placeholder gradient in Phase 2 → clip in Phase 3), and **Skip** / **▶**.
- **Skip is one tap and permanent for that beat** (added to the seen-set). ▶ plays
  the (future) clip; when it ends the card auto-dismisses with a soft settle.
- Auto-dismiss after a few seconds even if untouched, so it never stalls a session.
- `prefers-reduced-motion`: no slide, no autoplay — a static card with the caption
  and a Dismiss button, or suppressed entirely per the reduced-motion setting.
- Fully `aria-live="polite"`-announced caption; the card is keyboard-dismissable;
  the media slot is `aria-hidden` decorative.

## What Phase 3 adds (deferred, documented)

Real Biscuit art (CSS/SVG character + a few short loop clips per beat), final
caption copy, a "prophecy journal" that collects seen beats, optional chapter
cards at level milestones, and the skip-with-flow motion polish. None of it
changes the bus contract above — Phase 3 is drop-in against the Phase-2 scaffold.
