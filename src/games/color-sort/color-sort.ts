//! The Color Sort board over the `color-sort-wasm` binding. A water/ball/bolt
//! sort puzzle: tap a tube to pick it up, tap another to pour. The core owns
//! every rule — legality, the maximal-run pour, win/deadlock — and the run
//! replays byte-identically from `(packed seed, moves)`, so the result is a
//! verifiable `pond-outcome` shareable via `?r=`.
//!
//! One engine, three skins: water tubes, ball tubes, and nut-and-bolt posts are
//! pure rendering of the identical state (the equivalence theorem), toggled
//! instantly. Fruit icons are the colourblind guarantee.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec } from "../../game-frame.js";
import type { Progress } from "../../progress.js";
import {
  DAILY_UNLOCK_SOLVES,
  emptyRecord,
  readRecord,
  recordSolve,
  solvesToDaily,
  writeRecord,
  type GameRecord,
  type InProgress,
} from "../../record.js";
import type { SettingRow } from "../../settings-sheet.js";
import { today } from "../../shelf.js";
import { ColorSort, type BoardView, type Move } from "./color-sort-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type ColorSortEnvelope,
  type VerifyResult,
} from "./color-sort-outcome.js";
import { dayIndexUTC } from "../share.js";
import { runPour, type PourPlan, type RunningPour } from "./pour.js";
import { ColorSortSound, cueFor, type Cue, type CueKind, type PlayLog } from "./sound.js";
import {
  colorSortIconsFor,
  colorSortPourSpeed,
  colorSortSkin,
  colorSortStrict,
  declareAssistanceEnabled,
  hintsEnabled,
  iconsDefaultFor,
  setColorSortIcons,
  setColorSortPourSpeed,
  setColorSortSkin,
  setColorSortStrict,
  type ColorSortSkin,
  type PourSpeed,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __colorSort?: {
      game: ColorSort;
      refresh: () => void;
      select: (t: number) => void;
      tapTube: (t: number) => void;
      board: () => BoardView;
      seed: bigint;
      startEndless: (level: number) => void;
      /** The most recent pour's plan (mock E3.x reads it back). */
      lastPour: PourPlan | null;
      /** Every sound attempt, and the pure cue table (mock E8.1). */
      sound: { log: readonly PlayLog[]; cue: (skin: ColorSortSkin, kind: CueKind) => Cue };
    };
  }
}

