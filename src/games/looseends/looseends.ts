//! Loose Ends — the arrow-release ("tap-away") puzzle module.
//!
//! A grid is filled with snake-shaped arrows; tapping a FREE arrow (its exit ray
//! to the board edge is clear) releases it with a train-style slide, while a
//! BLOCKED tap costs a droplet. The **core decides legality** — this module reads
//! the board's per-arrow `free` flag, calls `tap`, and only animates what the
//! core already resolved. Boards come from deterministic seeds (100-level
//! campaign + a daily calendar); the module renders everything into its mount
//! container as an internal home → levels/daily → game flow.

import type { GameModule } from "../../contract.js";
import {
  dailySeedFor,
  LooseEnds,
  type BoardView,
  type OutcomeEnvelope,
} from "./looseends-wasm.js";
import { declareAssistanceEnabled } from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + helpers so tests can drive the core. */
    __looseends?: {
      binding: LooseEnds;
      board: () => BoardView;
      tapArrow: (id: number) => void;
      view: () => string;
      openLevel: (n: number) => void;
    };
  }
}

const LIVES = 3;
const TAP_THRESHOLD = 9; // px of movement that switches a press from tap to pan

// ---------- tiny DOM helper ----------

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

// ---------- persistence (localStorage `looseEnds.v1`) ----------

interface LevelRecord {
  stars: number;
  score: number;
}
interface Store {
  levels: Record<string, LevelRecord>;
  daily: Record<string, { stars: number }>;
}

const STORE_KEY = "looseEnds.v1";

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      return { levels: parsed.levels ?? {}, daily: parsed.daily ?? {} };
    }
  } catch {
    /* private mode / disabled storage — fall through to an empty store */
  }
  return { levels: {}, daily: {} };
}

function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore write failures (private mode) */
  }
}

/** Record a result, keeping the best stars/score (never downgraded). */
function recordLevel(store: Store, n: number, stars: number, score: number): void {
  const key = String(n);
  const prev = store.levels[key];
  if (!prev || stars > prev.stars || (stars === prev.stars && score > prev.score)) {
    store.levels[key] = { stars: Math.max(stars, prev?.stars ?? 0), score: Math.max(score, prev?.score ?? 0) };
  }
  saveStore(store);
}
function recordDaily(store: Store, dateKey: string, stars: number): void {
  const prev = store.daily[dateKey];
  if (!prev || stars > prev.stars) store.daily[dateKey] = { stars };
  saveStore(store);
}

/** The first unsolved level (1..100), or 100 if all are solved. */
function firstUnsolved(store: Store): number {
  for (let n = 1; n <= 100; n++) if (!store.levels[String(n)]) return n;
  return 100;
}

// ---------- difficulty band (mirrors the spec's `diff`) ----------

function bandFor(n: number): string {
  if (n <= 15) return "Easy";
  if (n <= 40) return "Normal";
  if (n <= 70) return "Hard";
  return "Expert";
}

