//! Shared, persisted game settings — standard across every game on the shelf.
//!
//! A pure `resolveBool` (unit-tested) plus localStorage-backed accessors with
//! sane defaults, so a fresh player gets hints and honest assistance-declaration
//! on. Games read these; a game's settings UI writes them. Cosmetic/preference
//! settings degrade (session-only) rather than failing loud if storage is denied.

const HINTS_KEY = "fun-hints";
const ASSIST_KEY = "fun-declare-assistance";
const AUTOPLAY_KEY = "fun-autoplay";

/** Pure resolver: an explicit stored "on"/"off" wins; otherwise the default. */
export function resolveBool(stored: string | null, fallback: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return fallback;
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
