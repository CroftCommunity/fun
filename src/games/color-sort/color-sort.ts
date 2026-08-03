//! The Color Sort board over the `color-sort-wasm` binding. A water/ball/bolt
//! sort puzzle: tap a tube to pick it up, tap another to pour. The core owns
//! every rule — legality, the maximal-run pour, win/deadlock — and the run
//! replays byte-identically from `(packed seed, moves)`, so the result is a
//! verifiable `pond-outcome` shareable via `?r=`.
//!
//! One engine, three skins: water tubes, ball tubes, and nut-and-bolt posts are
//! pure rendering of the identical state (the equivalence theorem), toggled
//! instantly. Fruit icons are the colourblind guarantee.

import type { GameModule } from "../../contract.js";
import { ColorSort, type BoardView, type Move } from "./color-sort-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type ColorSortEnvelope,
  type VerifyResult,
} from "./color-sort-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  colorSortIconsFor,
  colorSortSkin,
  colorSortStrict,
  declareAssistanceEnabled,
  hintsEnabled,
  iconsDefaultFor,
  setColorSortIcons,
  setColorSortSkin,
  setColorSortStrict,
  setDeclareAssistance,
  setHintsEnabled,
  type ColorSortSkin,
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
    };
  }
}

/** The fixed colour-id → fruit-icon map (brief §6), in colour-id order. */
const ICONS = ["🍎", "🍋", "🍇", "🥝", "🫐", "🍊", "🍓", "🥥", "🟣", "🌽", "🥕", "🍑"];

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

// ---------- persistence (namespaced per shelf convention) ----------

