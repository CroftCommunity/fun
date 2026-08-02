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
const FIRE_ON_RELEASE_KEY = "fun-bubble-fire-on-release";
const AIM_SNAP_KEY = "fun-bubble-aim-snap";
const AIM_GAIN_KEY = "fun-bubble-aim-gain";
const AIM_SETTLE_KEY = "fun-bubble-aim-settle";

/** Pure resolver: an explicit stored "on"/"off" wins; otherwise the default. */
export function resolveBool(stored: string | null, fallback: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return fallback;
}

/** Bounds + default for a numeric setting. */
export interface NumberSpec {
  min: number;
  max: number;
  fallback: number;
}

/** Pure resolver for a numeric setting: parse the stored string, round to a
 *  whole number and clamp into `[min, max]`; anything unparseable falls back to
 *  the default (returned as-is, so a fractional default is preserved). */
export function resolveNumber(stored: string | null, spec: NumberSpec): number {
  if (stored === null || stored.trim() === "") return spec.fallback;
  const n = Number(stored);
  if (!Number.isFinite(n)) return spec.fallback;
  return Math.max(spec.min, Math.min(spec.max, Math.round(n)));
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

function readNum(key: string, spec: NumberSpec): number {
  try {
    return resolveNumber(localStorage.getItem(key), spec);
  } catch {
    return spec.fallback;
  }
}

function writeNum(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
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

// ---------- bubble aim-control tuning (device-dependent; see the "Aim &
// controls" settings sheet) ----------

/** Fire the shot when you release the aim slider (drag-and-let-go), rather than
 *  pressing the Fire button — **off by default**. The board tap-to-fire path is
 *  unaffected. */
export function fireOnReleaseEnabled(): boolean {
  return read(FIRE_ON_RELEASE_KEY, false);
}
export function setFireOnRelease(on: boolean): void {
  write(FIRE_ON_RELEASE_KEY, on);
}

/** Snap granularity for the aim slider, in whole degrees (default 1° = no
 *  snapping). Larger steps land on a stable angle more easily on a jittery
 *  touchscreen. */
export const AIM_SNAP_SPEC: NumberSpec = { min: 1, max: 5, fallback: 1 };
export function aimSnapStep(): number {
  return readNum(AIM_SNAP_KEY, AIM_SNAP_SPEC);
}
export function setAimSnapStep(deg: number): void {
  writeNum(AIM_SNAP_KEY, deg);
}

/** Swipe gain: how many degrees a full slider sweep covers (default 160° = the
 *  whole fan, i.e. an absolute aim). Lower values give finer control over a
 *  narrower band that recenters between grabs. */
export const AIM_GAIN_SPEC: NumberSpec = { min: 20, max: 160, fallback: 160 };
export function aimSwipeGain(): number {
  return readNum(AIM_GAIN_KEY, AIM_GAIN_SPEC);
}
export function setAimSwipeGain(deg: number): void {
  writeNum(AIM_GAIN_KEY, deg);
}

/** Release settle window in milliseconds for fire-on-release: after lifting,
 *  wait this long before firing (re-grabbing cancels). Default 150ms. Only
 *  meaningful when fire-on-release is on. */
export const AIM_SETTLE_SPEC: NumberSpec = { min: 0, max: 400, fallback: 150 };
export function aimSettleMs(): number {
  return readNum(AIM_SETTLE_KEY, AIM_SETTLE_SPEC);
}
export function setAimSettleMs(ms: number): void {
  writeNum(AIM_SETTLE_KEY, ms);
}
