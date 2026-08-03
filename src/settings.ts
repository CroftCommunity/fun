//! Shared, persisted game settings — standard across every game on the shelf.
//!
//! A pure `resolveBool` (unit-tested) plus localStorage-backed accessors with
//! sane defaults, so a fresh player gets hints and honest assistance-declaration
//! on. Games read these; a game's settings UI writes them. Cosmetic/preference
//! settings degrade (session-only) rather than failing loud if storage is denied.

const HINTS_KEY = "fun-hints";
const ASSIST_KEY = "fun-declare-assistance";
const AUTOPLAY_KEY = "fun-autoplay";
const AIM_GUIDE_KEY = "fun-bubble-aim-guide";
const DROP4_LEVEL_KEY = "fun-drop4-level";
const DROP4_MARK_KEY = "fun-drop4-mark";

/** Pure resolver: an explicit stored "on"/"off" wins; otherwise the default. */
export function resolveBool(stored: string | null, fallback: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return fallback;
}

/** Drop 4 difficulty level (opponent strength). */
export type Drop4Level = "Easy" | "Medium" | "Hard" | "Perfect";
const DROP4_LEVELS: readonly Drop4Level[] = ["Easy", "Medium", "Hard", "Perfect"];

/** Pure resolver: a stored known level wins; otherwise the default. */
export function resolveLevel(stored: string | null, fallback: Drop4Level): Drop4Level {
  return DROP4_LEVELS.includes(stored as Drop4Level) ? (stored as Drop4Level) : fallback;
}

/** Drop 4 player disc mark (which glyph/colour the human plays). */
export type Drop4Mark = "x" | "o";

/** Pure resolver: a stored "x"/"o" wins; otherwise the default. */
export function resolveMark(stored: string | null, fallback: Drop4Mark): Drop4Mark {
  return stored === "x" || stored === "o" ? stored : fallback;
}

function read(key: string, fallback: boolean): boolean {
  try {
    return resolveBool(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function write(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Storage denied (private mode): the setting still applies for the session.
  }
}

/** Hints (a pointer to a legal move) — **on by default**. When off, the
 *  "I'm stuck" control ends the game instead of pointing at a move. */
export function hintsEnabled(): boolean {
  return read(HINTS_KEY, true);
}
export function setHintsEnabled(on: boolean): void {
  write(HINTS_KEY, on);
}

/** Declare assistance (undo/hint use) in the outcome record — **on by default**. */
export function declareAssistanceEnabled(): boolean {
  return read(ASSIST_KEY, true);
}
export function setDeclareAssistance(on: boolean): void {
  write(ASSIST_KEY, on);
}

/** Auto-play cards to the foundations when it is provably safe — **off by
 *  default** (opt-in). Safe moves are obvious, so this is a convenience, not
 *  assistance. */
export function autoPlayEnabled(): boolean {
  return read(AUTOPLAY_KEY, false);
}
export function setAutoPlay(on: boolean): void {
  write(AUTOPLAY_KEY, on);
}

/** The bubble shooter's dotted trajectory preview (the aim guide) — **on by
 *  default**. Turning it off is a harder aiming challenge; it is a display
 *  preference, not outcome assistance (the shot still resolves identically). */
export function aimGuideEnabled(): boolean {
  return read(AIM_GUIDE_KEY, true);
}
export function setAimGuide(on: boolean): void {
  write(AIM_GUIDE_KEY, on);
}

/** Drop 4 opponent difficulty — **Medium by default**. */
export function drop4Level(): Drop4Level {
  try {
    return resolveLevel(localStorage.getItem(DROP4_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setDrop4Level(level: Drop4Level): void {
  try {
    localStorage.setItem(DROP4_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** The disc the human plays in Drop 4 — **✕ by default** (the opening side). */
export function drop4Mark(): Drop4Mark {
  try {
    return resolveMark(localStorage.getItem(DROP4_MARK_KEY), "x");
  } catch {
    return "x";
  }
}
export function setDrop4Mark(mark: Drop4Mark): void {
  try {
    localStorage.setItem(DROP4_MARK_KEY, mark);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}