const NS = "color-sort";
interface DailySave {
  seed: string;
  moves: Move[];
  solved: boolean;
  par: number;
  strict: boolean;
}
interface EndlessSave {
  level: number;
  seed: string;
  moves: Move[];
  bestLevel: number;
}
interface Stats {
  solved: number;
  strictSolved: number;
  streak: number;
  maxStreak: number;
  lastDay: number;
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${NS}/${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${NS}/${key}`, JSON.stringify(value));
  } catch {
    // storage denied — session-only, no failure
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function recordDailySolved(strict: boolean): void {
  const day = dayIndexUTC(new Date());
  const s = load<Stats>("stats") ?? {
    solved: 0,
    strictSolved: 0,
    streak: 0,
    maxStreak: 0,
    lastDay: -1,
  };
  if (s.lastDay === day) return; // already counted today
  s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.solved += 1;
  if (strict) s.strictSolved += 1;
  s.lastDay = day;
  save("stats", s);
}

// ---------- the game module ----------

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
  // The most recent pour, so the target tube's newly-arrived units animate in
  // once. Cleared after the render that consumes it.
  let pourAnim: { tube: number; count: number } | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const strict = (): boolean => colorSortStrict();
  const iconsOn = (): boolean => colorSortIconsFor(skin);

  // ---- persistence of the in-progress deal ----
  const persist = (solved = false): void => {
    if (!game) return;
    const b = game.board();
    if (mode === "daily") {
      const s: DailySave = {
        seed: seed.toString(),
        moves: replayMoves(),
        solved,
        par: b.par,
        strict: strict(),
      };
      save(`daily/${todayKey()}`, s);
    } else {
      const prev = load<EndlessSave>("endless");
      const s: EndlessSave = {
        level,
        seed: seed.toString(),
        moves: replayMoves(),
        bestLevel: Math.max(prev?.bestLevel ?? 1, level),
      };
      save("endless", s);
    }
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
    // / nut) so every skin centres its unit and its icon. The top `pourAnim.count`
    // units of the just-poured target animate in.
    const pourCount = pourAnim && pourAnim.tube === t ? pourAnim.count : 0;
    const stack = el("div", { class: "cs-stack" });
    for (let i = 0; i < b.cap; i++) {
      const slot = el("div", { class: "cs-slot" });
      if (i < tube.length) {
        const c = tube[i]!;
        const unit = el("div", { class: "cs-unit" });
        unit.style.setProperty("--cs-fill", colors[c] ?? "#888");
        unit.setAttribute("data-color", String(c));
        // Newly-poured units sit in the top `pourCount` positions of the target.
        const fromTop = tube.length - 1 - i;
        if (pourCount > 0 && fromTop < pourCount) {
          unit.classList.add("cs-pour-in");
          unit.style.setProperty("--pour-i", String(pourCount - 1 - fromTop));
        }
        if (iconsOn()) unit.append(el("span", { class: "cs-icon", "aria-hidden": "true" }, ICONS[c] ?? ""));
        slot.append(unit);
      }
      stack.append(slot);
    }
    if (locked) btn.append(el("div", { class: "cs-cap", "aria-hidden": "true" }));
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

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });

    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Mode" });
    const daily = el(
      "button",
      { type: "button", class: "sol-mode-daily", "aria-pressed": String(mode === "daily") },
      "Daily",
    );
    const endless = el(
      "button",
      { type: "button", class: "sol-new", "aria-pressed": String(mode === "endless") },
      "Endless",
    );
    daily.addEventListener("click", () => void startDaily());
    endless.addEventListener("click", () => void startEndless(bestLevel()));
    modes.append(daily, endless);

    const actions = el("div", { class: "cs-actions", role: "group", "aria-label": "Actions" });
    if (!strict()) {
      const undoBtn = el("button", { type: "button", class: "cs-undo" }, "Undo");
      undoBtn.addEventListener("click", doUndo);
      actions.append(undoBtn);
    }
    const restartBtn = el("button", { type: "button", class: "cs-restart" }, "Restart");
    restartBtn.addEventListener("click", doRestart);
    actions.append(restartBtn);

    const hints = hintsEnabled();
    const hintBtn = el("button", { type: "button", class: hints ? "sol-hint" : "sol-stuck" }, hints ? "Hint" : "I’m stuck");
    hintBtn.addEventListener("click", hints ? showHint : declareStuck);
    actions.append(hintBtn);

    bar.append(modes, actions, renderSettings());
    return bar;
  };

  const renderSettings = (): HTMLElement => {
    const settings = el("details", { class: "sol-settings" });
    const summary = el("summary", {}, "Settings");
    settings.append(summary);

    // Skin — a segmented choice.
    const skinRow = el("div", { class: "sol-setting cs-skin-row", role: "group", "aria-label": "Skin" });
    skinRow.append(el("span", { class: "cs-setting-label" }, "Skin"));
    (["water", "ball", "bolt"] as ColorSortSkin[]).forEach((s) => {
      const b = el(
        "button",
        { type: "button", class: `cs-skin-btn cs-skin-${s}`, "aria-pressed": String(skin === s) },
        s[0]!.toUpperCase() + s.slice(1),
      );
      b.addEventListener("click", () => {
        skin = s;
        setColorSortSkin(s);
        rebuild();
      });
      skinRow.append(b);
    });
    settings.append(skinRow);

    const toggle = (checked: boolean, label: string, cls: string, onChange: (on: boolean) => void): HTMLElement => {
      const wrap = el("label", { class: "sol-setting" });
      const input = el("input", { type: "checkbox", class: cls }) as HTMLInputElement;
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      wrap.append(input, document.createTextNode(` ${label}`));
      return wrap;
    };
    settings.append(
      toggle(iconsOn(), "Fruit icons (colourblind)", "cs-set-icons", (on) => {
        setColorSortIcons(on);
        rebuild();
      }),
      toggle(strict(), "Strict mode (no undo)", "cs-set-strict", (on) => {
        setColorSortStrict(on);
        rebuild();
      }),
      toggle(hintsEnabled(), "Enable hints", "sol-set-hints", (on) => {
        setHintsEnabled(on);
        rebuild();
      }),
      toggle(declareAssistanceEnabled(), "Declare assistance used", "sol-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
    );
    // A note that changing skin flips the icon default.
    settings.append(
      el(
        "p",
        { class: "sol-note cs-skin-note" },
        `Icons default ${iconsDefaultFor(skin) ? "on" : "off"} for the ${skin} skin; your choice overrides it.`,
      ),
    );
    return settings;
  };

  const bannerFor = (b: BoardView): HTMLElement | null => {
    if (b.won || !b.deadlocked) return null;
    const banner = el("div", { class: "cs-banner", role: "alert" });
    banner.append(el("span", {}, "No moves left."));
    const restart = el("button", { type: "button", class: "cs-restart" }, "Restart");
    restart.addEventListener("click", doRestart);
    banner.append(restart);
    if (!strict()) {
      const undoBtn = el("button", { type: "button", class: "cs-undo" }, "Undo");
      undoBtn.addEventListener("click", doUndo);
      banner.append(undoBtn);
    }
    return banner;
  };

  const parLine = (b: BoardView): HTMLElement => {
    const parts = [`Moves ${b.moveCount}`];
    if (b.par) parts.push(`Par ${b.par}`);
    parts.push(mode === "daily" ? "Daily" : `Level ${level}`);
    parts.push(strict() ? "Strict" : "Free");
    return el("div", { class: "cs-hud" }, parts.join(" · "));
  };

  function render(): void {
    if (disposed || !container || !game) return;
    const b = game.board();
    if (b.won) {
      pourAnim = null;
      void presentResult();
      return;
    }
    const banner = bannerFor(b);
    const wrap = el(
      "div",
      { class: "cs-game" },
      renderControls(),
      parLine(b),
      ...(banner ? [banner] : []),
      renderBoard(b),
      statusEl,
    );
    container.replaceChildren(wrap);
    pourAnim = null; // the pour animation plays once, on the render that follows it
  }

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
    const status = game.pour(from, t);
    if (status !== "applied") {
      render();
      return;
    }
    // How many units actually landed — those top slots animate the pour in.
    pourAnim = { tube: t, count: Math.max(1, game.board().tubes[t]!.length - toLenBefore) };
    setStatus("");
    persist();
    afterMove(t);
  };

  const afterMove = (poured: number): void => {
    render();
    // A brief pour highlight on the target tube (reduced-motion safe in CSS).
    const tubeEl = container?.querySelector<HTMLElement>(`.cs-tube[data-tube="${poured}"]`);
    tubeEl?.classList.add("cs-poured");
    window.setTimeout(() => tubeEl?.classList.remove("cs-poured"), 320);
    if (!game) return;
    const b = game.board();
    if (b.won) {
      if (mode === "daily") {
        recordDailySolved(strict());
        persist(true);
      }
      return; // render() already routed to the result on next tick
    }
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
    if (game.undo()) {
      game.markAssistance();
      selected = null;
      setStatus("Undid the last pour (counts as assistance).");
      persist();
      render();
    }
  };

  const doRestart = (): void => {
    if (!game) return;
    game.restart();
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
  const bestLevel = (): number => load<EndlessSave>("endless")?.bestLevel ?? 1;

  const applyMoves = (moves: Move[]): void => {
    if (!game) return;
    for (const mv of moves) game.pour(mv.from, mv.to);
  };

  async function startDaily(): Promise<void> {
    if (!game || disposed) return;
    mode = "daily";
    const day = dayIndexUTC(new Date());
    game.newDaily(day);
    seed = game.seed();
    // Resume today's in-progress deal if the seed still matches.
    const saved = load<DailySave>(`daily/${todayKey()}`);
    if (saved && saved.seed === seed.toString() && !saved.solved) applyMoves(saved.moves);
    selected = null;
    setStatus("");
    console.debug(`[color-sort] daily seed=${seed}`);
    exposeHook();
    if (saved?.solved && saved.seed === seed.toString()) {
      // Already solved today — replay to the solved state and show the result.
      applyMoves(saved.moves);
      void presentResult();
      return;
    }
    render();
  }

  async function startEndless(atLevel: number): Promise<void> {
    if (!game || disposed) return;
    mode = "endless";
    level = Math.max(1, atLevel);
    game.newEndless(level);
    seed = game.seed();
    const saved = load<EndlessSave>("endless");
    if (saved && saved.level === level && saved.seed === seed.toString()) applyMoves(saved.moves);
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
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      skin = colorSortSkin();
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
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
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
        await startDaily();
      })();
    },
    unmount(): void {
      disposed = true;
      document.removeEventListener("keydown", onKeydown);
      delete window.__colorSort;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
