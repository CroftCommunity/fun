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
const DROP4_TUTOR_KEY = "fun-drop4-tutor";
const FIRE_ON_RELEASE_KEY = "fun-bubble-fire-on-release";
const AIM_SNAP_KEY = "fun-bubble-aim-snap";
const AIM_GAIN_KEY = "fun-bubble-aim-gain";
const AIM_SETTLE_KEY = "fun-bubble-aim-settle";
const ALIGN_HAPTICS_KEY = "fun-align-haptics";
const ALIGN_MOVE_SPEED_KEY = "fun-align-move-speed";
const CS_SKIN_KEY = "fun-color-sort-skin";
const CS_ICONS_KEY = "fun-color-sort-icons";
const CS_STRICT_KEY = "fun-color-sort-strict";

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
/** Show the engine-grounded tutor panel in Drop 4 — **off by default** (opt-in
 *  coaching; the game plays clean without it). */
export function drop4TutorEnabled(): boolean {
  return read(DROP4_TUTOR_KEY, false);
}
export function setDrop4Tutor(on: boolean): void {
  write(DROP4_TUTOR_KEY, on);
}

export function setDrop4Mark(mark: Drop4Mark): void {
  try {
    localStorage.setItem(DROP4_MARK_KEY, mark);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

// ---------- Othello ----------

/** Othello difficulty level (opponent strength). Note: **Expert**, not Perfect —
 *  Othello is unsolved from the opening, so there is no perfect level. */
export type OthelloLevel = "Easy" | "Medium" | "Hard" | "Expert";
const OTHELLO_LEVELS: readonly OthelloLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const OTHELLO_LEVEL_KEY = "fun-othello-level";

/** Pure resolver: a stored known Othello level wins; otherwise the default. */
export function resolveOthelloLevel(stored: string | null, fallback: OthelloLevel): OthelloLevel {
  return OTHELLO_LEVELS.includes(stored as OthelloLevel) ? (stored as OthelloLevel) : fallback;
}

/** The disc the human plays in Othello: **black** (Side A, opens) or white. */
export type OthelloDisc = "black" | "white";
const OTHELLO_DISCS: readonly OthelloDisc[] = ["black", "white"];
const OTHELLO_DISC_KEY = "fun-othello-disc";
const OTHELLO_TUTOR_KEY = "fun-othello-tutor";

/** Pure resolver: a stored known disc wins; otherwise the default. */
export function resolveDisc(stored: string | null, fallback: OthelloDisc): OthelloDisc {
  return OTHELLO_DISCS.includes(stored as OthelloDisc) ? (stored as OthelloDisc) : fallback;
}

export function othelloLevel(): OthelloLevel {
  try {
    return resolveOthelloLevel(localStorage.getItem(OTHELLO_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setOthelloLevel(level: OthelloLevel): void {
  try {
    localStorage.setItem(OTHELLO_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** The disc the human plays in Othello — **black by default** (the opener). */
export function othelloDisc(): OthelloDisc {
  try {
    return resolveDisc(localStorage.getItem(OTHELLO_DISC_KEY), "black");
  } catch {
    return "black";
  }
}
export function setOthelloDisc(disc: OthelloDisc): void {
  try {
    localStorage.setItem(OTHELLO_DISC_KEY, disc);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** Show the engine-grounded tutor panel in Othello — **off by default** (opt-in,
 *  matching Drop 4). */
export function othelloTutorEnabled(): boolean {
  return read(OTHELLO_TUTOR_KEY, false);
}
export function setOthelloTutor(on: boolean): void {
  write(OTHELLO_TUTOR_KEY, on);
}

// ---------- checkers ----------

/** Checkers difficulty (opponent strength). **Expert**, not Perfect — checkers
 *  is not solved from the opening, so no level plays perfectly. */
export type CheckersLevel = "Easy" | "Medium" | "Hard" | "Expert";
const CHECKERS_LEVELS: readonly CheckersLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const CHECKERS_LEVEL_KEY = "fun-checkers-level";

/** Pure resolver: a stored known checkers level wins; otherwise the default. */
export function resolveCheckersLevel(stored: string | null, fallback: CheckersLevel): CheckersLevel {
  return CHECKERS_LEVELS.includes(stored as CheckersLevel) ? (stored as CheckersLevel) : fallback;
}

/** The men the human plays: **black** (Side A, opens) or white. */
export type CheckersSide = "black" | "white";
const CHECKERS_SIDES: readonly CheckersSide[] = ["black", "white"];
const CHECKERS_SIDE_KEY = "fun-checkers-side";

/** Pure resolver: a stored known side wins; otherwise the default. */
export function resolveCheckersSide(stored: string | null, fallback: CheckersSide): CheckersSide {
  return CHECKERS_SIDES.includes(stored as CheckersSide) ? (stored as CheckersSide) : fallback;
}

export function checkersLevel(): CheckersLevel {
  try {
    return resolveCheckersLevel(localStorage.getItem(CHECKERS_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setCheckersLevel(level: CheckersLevel): void {
  try {
    localStorage.setItem(CHECKERS_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** The men the human plays in checkers — **black by default** (the opener). */
export function checkersSide(): CheckersSide {
  try {
    return resolveCheckersSide(localStorage.getItem(CHECKERS_SIDE_KEY), "black");
  } catch {
    return "black";
  }
}
export function setCheckersSide(side: CheckersSide): void {
  try {
    localStorage.setItem(CHECKERS_SIDE_KEY, side);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
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

// ---------- Align touch-control tuning (device-dependent; see the Align
// settings sheet) ----------

/** Haptic feedback — a short vibration on each touch-control press — **on by
 *  default**. Degrades silently where `navigator.vibrate` is absent (desktop,
 *  iOS Safari). A display/feel preference; it never touches the outcome. */
export function alignHapticsEnabled(): boolean {
  return read(ALIGN_HAPTICS_KEY, true);
}
export function setAlignHaptics(on: boolean): void {
  write(ALIGN_HAPTICS_KEY, on);
}

/** Left/right hold sensitivity as a 1–10 speed (default 5). Higher slides
 *  faster; see `moveSpeedToMs` for the ms mapping. Handling only — input timing,
 *  not the hashed path — so every run stays verifiable. */
export const ALIGN_MOVE_SPEED_SPEC: NumberSpec = { min: 1, max: 10, fallback: 5 };
export function alignMoveSpeed(): number {
  return readNum(ALIGN_MOVE_SPEED_KEY, ALIGN_MOVE_SPEED_SPEC);
}
export function setAlignMoveSpeed(speed: number): void {
  writeNum(ALIGN_MOVE_SPEED_KEY, speed);
}

/** Pure map from a 1–10 move speed to the hold-repeat interval in ms: speed 1 →
 *  250 ms (slow), 10 → 50 ms (fast), the default 5 → 161 ms. Clamps + rounds the
 *  input so an out-of-range or fractional speed is well-defined. */
export function moveSpeedToMs(speed: number): number {
  const s = Math.max(1, Math.min(10, Math.round(speed)));
  return Math.round(250 - (s - 1) * (200 / 9));
}

// ---------- Color Sort (skin, colourblind icons, Free/Strict) ----------

/** The three render skins — all render the identical engine state. */
export type ColorSortSkin = "water" | "ball" | "bolt";

/** Pure resolver for the skin setting: a stored valid skin wins, else `water`. */
export function resolveSkin(stored: string | null): ColorSortSkin {
  return stored === "ball" || stored === "bolt" || stored === "water" ? stored : "water";
}

/** The chosen render skin — **water by default**. */
export function colorSortSkin(): ColorSortSkin {
  try {
    return resolveSkin(localStorage.getItem(CS_SKIN_KEY));
  } catch {
    return "water";
  }
}
export function setColorSortSkin(skin: ColorSortSkin): void {
  try {
    localStorage.setItem(CS_SKIN_KEY, skin);
  } catch {
    // Storage denied (private mode): the setting still applies for the session.
  }
}

/** The per-skin default for the colourblind fruit icons: **off** in water,
 *  **on** in ball and bolt (discrete-unit skins carry icons naturally; liquid
 *  reads cleaner without them — brief §6). */
export function iconsDefaultFor(skin: ColorSortSkin): boolean {
  return skin !== "water";
}

/** Whether the fruit icons are shown, for `skin`. An explicit user choice (once
 *  made) overrides the per-skin default thereafter; otherwise the per-skin
 *  default applies. Returns the resolved boolean. */
export function colorSortIconsFor(skin: ColorSortSkin): boolean {
  try {
    const stored = localStorage.getItem(CS_ICONS_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    // fall through to the per-skin default
  }
  return iconsDefaultFor(skin);
}
export function setColorSortIcons(on: boolean): void {
  try {
    localStorage.setItem(CS_ICONS_KEY, on ? "on" : "off");
  } catch {
    // Storage denied (private mode): the setting still applies for the session.
  }
}

/** Strict mode — no undo, restart only — **off by default** (Free: unlimited
 *  undo). Non-monetized, so undo is never rationed; Strict is opt-in commitment. */
export function colorSortStrict(): boolean {
  return read(CS_STRICT_KEY, false);
}
export function setColorSortStrict(on: boolean): void {
  write(CS_STRICT_KEY, on);
}
