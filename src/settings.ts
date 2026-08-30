//! Shared, persisted game settings — standard across every game on the shelf.
//!
//! A pure `resolveBool` (unit-tested) plus localStorage-backed accessors with
//! sane defaults, so a fresh player gets hints and honest assistance-declaration
//! on. Games read these; a game's settings UI writes them. Cosmetic/preference
//! settings degrade (session-only) rather than failing loud if storage is denied.

const HINTS_KEY = "fun-hints";
const MJ_TILES_KEY = "fun-mahjong-tiles";
const MJ_DIM_KEY = "fun-mahjong-dim";
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
const CONTROLS_LEFT_KEY = "fun-controls-left";

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

/** The game frame's mirror preference — **off by default**: the rail sits right of the
 *  board on desktop and the dock's verbs run left-to-right on a phone. On, both flip
 *  ("reverse control sides", plan 2026-08-30 D4). A frame-level preference, so it lives
 *  in the "Every game" section rather than with any one game. */
export function controlsOnLeft(): boolean {
  return read(CONTROLS_LEFT_KEY, false);
}
export function setControlsOnLeft(on: boolean): void {
  write(CONTROLS_LEFT_KEY, on);
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
const CHECKERS_TUTOR_KEY = "fun-checkers-tutor";

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

/** Show the engine-grounded tutor panel in checkers — **off by default**
 *  (opt-in, matching Othello and Drop 4). */
export function checkersTutorEnabled(): boolean {
  return read(CHECKERS_TUTOR_KEY, false);
}
export function setCheckersTutor(on: boolean): void {
  write(CHECKERS_TUTOR_KEY, on);
}

// ---------- chess ----------

/** Chess difficulty. **Expert**, not Perfect — chess is unsolved, so the top
 *  level is the deepest search, never a proof. */
export type ChessLevel = "Easy" | "Medium" | "Hard" | "Expert";
const CHESS_LEVELS: readonly ChessLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const CHESS_LEVEL_KEY = "fun-chess-level";

/** Pure resolver: a stored known chess level wins; otherwise the default. */
export function resolveChessLevel(stored: string | null, fallback: ChessLevel): ChessLevel {
  return CHESS_LEVELS.includes(stored as ChessLevel) ? (stored as ChessLevel) : fallback;
}

/** The colour the human plays: white (Side A, opens), black, or a coin at New game. */
export type ChessSide = "white" | "black" | "random";
const CHESS_SIDES: readonly ChessSide[] = ["white", "black", "random"];
const CHESS_SIDE_KEY = "fun-chess-side";
const CHESS_TUTOR_KEY = "fun-chess-tutor";

/** Pure resolver: a stored known side wins; otherwise the default. */
export function resolveChessSide(stored: string | null, fallback: ChessSide): ChessSide {
  return CHESS_SIDES.includes(stored as ChessSide) ? (stored as ChessSide) : fallback;
}

export function chessLevel(): ChessLevel {
  try {
    return resolveChessLevel(localStorage.getItem(CHESS_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setChessLevel(level: ChessLevel): void {
  try {
    localStorage.setItem(CHESS_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** The colour the human plays in chess — **white by default** (the opener);
 *  `"random"` is a stored preference resolved to a seat at each New game and
 *  never written back as the seat. */
export function chessSide(): ChessSide {
  try {
    return resolveChessSide(localStorage.getItem(CHESS_SIDE_KEY), "white");
  } catch {
    return "white";
  }
}
export function setChessSide(side: ChessSide): void {
  try {
    localStorage.setItem(CHESS_SIDE_KEY, side);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** Show the engine-grounded tutor panel in chess — **off by default**. */
export function chessTutorEnabled(): boolean {
  return read(CHESS_TUTOR_KEY, false);
}
export function setChessTutor(on: boolean): void {
  write(CHESS_TUTOR_KEY, on);
}

// ---------- Dots and Boxes ----------

/** Dots and Boxes difficulty. **Perfect**, not Expert — 3x3 is solved, so the
 *  top level really does play perfectly (see `crates/dots-core/RULES.md`). */
export type DotsLevel = "Easy" | "Medium" | "Hard" | "Perfect";
const DOTS_LEVELS: readonly DotsLevel[] = ["Easy", "Medium", "Hard", "Perfect"];
const DOTS_LEVEL_KEY = "fun-dots-level";

/** Pure resolver: a stored known dots level wins; otherwise the default. */
export function resolveDotsLevel(stored: string | null, fallback: DotsLevel): DotsLevel {
  return DOTS_LEVELS.includes(stored as DotsLevel) ? (stored as DotsLevel) : fallback;
}

/** Which seat the human takes: `first` opens (Side A), `second` replies. */
export type DotsSeat = "first" | "second";
const DOTS_SEATS: readonly DotsSeat[] = ["first", "second"];
const DOTS_SEAT_KEY = "fun-dots-seat";
const DOTS_TUTOR_KEY = "fun-dots-tutor";

/** Pure resolver: a stored known seat wins; otherwise the default. */
export function resolveDotsSeat(stored: string | null, fallback: DotsSeat): DotsSeat {
  return DOTS_SEATS.includes(stored as DotsSeat) ? (stored as DotsSeat) : fallback;
}

export function dotsLevel(): DotsLevel {
  try {
    return resolveDotsLevel(localStorage.getItem(DOTS_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setDotsLevel(level: DotsLevel): void {
  try {
    localStorage.setItem(DOTS_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** The human's seat — **second by default**, because 3x3 is a second-player win
 *  and opening against a perfect opponent loses by construction. */
export function dotsSeat(): DotsSeat {
  try {
    return resolveDotsSeat(localStorage.getItem(DOTS_SEAT_KEY), "second");
  } catch {
    return "second";
  }
}
/** Show the engine-grounded tutor panel in Dots — **off by default** (opt-in,
 *  matching Othello, checkers and Drop 4). */
export function dotsTutorEnabled(): boolean {
  return read(DOTS_TUTOR_KEY, false);
}
export function setDotsTutor(on: boolean): void {
  write(DOTS_TUTOR_KEY, on);
}

export function setDotsSeat(seat: DotsSeat): void {
  try {
    localStorage.setItem(DOTS_SEAT_KEY, seat);
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

/** The pour's speed (plan D3; mock E proposal 5): Slow · Normal · Fast · Off. */
export type PourSpeed = "slow" | "normal" | "fast" | "off";
const CS_POUR_SPEED_KEY = "fun-color-sort-pour-speed";

/**
 * Pure resolver: an explicit stored speed wins; otherwise `prefers-reduced-motion`
 * selects Off, and everything else is Normal. Reduced motion is the DEFAULT, not
 * a lock — a player who picks a speed under it keeps that speed (mock E5.3).
 */
export function resolvePourSpeed(stored: string | null, reducedMotion: boolean): PourSpeed {
  if (stored === "slow" || stored === "normal" || stored === "fast" || stored === "off") return stored;
  return reducedMotion ? "off" : "normal";
}

export function colorSortPourSpeed(): PourSpeed {
  const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  try {
    return resolvePourSpeed(localStorage.getItem(CS_POUR_SPEED_KEY), reduce);
  } catch {
    return resolvePourSpeed(null, reduce);
  }
}
export function setColorSortPourSpeed(speed: PourSpeed): void {
  try {
    localStorage.setItem(CS_POUR_SPEED_KEY, speed);
  } catch {
    // Storage denied (private mode): the setting still applies for the session.
  }
}

// ---------- Furrow (mancala) ----------

/** Furrow difficulty. **Expert**, not Perfect — Phase 0 could not solve the
 *  opening at 100M nodes and about 70% of a game sits above the exact
 *  threshold, so the top level searches rather than solves for most of it
 *  (see `crates/furrow-core/RULES.md`). */
export type FurrowLevel = "Easy" | "Medium" | "Hard" | "Expert";
const FURROW_LEVELS: readonly FurrowLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const FURROW_LEVEL_KEY = "fun-furrow-level";

/** Pure resolver: a stored known Furrow level wins; otherwise the default. */
export function resolveFurrowLevel(stored: string | null, fallback: FurrowLevel): FurrowLevel {
  return FURROW_LEVELS.includes(stored as FurrowLevel) ? (stored as FurrowLevel) : fallback;
}

export function furrowLevel(): FurrowLevel {
  try {
    return resolveFurrowLevel(localStorage.getItem(FURROW_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setFurrowLevel(level: FurrowLevel): void {
  try {
    localStorage.setItem(FURROW_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

const FURROW_TUTOR_KEY = "fun-furrow-tutor";

/** Show the engine-grounded tutor panel in Furrow — **off by default** (opt-in,
 *  matching Othello, checkers, Drop 4 and dots). */
export function furrowTutorEnabled(): boolean {
  return read(FURROW_TUTOR_KEY, false);
}
export function setFurrowTutor(on: boolean): void {
  write(FURROW_TUTOR_KEY, on);
}

// ---------- Cribbage ----------

/** Cribbage difficulty. Expert is exact-expectation discards and two-ply
 *  pegging with no noise — not "Perfect": pegging has no such thing, and the
 *  crib term is an expectation (see `crates/cribbage-core/RULES.md`). */
export type CribbageLevel = "Easy" | "Medium" | "Hard" | "Expert";
const CRIBBAGE_LEVELS: readonly CribbageLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const CRIBBAGE_LEVEL_KEY = "fun-cribbage-level";

/** Pure resolver: a stored known cribbage level wins; otherwise the default. */
export function resolveCribbageLevel(stored: string | null, fallback: CribbageLevel): CribbageLevel {
  return CRIBBAGE_LEVELS.includes(stored as CribbageLevel) ? (stored as CribbageLevel) : fallback;
}

export function cribbageLevel(): CribbageLevel {
  try {
    return resolveCribbageLevel(localStorage.getItem(CRIBBAGE_LEVEL_KEY), "Medium");
  } catch {
    return "Medium";
  }
}
export function setCribbageLevel(level: CribbageLevel): void {
  try {
    localStorage.setItem(CRIBBAGE_LEVEL_KEY, level);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

const CRIBBAGE_TUTOR_KEY = "fun-cribbage-tutor";

/** Show the engine-grounded tutor panel in cribbage — **off by default**. */
export function cribbageTutorEnabled(): boolean {
  return read(CRIBBAGE_TUTOR_KEY, false);
}
export function setCribbageTutor(on: boolean): void {
  write(CRIBBAGE_TUTOR_KEY, on);
}

const CRIBBAGE_MANUAL_KEY = "fun-cribbage-manual-count";

/** Count your own hands at the show (the core grades the claim; an under-count
 *  is the engine's by muggins) — **off by default**: the app counts and shows
 *  its work (plan O1, owner decision 2026-08-29). */
export function cribbageManualCount(): boolean {
  return read(CRIBBAGE_MANUAL_KEY, false);
}
export function setCribbageManualCount(on: boolean): void {
  write(CRIBBAGE_MANUAL_KEY, on);
}

/** How cribbage shows the peg board: the full three-street board on the table,
 *  two compact score bars, or no board during the deal and a recap animation of
 *  the deal's pegging once it ends (a phone's screen is the reason it exists). */
export type CribbageBoard = "board" | "bars" | "recap";
const CRIBBAGE_BOARDS: readonly CribbageBoard[] = ["board", "bars", "recap"];
const CRIBBAGE_BOARD_KEY = "fun-cribbage-board";
const CRIBBAGE_SEATS_KEY = "fun-cribbage-seats-flipped";

/** Pure resolver: a stored known board mode wins; otherwise the default. */
export function resolveCribbageBoard(stored: string | null, fallback: CribbageBoard): CribbageBoard {
  return CRIBBAGE_BOARDS.includes(stored as CribbageBoard) ? (stored as CribbageBoard) : fallback;
}

/** The peg board mode — the **full board by default**. */
export function cribbageBoard(): CribbageBoard {
  try {
    return resolveCribbageBoard(localStorage.getItem(CRIBBAGE_BOARD_KEY), "board");
  } catch {
    return "board";
  }
}
export function setCribbageBoard(mode: CribbageBoard): void {
  try {
    localStorage.setItem(CRIBBAGE_BOARD_KEY, mode);
  } catch {
    // Storage denied (private mode): the choice still applies for the session.
  }
}

/** Your hand on top and the engine's below — **off by default** (you sit at the bottom). */
export function cribbageSeatsFlipped(): boolean {
  return read(CRIBBAGE_SEATS_KEY, false);
}
export function setCribbageSeatsFlipped(on: boolean): void {
  write(CRIBBAGE_SEATS_KEY, on);
}

// ---------- Mahjong (tile faces, dim blocked tiles) ----------

/** The two face sets — pure rendering of the same board. */
export type MahjongTileStyle = "classic" | "large";

/** Pure resolver: a stored valid style wins, else `classic`. */
export function resolveMahjongTileStyle(stored: string | null): MahjongTileStyle {
  return stored === "large" ? "large" : "classic";
}

/** The chosen tile faces — **classic by default**. */
export function mahjongTileStyle(): MahjongTileStyle {
  try {
    return resolveMahjongTileStyle(localStorage.getItem(MJ_TILES_KEY));
  } catch {
    return "classic";
  }
}
export function setMahjongTileStyle(style: MahjongTileStyle): void {
  try {
    localStorage.setItem(MJ_TILES_KEY, style);
  } catch {
    // Storage denied (private mode): the setting still applies for the session.
  }
}

/** Dim the tiles that are not free — **on by default** (the free ones stand out). */
export function mahjongDimBlocked(): boolean {
  return read(MJ_DIM_KEY, true);
}
export function setMahjongDimBlocked(on: boolean): void {
  write(MJ_DIM_KEY, on);
}
