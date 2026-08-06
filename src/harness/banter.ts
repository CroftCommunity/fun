//! What the experimental opponent is allowed to *say* — shared by every game
//! that ships one, because the honesty rule is the same in all of them.
//!
//! The split the shelf commits to is that the **engine is strength and the model
//! is personality** (`docs/AI-PLAYERS.md`). The model never picks an unsafe move
//! — `HybridPlayer` constrains it to the class-preserving band — but until this
//! module existed nothing constrained what it *said*, beyond a length check
//! copied identically into three games. A 0.5B model duly narrated the board and
//! got it wrong: "capturing the opponent's king with a move to 8", with no king
//! on the board (measured, P8 Phase 14).
//!
//! That is a quieter cousin of the dishonesty the `exact` flag exists to stop.
//! The move is still safe, but a player is being told something false about their
//! own game by something that sounds authoritative. So the rule here is about
//! **checkable positional claims**, not about vocabulary: "I'll be king soon" is
//! character, "the king on square 8" is a claim, and a claim can be false.
//!
//! Deliberately not attempted: verifying a claim against the board. That needs
//! the model's sentence parsed and checked per game, which is more machinery than
//! a quip is worth — and the fallback line is good banter, so refusing is cheap.

/** The longest line a persona may speak. Beyond this it is an essay, not a quip. */
const MAX_LINE = 90;

/**
 * A positional claim: a digit anywhere (`b1`, `square 8`, `row 3`), or a board
 * noun that only appears when the model is describing geometry.
 *
 * Spelled-out numbers are covered by the nouns they qualify ("column four"),
 * because a model told not to use digits writes the word instead. Verbs stay off
 * this list on purpose — "jump", "capture", "king", "crown" are ordinary trash
 * talk in draughts, and banning them would leave a persona nothing in character
 * to say.
 */
const POSITIONAL =
  /\d|\b(?:row|rows|column|columns|col|square|squares|position|positions|positioning|diagonal|diagonals|rank|file|coordinate|coordinates)\b/i;

/**
 * The model's line if it is fit to speak, or `null` if it is not — empty, an
 * essay, or a claim about the board.
 */
export function acceptBanter(reason: string): string | null {
  const line = reason.trim();
  if (line.length === 0 || line.length > MAX_LINE) return null;
  return POSITIONAL.test(line) ? null : line;
}

/** A hybrid decision, as far as the banter is concerned. */
export interface SpokenDecision {
  /** Which path chose the **move** — the model in-band, or the engine fallback. */
  readonly source: "llm" | "fallback";
  /** The model's stated reason (empty or engine-ish when it fell back). */
  readonly reason: string;
}

/** What the opponent says, and whose words they are. */
export interface Spoken {
  readonly line: string;
  /**
   * `"model"` only when the model **both** chose the move and said something
   * acceptable. `"canned"` covers the other three cases — and, the part that has
   * already caused one wrong measurement, a `"canned"` line does **not** mean the
   * engine chose the move. Reading canned lines off the screen as fallbacks put
   * checkers' fallback rate at 50% when the move-level rate was 0%. Whose move it
   * was lives in `HybridDecision.source`, which the harness now counts
   * (`Scorecard.llmMoves` / `fallbackMoves`).
   */
  readonly words: "model" | "canned";
}

/**
 * Decide what the opponent says: the model's own words when it earned them,
 * otherwise the game's canned line for the situation.
 */
export function speak(decision: SpokenDecision, canned: string): Spoken {
  if (decision.source !== "llm") return { line: canned, words: "canned" };
  const accepted = acceptBanter(decision.reason);
  return accepted === null ? { line: canned, words: "canned" } : { line: accepted, words: "model" };
}