// ---------- daily calendar helpers ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
function todayKey(): string {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The daily streak: consecutive completed days ending today. Today counts only
 *  once solved; if today is unsolved the streak counts back from yesterday (it
 *  is not broken until today is actually missed). */
function dailyStreak(store: Store): number {
  const cur = new Date();
  cur.setHours(12, 0, 0, 0); // avoid DST edges
  const key = (dt: Date): string => dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  let streak = 0;
  // If today is not done, start counting from yesterday.
  if (!store.daily[key(cur)]) cur.setDate(cur.getDate() - 1);
  while (store.daily[key(cur)]) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

// ---------- canvas palette (read from CSS custom properties) ----------

interface Palette {
  bg: string;
  arrow: string;
  dot: string;
  accent: string;
  hint: string;
  danger: string;
  droplet: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--le-bg", "#182230"),
    arrow: v("--le-arrow", "#a7b6cb"),
    dot: v("--le-dot", "#2d3c51"),
    accent: v("--le-accent", "#f2a541"),
    hint: v("--le-hint", "#3ddba9"),
    danger: v("--le-danger", "#e4573d"),
    droplet: v("--le-droplet", "#4f7cff"),
  };
}

/** Lerp two `#rrggbb` colours (t in 0..1). Used for the blocked-flash tint. */
function lerpColor(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const ca = [0, 2, 4].map((i) => parseInt(pa.slice(i, i + 2), 16));
  const cb = [0, 2, 4].map((i) => parseInt(pb.slice(i, i + 2), 16));
  const c = ca.map((x, i) => Math.round(x + (cb[i]! - x) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ---------- geometry ----------

type Pt = { x: number; y: number };

function centers(cells: [number, number][]): Pt[] {
  return cells.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
}

/** Point-to-segment distance in world units. */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// ---------- the release (train slide) animation ----------

interface Slide {
  points: Pt[]; // extended polyline: body centres tail→head, then the exit point
  cum: number[]; // cumulative arclength at each point
  bodyLen: number;
  total: number;
  s: number; // front-of-body distance travelled
  v: number; // cells/s
}

function buildSlide(cells: [number, number][], dir: [number, number], w: number, h: number): Slide {
  const pts = centers(cells);
  const head = pts[pts.length - 1]!;
  // distance in cells from the head cell to the board edge along dir
  const [hx, hy] = cells[cells.length - 1]!;
  const rayLen =
    dir[0] > 0 ? w - 1 - hx : dir[0] < 0 ? hx : dir[1] > 0 ? h - 1 - hy : hy;
  const bodyLen = cells.length - 1;
  const exit = { x: head.x + dir[0] * (rayLen + bodyLen + 4), y: head.y + dir[1] * (rayLen + bodyLen + 4) };
  const points = [...pts, exit];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  return { points, cum, bodyLen, total: cum[cum.length - 1]!, s: 0, v: 6 };
}

/** The point at arclength `d` along the polyline. */
function sampleAt(points: Pt[], cum: number[], d: number): Pt {
  if (d <= 0) return points[0]!;
  const last = cum[cum.length - 1]!;
  if (d >= last) return points[points.length - 1]!;
  let i = 1;
  while (i < cum.length && cum[i]! < d) i++;
  const t = (d - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
  const a = points[i - 1]!;
  const b = points[i]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---------- the game module ----------

/** Construct a fresh Loose Ends module (the registry `load`). */
export function looseendsModule(): GameModule {
  let binding: LooseEnds | null = null;
  let verifier: LooseEnds | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  const store = loadStore();

  type View = "home" | "levels" | "daily" | "game" | "shared";
  let view: View = "home";

  // current game session
  type Mode = { kind: "level"; n: number } | { kind: "daily"; dateKey: string };
  let mode: Mode = { kind: "level", n: 1 };
  let mistakes = 0;
  let hints = 0;
  let startedAt = 0;
  let finished = false;

  // rendering / interaction state (game view)
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let vp = { scale: 1, ox: 0, oy: 0 }; // world → screen: screen = world*scale + o
  let fitScale = 1;
  let pal = palette();
  const slides: Slide[] = [];
  const flash = new Map<number, number>(); // arrow id → blocked-flash age (s)
  let hintId = -1;
  let hintAge = 0;
  let lastFrame = 0;

  const reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- session lifecycle ---

  const startGame = (m: Mode): void => {
    mode = m;
    mistakes = 0;
    hints = 0;
    finished = false;
    slides.length = 0;
    flash.clear();
    hintId = -1;
    startedAt = Date.now();
    if (m.kind === "level") binding!.newLevel(m.n);
    else binding!.newDaily(dailySeedFor(m.dateKey));
    view = "game";
    render();
  };

  // --- rendering: view router ---

  function render(): void {
    if (disposed || !container) return;
    stopLoop();
    switch (view) {
      case "home":
        container.replaceChildren(renderHome());
        break;
      case "levels":
        container.replaceChildren(renderLevels());
        break;
      case "daily":
        container.replaceChildren(renderDaily());
        break;
      case "game":
        container.replaceChildren(renderGame());
        mountCanvas();
        break;
      case "shared":
        // rendered directly by showShared()
        break;
    }
    exposeHook();
  }

  // --- home ---

  function renderHome(): HTMLElement {
    const next = firstUnsolved(store);
    const solved = Object.keys(store.levels).length;
    const play = el("button", { class: "le-btn le-btn-primary", type: "button" }, "Play");
    play.addEventListener("click", () => startGame({ kind: "level", n: firstUnsolved(store) }));
    const note = el("p", { class: "le-note" }, solved >= 100 ? "All 100 solved — replay any" : `Level ${next}`);

    const daily = el("button", { class: "le-btn", type: "button" }, "Daily puzzle");
    daily.addEventListener("click", () => {
      view = "daily";
      render();
    });
    const all = el("button", { class: "le-btn", type: "button" }, "All levels");
    all.addEventListener("click", () => {
      view = "levels";
      render();
    });

    return el(
      "section",
      { class: "le-home", "data-view": "home" },
      el("div", { class: "le-logo" }, "Loose Ends"),
      el("p", { class: "le-tagline" }, "Untangle the arrows. Tap a free one to slip it off the board."),
      el("div", { class: "le-home-actions" }, play, note, daily, all),
    );
  }

  // --- level select ---

  function renderLevels(): HTMLElement {
    const solved = Object.keys(store.levels).length;
    const next = firstUnsolved(store);
    const head = el(
      "div",
      { class: "le-select-head" },
      backButton("home"),
      el("div", { class: "le-select-titles" }, el("h2", {}, "All levels"), el("p", { class: "le-sub" }, `${solved} / 100 solved`)),
    );

    const grid = el("div", { class: "le-level-grid", "data-view": "levels" });
    const bands: [string, number, number][] = [
      ["Easy", 1, 15],
      ["Normal", 16, 40],
      ["Hard", 41, 70],
      ["Expert", 71, 100],
    ];
    for (const [name, lo, hi] of bands) {
      grid.append(el("div", { class: "le-band" }, `${name} ${lo}–${hi}`));
      const row = el("div", { class: "le-tiles" });
      for (let n = lo; n <= hi; n++) {
        const rec = store.levels[String(n)];
        const locked = n > next && !rec;
        const state = rec ? "solved" : n === next ? "next" : locked ? "locked" : "open";
        const tile = el(
          "button",
          {
            class: `le-tile le-tile-${state}`,
            type: "button",
            ...(locked ? { disabled: "", "aria-disabled": "true" } : {}),
            "aria-label": `Level ${n}${rec ? `, ${rec.stars} stars` : locked ? ", locked" : ""}`,
          },
          rec ? el("span", { class: "le-tile-n" }, String(n)) : String(n),
        );
        if (rec) tile.append(el("span", { class: "le-tile-stars" }, "★".repeat(rec.stars) || "☆"));
        if (!locked) tile.addEventListener("click", () => startGame({ kind: "level", n }));
        row.append(tile);
      }
      grid.append(row);
    }
    return el("section", { class: "le-select" }, head, grid);
  }

  // --- daily calendar ---

  function renderDaily(): HTMLElement {
    const year = new Date().getFullYear();
    const tKey = todayKey();
    const streak = dailyStreak(store);
    const todayDone = Boolean(store.daily[tKey]);

    const head = el(
      "div",
      { class: "le-select-head" },
      backButton("home"),
      el("div", { class: "le-select-titles" }, el("h2", {}, "Daily puzzle")),
    );

    const streakCard = el(
      "div",
      { class: "le-streak-card" },
      el("div", { class: "le-streak-num" }, String(streak)),
      el("div", { class: "le-streak-label" }, "Daily streak"),
      el(
        "div",
        { class: "le-streak-line" },
        todayDone ? "Today is done — see you tomorrow" : "Solve today’s board to keep it alive",
      ),
    );

    const cals = el("div", { class: "le-cals", "data-view": "daily" });
    let todayEl: HTMLElement | null = null;
    for (let m = 0; m < 12; m++) {
      const cal = el("div", { class: "le-cal" });
      cal.append(el("div", { class: "le-cal-title" }, `${MONTHS[m]} ${year}`));
      const days = el("div", { class: "le-cal-days" });
      const firstDow = new Date(year, m, 1).getDay();
      for (let i = 0; i < firstDow; i++) days.append(el("span", { class: "le-day le-day-pad" }));
      const dim = daysInMonth(year, m);
      for (let d = 1; d <= dim; d++) {
        const key = dateKey(year, m, d);
        const done = Boolean(store.daily[key]);
        const isToday = key === tKey;
        const future = key > tKey;
        const state = done ? "done" : isToday ? "today" : future ? "future" : "past";
        const day = el(
          "button",
          {
            class: `le-day le-day-${state}`,
            type: "button",
            ...(future ? { disabled: "", "aria-disabled": "true" } : {}),
            "aria-label": `${MONTHS[m]} ${d}${done ? ", solved" : isToday ? ", today" : future ? ", locked" : ""}`,
          },
          String(d),
        );
        if (!future) day.addEventListener("click", () => startGame({ kind: "daily", dateKey: key }));
        if (isToday) todayEl = cal;
        days.append(day);
      }
      cal.append(days);
      cals.append(cal);
    }
    const section = el("section", { class: "le-select" }, head, streakCard, cals);
    // auto-scroll to the current month after mount
    requestAnimationFrame(() => todayEl?.scrollIntoView({ block: "center" }));
    return section;
  }

  // --- shared back button ---

  function backButton(to: View): HTMLElement {
    const b = el("button", { class: "le-back", type: "button", "aria-label": "Back" }, "‹ Back");
    b.addEventListener("click", () => {
      view = to;
      render();
    });
    return b;
  }

  // --- the game view (canvas + HUD) ---

  function renderGame(): HTMLElement {
    const title =
      mode.kind === "level" ? `Level ${mode.n}` : `Daily · ${mode.dateKey}`;
    const eyebrow = mode.kind === "level" ? bandFor(mode.n) : "Daily";

    const backTo: View = mode.kind === "level" ? "levels" : "daily";
    const back = el("button", { class: "le-hud-btn", type: "button", "aria-label": "Back" }, "‹");
    back.addEventListener("click", () => {
      view = backTo;
      render();
    });

    const droplets = el("div", { class: "le-droplets", role: "img", "aria-label": `${LIVES - mistakes} droplets left` });
    for (let i = 0; i < LIVES; i++) {
      droplets.append(el("span", { class: `le-droplet ${i < LIVES - mistakes ? "" : "spent"}`.trim() }, "💧"));
    }

    const hintBtn = el("button", { class: "le-hud-btn le-hint-btn", type: "button", "aria-label": "Hint" }, "💡");
    hintBtn.addEventListener("click", useHint);

    const hud = el(
      "div",
      { class: "le-hud" },
      back,
      el("div", { class: "le-hud-title" }, el("span", { class: "le-eyebrow" }, eyebrow), el("span", {}, title)),
      droplets,
      hintBtn,
    );

    canvas = el("canvas", { class: "le-canvas", role: "img", "aria-label": `${title} board` }) as HTMLCanvasElement;
    const stage = el("div", { class: "le-stage" }, canvas, hud);
    return el("div", { class: "le-game", "data-view": "game" }, stage);
  }

  const refreshDroplets = (): void => {
    if (!container) return;
    const wrap = container.querySelector(".le-droplets");
    if (!wrap) return;
    wrap.setAttribute("aria-label", `${LIVES - mistakes} droplets left`);
    wrap.querySelectorAll(".le-droplet").forEach((d, i) => {
      d.classList.toggle("spent", i >= LIVES - mistakes);
    });
  };

  // --- canvas mount, sizing, and the render loop ---

  function mountCanvas(): void {
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    pal = palette();
    ro = new ResizeObserver(() => {
      resize();
      fitView();
    });
    ro.observe(canvas.parentElement ?? canvas);
    resize();
    fitView();
    attachInput();
    lastFrame = performance.now();
    loop();
  }

  function resize(): void {
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = (canvas.parentElement ?? canvas).getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  function boardDims(): { w: number; h: number } {
    const b = binding!.board();
    return { w: b.width, h: b.height };
  }

  function fitView(): void {
    if (!canvas) return;
    const { w, h } = boardDims();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pad = 26 * dpr;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const scale = Math.min(availW / w, availH / h, 64 * dpr);
    fitScale = scale;
    vp = {
      scale,
      ox: (canvas.width - w * scale) / 2,
      oy: (canvas.height - h * scale) / 2,
    };
  }

  const clampScale = (s: number): number => Math.max(0.5 * fitScale, Math.min(4.5 * fitScale, s));

  function stopLoop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ro) {
      ro.disconnect();
      ro = null;
    }
  }

  function loop(): void {
    if (disposed || view !== "game") return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function step(dt: number): void {
    // advance slides
    for (let i = slides.length - 1; i >= 0; i--) {
      const sl = slides[i]!;
      sl.v = Math.min(28, sl.v + 40 * dt);
      sl.s += sl.v * dt;
      if (sl.s >= sl.total - sl.bodyLen) slides.splice(i, 1);
    }
    // decay blocked flashes
    for (const [id, age] of flash) {
      const next = age + dt;
      if (next > 0.6) flash.delete(id);
      else flash.set(id, next);
    }
    if (hintId >= 0) {
      hintAge += dt;
      if (hintAge > 2.4) hintId = -1;
    }
  }

  // world → screen
  const sx = (x: number): number => x * vp.scale + vp.ox;
  const sy = (y: number): number => y * vp.scale + vp.oy;

  function draw(): void {
    if (!ctx || !canvas || !binding) return;
    const b = binding.board();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // faint lattice dots at grid corners
    ctx.fillStyle = pal.dot;
    const r = 0.055 * vp.scale;
    for (let y = 0; y <= b.height; y++) {
      for (let x = 0; x <= b.width; x++) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // still arrows (present, not currently animating)
    for (let id = 0; id < b.arrows.length; id++) {
      const a = b.arrows[id]!;
      if (!a.present) continue;
      drawArrow(a.cells, a.dir, id, a.free);
    }

    // release slides on top
    for (const sl of slides) drawSlide(sl);
  }

  function drawArrow(cells: [number, number][], dir: [number, number], id: number, free: boolean): void {
    if (!ctx) return;
    const pts = centers(cells);
    // blocked shake offset (perpendicular to head dir), decaying
    let ox = 0;
    let oy = 0;
    const fAge = flash.get(id);
    let color = pal.arrow;
    if (fAge !== undefined) {
      const tint = Math.max(0, 1 - fAge / 0.6);
      color = lerpColor(pal.arrow, pal.danger, tint);
      if (!reduceMotion) {
        const shake = Math.max(0, 1 - fAge / 0.45) * 0.12 * vp.scale;
        const amp = Math.sin(fAge * 60) * shake;
        ox = -dir[1] * amp;
        oy = dir[0] * amp;
      }
    }
    const isHint = id === hintId;
    if (isHint) {
      const pulse = 0.5 + 0.5 * Math.sin(hintAge * 6);
      ctx.save();
      ctx.shadowColor = pal.hint;
      ctx.shadowBlur = (6 + 8 * pulse) * (vp.scale / 40);
      color = pal.hint;
    }

    ctx.strokeStyle = free ? color : color;
    ctx.globalAlpha = free ? 1 : 0.82;
    ctx.lineWidth = 0.24 * vp.scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // body: stroke through centres, stopping ~0.30 short of the head centre
    const head = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    const hd = Math.hypot(head.x - prev.x, head.y - prev.y) || 1;
    const stopPt = {
      x: head.x - (dir[0] * 0.3),
      y: head.y - (dir[1] * 0.3),
    };
    ctx.beginPath();
    ctx.moveTo(sx(pts[0]!.x) + ox, sy(pts[0]!.y) + oy);
    for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(sx(pts[i]!.x) + ox, sy(pts[i]!.y) + oy);
    ctx.lineTo(sx(stopPt.x) + ox, sy(stopPt.y) + oy);
    ctx.stroke();

    // arrowhead triangle
    drawHead(head, dir, color, ox, oy);
    void hd;

    if (isHint) ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHead(head: Pt, dir: [number, number], color: string, ox = 0, oy = 0): void {
    if (!ctx) return;
    const len = 0.42;
    const halfW = 0.3;
    const over = 0.18;
    const tip = { x: head.x + dir[0] * over, y: head.y + dir[1] * over };
    const base = { x: tip.x - dir[0] * len, y: tip.y - dir[1] * len };
    const perp = { x: -dir[1], y: dir[0] };
    const l = { x: base.x + perp.x * halfW, y: base.y + perp.y * halfW };
    const rr = { x: base.x - perp.x * halfW, y: base.y - perp.y * halfW };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx(tip.x) + ox, sy(tip.y) + oy);
    ctx.lineTo(sx(l.x) + ox, sy(l.y) + oy);
    ctx.lineTo(sx(rr.x) + ox, sy(rr.y) + oy);
    ctx.closePath();
    ctx.fill();
  }

  function drawSlide(sl: Slide): void {
    if (!ctx) return;
    const from = sl.s;
    const to = sl.s + sl.bodyLen;
    const start = sampleAt(sl.points, sl.cum, from);
    const end = sampleAt(sl.points, sl.cum, to);
    ctx.strokeStyle = pal.arrow;
    ctx.lineWidth = 0.24 * vp.scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(sx(start.x), sy(start.y));
    for (let i = 0; i < sl.points.length; i++) {
      if (sl.cum[i]! > from && sl.cum[i]! < to) ctx.lineTo(sx(sl.points[i]!.x), sy(sl.points[i]!.y));
    }
    // stop short of the front for the head
    const frontDir = dirAt(sl, to);
    const stop = { x: end.x - frontDir.x * 0.3, y: end.y - frontDir.y * 0.3 };
    ctx.lineTo(sx(stop.x), sy(stop.y));
    ctx.stroke();
    drawHead(end, [frontDir.x, frontDir.y], pal.arrow);
  }

  function dirAt(sl: Slide, d: number): Pt {
    let i = 1;
    while (i < sl.cum.length && sl.cum[i]! < d) i++;
    const a = sl.points[Math.max(0, i - 1)]!;
    const b = sl.points[Math.min(sl.points.length - 1, i)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  // --- input: tap / pan / pinch / wheel ---

  function attachInput(): void {
    if (!canvas) return;
    canvas.style.touchAction = "none";
    const pointers = new Map<number, Pt>();
    let downPt: Pt | null = null;
    let panned = false;
    let panStart = { ox: 0, oy: 0 };
    let pinchStart = 0;
    let pinchScale = 1;

    const toScreen = (e: PointerEvent): Pt => {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
    };

    canvas.addEventListener("pointerdown", (e) => {
      canvas!.setPointerCapture(e.pointerId);
      const p = toScreen(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        downPt = p;
        panned = false;
        panStart = { ox: vp.ox, oy: vp.oy };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        pinchScale = vp.scale;
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = toScreen(e);
      pointers.set(e.pointerId, p);
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchStart > 0) zoomAbout(mid, clampScale((pinchScale * dist) / pinchStart) / vp.scale);
        panned = true;
      } else if (downPt) {
        const dx = p.x - downPt.x;
        const dy = p.y - downPt.y;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        if (!panned && Math.hypot(dx, dy) > TAP_THRESHOLD * dpr) panned = true;
        if (panned) {
          vp.ox = panStart.ox + dx;
          vp.oy = panStart.oy + dy;
        }
      }
    });

    const up = (e: PointerEvent): void => {
      const wasSingle = pointers.size === 1;
      const p = pointers.get(e.pointerId) ?? null;
      pointers.delete(e.pointerId);
      if (wasSingle && !panned && p && downPt) tapAt(p);
      // re-anchor pinch when a finger lifts
      if (pointers.size === 1) {
        downPt = [...pointers.values()][0]!;
        panStart = { ox: vp.ox, oy: vp.oy };
        panned = true; // don't turn a pinch-release into a tap
      }
      if (pointers.size === 0) downPt = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = canvas!.getBoundingClientRect();
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const at = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
        const factor = e.deltaY < 0 ? 1.12 : 0.9;
        const target = clampScale(vp.scale * factor);
        zoomAbout(at, target / vp.scale);
      },
      { passive: false },
    );
  }

  function zoomAbout(at: Pt, factor: number): void {
    const newScale = clampScale(vp.scale * factor);
    const k = newScale / vp.scale;
    vp.ox = at.x - (at.x - vp.ox) * k;
    vp.oy = at.y - (at.y - vp.oy) * k;
    vp.scale = newScale;
  }

  function tapAt(screen: Pt): void {
    if (!binding || finished) return;
    const world = { x: (screen.x - vp.ox) / vp.scale, y: (screen.y - vp.oy) / vp.scale };
    const b = binding.board();
    let bestId = -1;
    let bestDist = 0.55;
    for (let id = 0; id < b.arrows.length; id++) {
      const a = b.arrows[id]!;
      if (!a.present) continue;
      const pts = centers(a.cells);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSeg(world, pts[i]!, pts[i + 1]!);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      // single-cell arrows (min body 2 so always a segment) still covered above
    }
    if (bestId >= 0) doTap(bestId);
  }

  function doTap(id: number): void {
    if (!binding || finished) return;
    const before = binding.board();
    const arrow = before.arrows[id];
    const status = binding.tap(id);
    if (status === "released") {
      hintId = -1;
      if (arrow) slides.push(buildSlide(arrow.cells, arrow.dir, before.width, before.height));
      if (binding.remaining() === 0) {
        finished = true;
        window.setTimeout(() => winNow(), reduceMotion ? 50 : 650);
      }
    } else if (status === "blocked") {
      mistakes++;
      flash.set(id, 0);
      refreshDroplets();
      if (mistakes >= LIVES) {
        finished = true;
        window.setTimeout(() => failNow(), reduceMotion ? 50 : 450);
      }
    }
    exposeHook();
  }

  function useHint(): void {
    if (!binding || finished) return;
    const id = binding.hint();
    if (id === null) return;
    hints++;
    hintId = id;
    hintAge = 0;
  }

  // --- win / fail ---

  function elapsedStr(): string {
    const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  }

  function winNow(): void {
    if (disposed || !binding || !container) return;
    const stars = binding.starsFor(mistakes, hints);
    const score = binding.scoreFor(mistakes, hints);
    if (mode.kind === "level") recordLevel(store, mode.n, stars, score);
    else recordDaily(store, mode.dateKey, stars);
    stopLoop();
    void presentWin(stars, score);
  }

  async function presentWin(stars: number, score: number): Promise<void> {
    if (!binding || !container) return;
    const assisted = hints > 0;
    const env = binding.outcome(declareAssistanceEnabled(), assisted);
    const shareUrl = `${location.origin}${location.pathname}?r=${encodeRecord(env)}`;

    const heading = stars === 3 ? "Flawless!" : stars === 2 ? "Solved!" : "Untangled";
    const starRow = el("div", { class: "le-stars", "aria-label": `${stars} of 3 stars` });
    for (let i = 0; i < 3; i++) starRow.append(el("span", { class: `le-star ${i < stars ? "lit" : ""}`.trim() }, "★"));

    const stats = el("dl", { class: "le-stats" });
    const row = (t: string, v: string): void => {
      stats.append(el("dt", {}, t), el("dd", {}, v));
    };
    row("Difficulty", mode.kind === "level" ? bandFor(mode.n) : "Daily");
    row("Time", elapsedStr());
    row("Score", String(score));
    row("Mistakes", String(mistakes));
    row("Hints", String(hints));
    if (mode.kind === "daily") row("Streak", String(dailyStreak(store)));

    const verifyBadge = el("p", { class: "le-verify", role: "status" }, "Verifying…");
    void reverify(env).then((ok) => {
      verifyBadge.textContent = ok
        ? "Verified ✓ — re-checked by replaying every release against the core."
        : "Verification failed — this result did not check out.";
      verifyBadge.classList.add(ok ? "ok" : "fail");
    });

    const actions = el("div", { class: "le-modal-actions" });
    if (mode.kind === "level" && mode.n < 100) {
      const next = el("button", { class: "le-btn le-btn-primary", type: "button" }, "Next level");
      next.addEventListener("click", () => startGame({ kind: "level", n: (mode as { n: number }).n + 1 }));
      actions.append(next);
    } else if (mode.kind === "daily") {
      const cal = el("button", { class: "le-btn le-btn-primary", type: "button" }, "Back to calendar");
      cal.addEventListener("click", () => {
        view = "daily";
        render();
      });
      actions.append(cal);
    }
    const share = el("a", { class: "le-btn le-share", href: shareUrl, "data-share": shareUrl }, "Share result");
    const menu = el("button", { class: "le-btn", type: "button" }, "Menu");
    menu.addEventListener("click", () => {
      view = mode.kind === "level" ? "levels" : "daily";
      render();
    });
    actions.append(share, menu);

    const modal = el(
      "div",
      { class: "le-modal", role: "dialog", "aria-label": heading, "aria-modal": "true" },
      el("div", { class: "le-modal-card" }, el("h2", { class: "le-modal-head" }, heading), starRow, stats, verifyBadge, actions),
    );
    container.append(modal);
  }

  function failNow(): void {
    if (disposed || !binding || !container) return;
    stopLoop();
    const left = binding.remaining();
    const again = el("button", { class: "le-btn le-btn-primary", type: "button" }, "Try again");
    again.addEventListener("click", () => startGame(mode));
    const menu = el("button", { class: "le-btn", type: "button" }, "Menu");
    menu.addEventListener("click", () => {
      view = mode.kind === "level" ? "levels" : "daily";
      render();
    });
    const modal = el(
      "div",
      { class: "le-modal", role: "dialog", "aria-label": "Out of droplets", "aria-modal": "true" },
      el(
        "div",
        { class: "le-modal-card" },
        el("h2", { class: "le-modal-head" }, "Out of droplets"),
        el("p", { class: "le-fail-line" }, `${left} arrow${left === 1 ? "" : "s"} still tangled.`),
        el("div", { class: "le-modal-actions" }, again, menu),
      ),
    );
    container.append(modal);
  }

  // --- verifiable share (base64 of the pond-doc envelope) ---

  function encodeRecord(env: OutcomeEnvelope): string {
    const json = JSON.stringify(env);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  function decodeRecord(s: string): OutcomeEnvelope {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as OutcomeEnvelope;
  }

  /** Re-verify a record by replaying it through a fresh verifier binding. */
  async function reverify(env: OutcomeEnvelope): Promise<boolean> {
    try {
      verifier ??= await LooseEnds.load();
      verifier.newFromPacked(env.payload.seed);
      for (const id of env.payload.moves) verifier.tap(id);
      const hashOk = verifier.currentHash() === env.payload.final_hash;
      const resultOk = env.payload.result !== "Won" || verifier.isWon();
      return hashOk && resultOk;
    } catch {
      return false;
    }
  }

  async function showShared(payload: string): Promise<void> {
    if (!container) return;
    view = "shared";
    let env: OutcomeEnvelope;
    try {
      env = decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "le-error" }, "This shared result could not be read."));
      return;
    }
    const ok = await reverify(env);
    if (disposed || !container) return;
    const badge = el(
      "p",
      { class: `le-verify ${ok ? "ok" : "fail"}`, role: "status" },
      ok ? "Verified ✓ — replayed against the core." : "Verification failed — this result did not check out.",
    );
    const play = el("button", { class: "le-btn le-btn-primary", type: "button" }, "Play Loose Ends");
    play.addEventListener("click", () => {
      history.replaceState(null, "", location.pathname);
      view = "home";
      render();
    });
    container.replaceChildren(
      el(
        "section",
        { class: "le-shared" },
        el("h2", {}, env.payload.result === "Won" ? "A solved board" : "A shared result"),
        el("p", { class: "le-sub" }, `Cleared in ${env.payload.move_count} releases.`),
        badge,
        play,
      ),
    );
  }

  // --- E2E hook ---

  function exposeHook(): void {
    if (!binding) return;
    window.__looseends = {
      binding,
      board: () => binding!.board(),
      tapArrow: (id: number) => doTap(id),
      view: () => view,
      openLevel: (n: number) => startGame({ kind: "level", n }),
    };
  }

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "le-loading" }, "Loading Loose Ends…"));
      void (async () => {
        try {
          binding = await LooseEnds.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "le-error" }, "Could not load the game engine."));
          }
          return;
        }
        if (disposed) return;
        const shared = new URL(location.href).searchParams.get("r");
        if (shared) {
          await showShared(shared);
          exposeHook();
          return;
        }
        view = "home";
        render();
      })();
    },
    unmount(): void {
      disposed = true;
      stopLoop();
      delete window.__looseends;
      container?.replaceChildren();
      container = null;
      binding = null;
      verifier = null;
      canvas = null;
      ctx = null;
    },
  };
}