/** The fixed colour-id → fruit-icon map (brief §6), in colour-id order. */
const ICONS = ["🍎", "🍋", "🍇", "🥝", "🫐", "🍊", "🍓", "🥥", "🟣", "🌽", "🥕", "🍑"];
/** The same colours as words, for the live region ("Poured 2 lemon into tube 4"). */
const NAMES = ["apple", "lemon", "grape", "kiwi", "blueberry", "orange", "strawberry", "coconut", "purple", "corn", "carrot", "peach"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

// ---------- the result screen (reuses the shared sol- result styling) ----------

function headline(env: ColorSortEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  const clean = env.payload.result === "Won" && env.payload.assistance === false;
  return clean
    ? `Solved clean in ${env.payload.move_count} moves — verifiable`
    : `Solved in ${env.payload.move_count} moves — verifiable`;
}

export interface ResultOpts {
  par?: number;
  shareLine?: string;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  playAgainLabel?: string;
  shared?: boolean;
}

/** Build the Color Sort result screen: outcome headline, verification badge, the
 *  record (result / moves / par / seed / hash), and controls. */
export function renderResultScreen(
  env: ColorSortEnvelope,
  verification: VerifyResult,
  opts: ResultOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, verification)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every pour against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result === "Won" ? "Solved" : rec.result);
  row("Moves", String(rec.move_count));
  if (opts.par) row("Par", String(opts.par));
  row("Play", rec.assistance === false ? "no assistance" : rec.assistance ? "with assistance" : "—");
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

  if (opts.shareLine) {
    section.append(el("p", { class: "cs-share-line", "data-share-line": opts.shareLine }, opts.shareLine));
  }

  const controls = el("div", { class: "sol-result-controls" });
  if (opts.onReverify) {
    const b = el("button", { type: "button", class: "sol-reverify" }, "Re-verify");
    b.addEventListener("click", opts.onReverify);
    controls.append(b);
  }
  if (opts.shareUrl) {
    controls.append(
      el("a", { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl }, "Share this result"),
    );
  }
  if (opts.onPlayAgain) {
    const b = el("button", { type: "button", class: "sol-again" }, opts.playAgainLabel ?? "Play again");
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- persistence: the game record (src/record.ts; plan D9) ----------
//
// One `$type`-shaped record per game — stats (the Daily gate reads `played`) and
// the deal in progress — through the local substrate. The three ad-hoc keys this
// game kept before (`color-sort/stats`, `color-sort/endless`, `color-sort/daily/…`)
// are read once, folded in, and left behind.

const GAME_ID = "color-sort";

function legacy<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${GAME_ID}/${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The record, migrating the pre-record keys the first time. */
function record(): GameRecord {
  const r = readRecord(GAME_ID);
  if (r) return r;
  const stats = legacy<{ solved: number; strictSolved: number; streak: number; maxStreak: number; lastDay: number }>("stats");
  const endless = legacy<{ bestLevel: number }>("endless");
  const fresh = emptyRecord(GAME_ID);
  const migrated: GameRecord = {
    ...fresh,
    stats: {
      ...fresh.stats,
      solved: stats?.solved ?? 0,
      strictSolved: stats?.strictSolved ?? 0,
      streak: stats?.streak ?? 0,
      maxStreak: stats?.maxStreak ?? 0,
      lastDay: stats?.lastDay ?? -1,
      bestLevel: endless?.bestLevel ?? 1,
      played: stats?.solved ?? 0,
    },
  };
  return migrated;
}

function saveRecord(r: GameRecord): void {
  writeRecord({ ...r, updatedAt: new Date().toISOString() });
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

/** The poster's chip: today's puzzle, once the Daily is unlocked (mock E1.4). */
export function colorSortChip(): string | null {
  const r = record();
  if (solvesToDaily(r) > 0) return null;
  const day = dayIndexUTC(new Date());
  const p = r.inProgress;
  const today = p && p.mode === "daily" && p.level === day ? p : null;
  const par = today?.par ? ` · par ${today.par}` : "";
  const state = today?.solved ? "solved" : today && today.moves.length > 0 ? "in progress" : "not yet played";
  return `Today's puzzle${par} · ${state}`;
}

// ---------- the game module ----------

type ModeChoice = "daily" | "endless";

// The New game card's choice lives at module scope: the poster renders the card
// before the module exists, and the module reads it when a game starts.
// Endless first (plan D5/D6): a first-timer lands on level 1, not a par-32 daily.
let chosenMode: ModeChoice = "endless";

/** The New game card: Endless from your best level, or — after five solves — today's puzzle. */
export function colorSortSetupRows(): SettingRow[] {
  const toGo = solvesToDaily(record());
  const locked = toGo > 0;
  if (locked) chosenMode = "endless";
  return [
    {
      kind: "choice",
      id: "mode",
      label: "Mode",
      hint: locked
        ? `Endless keeps going from your best level, adding a colour as you climb. Daily — one fixed puzzle a day, the same for everyone, with a par — unlocks after ${DAILY_UNLOCK_SOLVES} solves · ${toGo} to go.`
        : "Endless keeps going from your best level, adding a colour as you climb; Daily is one fixed puzzle a day, the same for everyone, with a par to beat.",
      value: chosenMode,
      options: [
        { value: "endless", label: "Endless" },
        { value: "daily", label: locked ? "Daily 🔒" : "Daily", disabled: locked },
      ],
      onChange: (v) => {
        chosenMode = v === "daily" && !locked ? "daily" : "endless";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const colorSortSetup = (): SettingRow[] => colorSortSetupRows();

/** Construct a fresh Color Sort module (the registry `load`). */
export function colorSortModule(): GameModule {
  let game: ColorSort | null = null;
  let verifier: ColorSort | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "endless" = "daily";
  let level = 1;
  let seed = 0n;
  let skin: ColorSortSkin = colorSortSkin();
  let selected: number | null = null;
  let frame: GameFrame | null = null;
  let pendingResume: Progress | null = null;
  let toasted = false;
  /** The deadlock toast fires once per stuck position, not on every re-render of it. */
  let deadlockToasted = false;
  // The pour to show on the next render — the core has already applied it; the
  // re-rendered DOM is the true state and the animation plays FROM the old one.
  let pendingPour: {
    from: number;
    to: number;
    units: number;
    color: number;
    targetBefore: number;
    sourceAfter: number;
    reverse: boolean;
  } | null = null;
  let running: RunningPour | null = null;
  let lastPour: PourPlan | null = null;
  const sound = new ColorSortSound();
  /** Tubes already celebrated as complete in this deal (the beat fires once per tube). */
  let celebrated = new Set<number>();
  /** The solve of this deal has been written to the record (once, however the win arrived). */
  let solveRecorded = false;
  /** `?fast=1`: every pour collapses to a frame, for the browser suite (mock E3.7). */
  let fast = false;
  const pourSpeed = (): PourSpeed => (fast ? "off" : colorSortPourSpeed());

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const strict = (): boolean => colorSortStrict();
  const iconsOn = (): boolean => colorSortIconsFor(skin);

  // ---- persistence of the in-progress deal: the record's `inProgress` ----
  const persist = (solved = false): void => {
    if (!game) return;
    const b = game.board();
    const r = record();
    const inProgress: InProgress = {
      mode,
      level: mode === "daily" ? dayIndexUTC(new Date()) : level,
      seed: seed.toString(),
      moves: replayMoves().map((m) => [m.from, m.to] as const),
      ...(mode === "daily" ? { par: b.par, solved, strict: strict() } : {}),
    };
    saveRecord({ ...r, inProgress, stats: { ...r.stats, bestLevel: Math.max(r.stats.bestLevel, mode === "endless" ? level : 1) } });
  };

  // The moves played so far, reconstructed from the outcome record (the binding
  // owns the move list; this reads it back for persistence/replay).
  const replayMoves = (): Move[] => {
    if (!game) return [];
    const env = game.outcome(false) as ColorSortEnvelope;
    return env.payload.moves;
  };

  // ---- rendering ----
  const palette = (): string[] => {
    const cs = getComputedStyle(document.documentElement);
    return Array.from({ length: 12 }, (_, i) => cs.getPropertyValue(`--cs-c${i}`).trim() || "#888");
  };

  const renderTube = (b: BoardView, t: number, colors: string[]): HTMLElement => {
    const tube = b.tubes[t]!;
    const locked = b.locked[t]!;
    const isSource = selected === t;
    const isTarget =
      selected !== null && b.moves.some((m) => m.from === selected && m.to === t);
    const cls = [
      "cs-tube",
      locked ? "locked" : "",
      isSource ? "selected" : "",
      isTarget ? "legal" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const label = tube.length
      ? `Tube ${t + 1}: ${tube.map((c) => ICONS[c] ?? c).join(" ")}${locked ? " (solved)" : ""}`
      : `Tube ${t + 1}: empty`;
    const btn = el("button", {
      type: "button",
      class: cls,
      "data-tube": String(t),
      "aria-label": label,
      "aria-pressed": String(isSource),
    });
    // Units stack from the bottom (flex column-reverse in CSS). Each slot is a
    // full-width centring box; a filled slot holds a nested unit (the fill / ball
    // / nut) so every skin centres its unit and its icon. The pour animation
    // (pour.ts) finds the arrived units and the emptied slots by index.
    const stack = el("div", { class: "cs-stack" });
    for (let i = 0; i < b.cap; i++) {
      const slot = el("div", { class: "cs-slot" });
      if (i < tube.length) {
        const c = tube[i]!;
        const unit = el("div", { class: "cs-unit" });
        unit.style.setProperty("--cs-fill", colors[c] ?? "#888");
        unit.setAttribute("data-color", String(c));
        if (iconsOn()) unit.append(el("span", { class: "cs-icon", "aria-hidden": "true" }, ICONS[c] ?? ""));
        slot.append(unit);
      }
      stack.append(slot);
    }
    if (locked) {
      if (celebrated.has(t)) btn.classList.add("cs-complete-done");
      btn.append(el("div", { class: "cs-cap", "aria-hidden": "true" }));
    }
    btn.append(stack);
    return btn;
  };

  const renderBoard = (b: BoardView): HTMLElement => {
    const colors = palette();
    const board = el("div", {
      class: `cs-board cs-skin-${skin}${iconsOn() ? " cs-icons" : ""}`,
      role: "group",
      "aria-label": "Color Sort board",
    });
    for (let t = 0; t < b.tubes.length; t++) board.append(renderTube(b, t, colors));
    return board;
  };

  // --- what the frame shows: moves and par, the mode chip, verbs, the New game card, preferences ---
  const spec = (): GameFrameSpec => {
    const b = game?.board();
    const hints = hintsEnabled();
    // The dock, left to right, as mock E draws it: Undo · Hint · New game · Restart
    // (the frame appends Settings). Strict takes Undo away rather than greying it.
    const verbs: GameFrameSpec["verbs"] = [
      ...(strict() ? [] : [{ id: "undo", label: "Undo", icon: "↶", onPress: doUndo }]),
      hints
        ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
        : { id: "stuck", label: "I’m stuck", icon: "⇥", onPress: declareStuck },
      { id: "new", label: "New game", icon: "＋", onPress: (btn: HTMLButtonElement) => frame?.openSheet("setup", btn) },
      { id: "restart", label: "Restart", icon: "↺", onPress: doRestart },
    ];
    return {
      title: "Color Sort",
      mode: mode === "daily" ? "Daily" : `Level ${level}`,
      // Three stats for the life of the frame (mock E2.1): moves · the mark to beat
      // (par on a daily, the level in endless) · the best level reached.
      meters: [
        { kind: "stat", id: "moves", value: b?.moveCount ?? 0, label: "moves" },
        mode === "daily"
          ? { kind: "stat", id: "mark", value: b?.par ? b.par : "—", label: "par" }
          : { kind: "stat", id: "mark", value: level, label: "level" },
        { kind: "stat", id: "best", value: bestLevel(), label: "best" },
      ],
      verbs,
      setup: colorSortSetupRows(),
      preferences: [
        {
          kind: "choice",
          id: "skin",
          label: "Skin",
          hint: "The same puzzle three ways — instant, and never changes the puzzle.",
          value: skin,
          options: [
            { value: "water", label: "Water" },
            { value: "ball", label: "Ball" },
            { value: "bolt", label: "Bolt" },
          ],
          onChange: (v) => {
            skin = v as ColorSortSkin;
            setColorSortSkin(skin);
            rebuild();
          },
        },
        {
          kind: "choice",
          id: "pour-speed",
          label: "Pour speed",
          hint: "How long a pour takes to play out. Off keeps the count and the target and drops the motion — it is what reduced motion picks.",
          value: colorSortPourSpeed(),
          options: [
            { value: "slow", label: "Slow" },
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Fast" },
            { value: "off", label: "Off" },
          ],
          onChange: (v) => {
            setColorSortPourSpeed(v as PourSpeed);
          },
        },
        {
          kind: "toggle",
          id: "icons",
          label: "Fruit icons (colourblind)",
          hint: `A distinct shape on each colour so the board reads without hue. Icons default ${iconsDefaultFor(skin) ? "on" : "off"} for the ${skin} skin; your choice overrides it.`,
          value: iconsOn(),
          onChange: (on) => {
            setColorSortIcons(on);
            rebuild();
          },
        },
        {
          kind: "toggle",
          id: "strict",
          label: "Strict mode (no undo)",
          hint: "Takes the Undo verb away; a pour is final.",
          value: strict(),
          onChange: (on) => {
            setColorSortStrict(on);
            rebuild();
          },
        },
      ],
      onStart: () => {
        if (chosenMode === "daily") void startDaily();
        else void startEndless(bestLevel());
      },
    };
  };
  const declare = (): void => frame?.update(spec());

  function render(): void {
    if (disposed || !container || !game) return;
    const b = game.board();
    running?.cancel();
    running = null;
    if (b.won) {
      const last = pendingPour;
      pendingPour = null;
      if (last) celebrate(last.to, b);
      if (!solveRecorded) {
        // Every solve counts toward the Daily gate; a daily also feeds the streak.
        solveRecorded = true;
        const day = dayIndexUTC(new Date());
        saveRecord(
          recordSolve(record(), mode === "daily" ? { kind: "daily", strict: strict(), day } : { kind: "endless", level, strict: strict(), day }),
        );
        persist(true);
      }
      void presentResult();
      return;
    }
    const wrap = el("div", { class: "cs-game" }, renderBoard(b), statusEl);
    container.replaceChildren(wrap);
    showPour(b, wrap);
    if (!toasted) {
      toasted = true;
      frame?.toast("Tap a tube, then a tube it can pour into — same colour on top, room below. Sort every colour into its own tube.", 6000);
    }
    if (b.deadlocked && !deadlockToasted) {
      deadlockToasted = true;
      frame?.toast(strict() ? "No moves left — restart from the dock." : "No moves left — undo or restart from the dock.", 6000);
    } else if (!b.deadlocked) {
      deadlockToasted = false;
    }
    declare();
  }

  /** Play the pending pour over the just-rendered board, then the completion beat if a tube locked. */
  const showPour = (b: BoardView, wrap: HTMLElement): void => {
    const pp = pendingPour;
    pendingPour = null;
    if (!pp) return;
    const board = wrap.querySelector<HTMLElement>(".cs-board");
    const source = wrap.querySelector<HTMLElement>(`.cs-tube[data-tube="${pp.from}"]`);
    const target = wrap.querySelector<HTMLElement>(`.cs-tube[data-tube="${pp.to}"]`);
    if (!board || !source || !target) return;
    const speed = pourSpeed();
    running = runPour(
      {
        board,
        source,
        target,
        units: pp.units,
        color: palette()[pp.color] ?? "#888",
        targetBefore: pp.targetBefore,
        sourceAfter: pp.sourceAfter,
        icon: iconsOn() ? ICONS[pp.color] : undefined,
      },
      { skin, speed, from: pp.from, to: pp.to, reverse: pp.reverse },
    );
    lastPour = running.plan;
    exposeHook();
    if (!pp.reverse) sound.play(skin, "pour", pp.units);
    setStatus(`${pp.reverse ? "Undid: poured" : "Poured"} ${pp.units} ${NAMES[pp.color] ?? "unit"} into tube ${pp.to + 1}.`);
    if (!pp.reverse) celebrate(pp.to, b, target);
  };

  /** The tube-complete beat (mock E proposal 4): once per tube per deal. */
  const celebrate = (t: number, b: BoardView, tubeEl?: HTMLElement | null): void => {
    if (!b.locked[t] || celebrated.has(t)) return;
    celebrated.add(t);
    const target = tubeEl ?? container?.querySelector<HTMLElement>(`.cs-tube[data-tube="${t}"]`);
    if (target) {
      target.classList.add("cs-complete");
      target.append(el("span", { class: "cs-tick", "aria-hidden": "true" }, "✓"));
    }
    sound.play(skin, "complete");
  };

  const rebuild = (): void => {
    selected = null;
    render();
  };

  // ---- interaction ----
  const tapTube = (t: number): void => {
    if (!game) return;
    const b = game.board();
    if (b.won) return;
    if (b.locked[t]) {
      shake(t);
      return;
    }
    if (selected === null) {
      // Select only a tube that can be a source of some legal pour.
      if (b.moves.some((m) => m.from === t)) {
        selected = t;
        setStatus(`Tube ${t + 1} selected — tap where to pour.`);
        render();
      } else {
        shake(t);
      }
      return;
    }
    if (selected === t) {
      selected = null;
      setStatus("");
      render();
      return;
    }
    const legal = b.moves.some((m) => m.from === selected && m.to === t);
    if (!legal) {
      shake(t);
      return;
    }
    const from = selected;
    selected = null;
    const toLenBefore = b.tubes[t]!.length;
    const color = b.tubes[from]![b.tubes[from]!.length - 1]!;
    const status = game.pour(from, t);
    if (status !== "applied") {
      render();
      return;
    }
    const after = game.board();
    pendingPour = {
      from,
      to: t,
      units: Math.max(1, after.tubes[t]!.length - toLenBefore),
      color,
      targetBefore: toLenBefore,
      sourceAfter: after.tubes[from]!.length,
      reverse: false,
    };
    persist();
    afterMove();
  };

  const afterMove = (): void => {
    render();
    if (!game) return;
    const b = game.board();
    if (b.won) return; // render() recorded the solve and routed to the result
    if (b.deadlocked) setStatus("No moves left — restart" + (strict() ? "." : " or undo."));
  };

  const shake = (t: number): void => {
    const tubeEl = container?.querySelector<HTMLElement>(`.cs-tube[data-tube="${t}"]`);
    if (!tubeEl) return;
    tubeEl.classList.remove("cs-shake");
    // reflow to restart the animation
    void tubeEl.offsetWidth;
    tubeEl.classList.add("cs-shake");
    window.setTimeout(() => tubeEl.classList.remove("cs-shake"), 300);
  };

  const doUndo = (): void => {
    if (!game || strict()) return;
    const last = replayMoves().at(-1);
    const before = game.board();
    if (game.undo()) {
      game.markAssistance();
      selected = null;
      if (last) {
        // The pour, reversed: the units come back out of `to` into `from` (mock E4.2).
        const after = game.board();
        const units = before.tubes[last.to]!.length - after.tubes[last.to]!.length;
        const color = after.tubes[last.from]![after.tubes[last.from]!.length - 1]!;
        pendingPour = {
          from: last.to,
          to: last.from,
          units: Math.max(1, units),
          color,
          targetBefore: after.tubes[last.from]!.length - units,
          sourceAfter: after.tubes[last.to]!.length,
          reverse: true,
        };
        celebrated.delete(last.to);
      }
      persist();
      render();
      setStatus("Undid the last pour (counts as assistance).");
    }
  };

  const doRestart = (): void => {
    if (!game) return;
    game.restart();
    celebrated = new Set();
    solveRecorded = false;
    selected = null;
    setStatus("Restarted this deal.");
    persist();
    render();
  };

  const showHint = (): void => {
    if (!game) return;
    const b = game.board();
    if (b.won) return;
    const mv = game.hint();
    if (!mv) {
      setStatus("No solving move from here — restart" + (strict() ? "." : " or undo."));
      return;
    }
    game.markAssistance();
    selected = mv.from;
    render();
    // Flag the suggested target.
    container
      ?.querySelector<HTMLElement>(`.cs-tube[data-tube="${mv.to}"]`)
      ?.classList.add("cs-hint-to");
    setStatus(`Hint: pour tube ${mv.from + 1} → tube ${mv.to + 1} (counts as assistance).`);
  };

  const declareStuck = (): void => {
    if (!game) return;
    const b = game.board();
    const hadMove = b.moves.length > 0;
    setStatus(
      hadMove
        ? "Ended — a legal move was still available."
        : "Ended — no legal move remained (a genuine dead end).",
    );
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || !game) return;
    if (e.key === "Escape") {
      selected = null;
      render();
      return;
    }
    if (e.key === "u" || e.key === "U") {
      doUndo();
      return;
    }
    // Number keys 1..9 select/act on the matching tube (accessible shortcut on
    // top of the natively-focusable tube buttons).
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= game.board().tubes.length) {
      tapTube(n - 1);
      e.preventDefault();
    }
  };

  // ---- result / share ----
  const shareLineFor = (b: BoardView): string => {
    const bits = [`Color Sort ${mode === "daily" ? todayKey() : `L${level}`}`, `${b.moveCount} moves`];
    if (b.par) bits.push(`par ${b.par}`);
    bits.push(strict() ? "Strict" : "Free");
    return bits.join(" · ");
  };

  const shareUrlFor = async (env: ColorSortEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const presentResult = async (): Promise<void> => {
    declare();
    if (!container || !game || !verifier) return;
    const b = game.board();
    const env = game.outcome(declareAssistanceEnabled()) as ColorSortEnvelope;
    const par = b.par;
    const shareLine = mode === "daily" ? shareLineFor(b) : undefined;
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const v = verifyRecord(verifier, env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        par,
        shareLine,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain:
          mode === "endless"
            ? () => void startEndless(level + 1)
            : () => void startDaily(),
        playAgainLabel: mode === "endless" ? "Next level" : "Play again",
      });
    container.replaceChildren(build());
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container || !verifier) return;
    let env: ColorSortEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const v = verifyRecord(verifier, env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        shared: true,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
        playAgainLabel: "Play today’s puzzle",
      });
    container.replaceChildren(build());
  };

  // ---- lifecycle ----
  const bestLevel = (): number => record().stats.bestLevel;
  const savedGame = (): InProgress | null => record().inProgress;
  const savedMoves = (p: InProgress): Move[] => p.moves.map(([from, to]) => ({ from, to }));

  const applyMoves = (moves: Move[]): void => {
    if (!game) return;
    for (const mv of moves) game.pour(mv.from, mv.to);
  };

  /** Resume is replay: the same deal (today's, or the endless level), then the store's pours. */
  const applyResume = (p: Progress): void => {
    if (!game || disposed) return;
    const rec = p.record as { level?: unknown; moves?: unknown };
    const moves = Array.isArray(rec.moves) ? (rec.moves as Move[]) : [];
    if (typeof p.setup.mode === "string" && p.setup.mode.startsWith("daily:")) {
      mode = chosenMode = "daily";
      game.newDaily(dayIndexUTC(new Date()));
    } else {
      mode = chosenMode = "endless";
      level = Math.max(1, typeof rec.level === "number" ? rec.level : bestLevel());
      game.newEndless(level);
    }
    seed = game.seed();
    applyMoves(moves);
    selected = null;
    setStatus("");
    persist();
    exposeHook();
    render();
  };

  async function startDaily(): Promise<void> {
    if (!game || disposed) return;
    mode = "daily";
    chosenMode = "daily";
    const day = dayIndexUTC(new Date());
    game.newDaily(day);
    seed = game.seed();
    celebrated = new Set();
    solveRecorded = false;
    // Resume today's in-progress deal if the record holds it.
    const saved = savedGame();
    const today = saved && saved.mode === "daily" && saved.level === day && saved.seed === seed.toString() ? saved : null;
    if (today && !today.solved) applyMoves(savedMoves(today));
    selected = null;
    setStatus("");
    console.debug(`[color-sort] daily seed=${seed}`);
    persist(today?.solved ?? false);
    exposeHook();
    if (today?.solved) {
      // Already solved today — replay to the solved state and show the result.
      solveRecorded = true;
      applyMoves(savedMoves(today));
      void presentResult();
      return;
    }
    render();
  }

  async function startEndless(atLevel: number): Promise<void> {
    if (!game || disposed) return;
    mode = "endless";
    chosenMode = "endless";
    level = Math.max(1, atLevel);
    game.newEndless(level);
    seed = game.seed();
    celebrated = new Set();
    solveRecorded = false;
    const saved = savedGame();
    if (saved && saved.mode === "endless" && saved.level === level && saved.seed === seed.toString()) applyMoves(savedMoves(saved));
    selected = null;
    setStatus("");
    console.debug(`[color-sort] endless level=${level} seed=${seed}`);
    persist();
    exposeHook();
    render();
  }

  const exposeHook = (): void => {
    if (!game) return;
    window.__colorSort = {
      game,
      refresh: () => render(),
      select: (t: number) => {
        selected = t;
        render();
      },
      tapTube: (t: number) => tapTube(t),
      board: () => game!.board(),
      seed,
      startEndless: (l: number) => void startEndless(l),
      lastPour,
      sound: { log: sound.log, cue: (s: ColorSortSkin, k: CueKind) => cueFor(s, k) },
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      skin = colorSortSkin();
      frame?.onSettingsChange(() => rebuild()); // Hints flips the verb
      declare();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Color Sort…"));
      document.addEventListener("keydown", onKeydown);
      // Delegate tube taps.
      c.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(".cs-tube");
        if (btn?.dataset.tube !== undefined) tapTube(Number(btn.dataset.tube));
      });
      void (async () => {
        try {
          game = await ColorSort.load();
          verifier = await ColorSort.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
          }
          return;
        }
        if (disposed) return;
        const url = new URL(location.href);
        fast = url.searchParams.get("fast") === "1";
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          applyResume(p);
          return;
        }
        if (url.searchParams.get("daily") === "1") {
          await startDaily();
          return;
        }
        const levelParam = url.searchParams.get("level");
        if (levelParam !== null) {
          await startEndless(Number(levelParam) || 1);
          return;
        }
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          mode = "endless";
          level = 1;
          game.newSeed(Number(seedParam) >>> 0, 10, 2);
          seed = game.seed();
          selected = null;
          exposeHook();
          render();
          return;
        }
        if (chosenMode === "endless") await startEndless(bestLevel());
        else await startDaily();
      })();
    },
    unmount(): void {
      disposed = true;
      running?.cancel();
      running = null;
      sound.close();
      document.removeEventListener("keydown", onKeydown);
      delete window.__colorSort;
      container?.replaceChildren();
      container = null;
      frame = null;
      game = null;
      verifier = null;
    },
    // --- the progress store: which deal; the game's own save carries the pours ---
    snapshot(): Progress {
      const b = game?.board();
      const now = new Date().toISOString();
      const done = b?.won ?? false;
      const where = mode === "daily" ? "Daily" : `Level ${level}`;
      const line = `${where} · move ${b?.moveCount ?? 0}${b?.par ? ` · par ${b.par}` : ""}`;
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: { mode: mode === "daily" ? `daily:${today(new Date())}` : "free", level, seed: seed.toString() },
        record: { seed: seed.toString(), level, moves: replayMoves() },
        summary: { line: done ? `${line} · solved` : line },
      };
    },
    resume(p: Progress): void {
      if (game) applyResume(p);
      else pendingResume = p;
    },
  };
}
