//! The bubble-shooter board — a real aim-and-shoot game over the `bubble-wasm`
//! binding. A launcher at the bottom holds a colour; the player **aims an angle**
//! (drag/point on the board, the ←/→ keys, or the angle slider), sees a dotted
//! trajectory preview that bounces off the walls, and **fires** — the projectile
//! flies up, bounces, sticks where the core resolves it, and pops connected
//! clusters of 3+ (disconnected bubbles drop). The core owns every landing (the
//! UI only visualises the path it computes), so the outcome stays verifiable: on
//! a clear (or when shots run out) a `pond-outcome` record is shown, shareable
//! via `?r=`.

import type { GameModule } from "../../contract.js";
import { Bubble, type BoardView, type Geom } from "./bubble-wasm.js";
import { boardSubpixelSize, cellCenter, clampAngle, launcherOrigin, pointerToAngle } from "./bubble-aim.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type BubbleEnvelope,
  type VerifyResult,
} from "./bubble-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding, geometry, and aim/fire controls, so tests
     *  drive the real UI path against the core. */
    __bubble?: {
      game: Bubble;
      /** A second binding for control replays in the landing-matches-core guardrail. */
      verifier: Bubble;
      refresh: () => void;
      geom: Geom;
      seed: bigint;
      /** Set the aim angle (whole degrees, clamped to the fan) + redraw. */
      setAim: (deg: number) => void;
      /** The current aim angle. */
      aim: () => number;
      /** Fire the current aim; resolves once the shot has been applied. */
      fire: () => Promise<void>;
    };
  }
}

const BUBBLE_GLYPH = ["●", "▲", "■", "◆", "★", "✚"];
const BUBBLE_NAME = ["circle", "triangle", "square", "diamond", "star", "plus"];

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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ---------- the result screen (pure DOM) ----------

function headline(env: BubbleEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return env.payload.result === "Won"
    ? `Board cleared in ${env.payload.move_count} shots — verifiable`
    : "Ran out of shots — bubbles remain";
}

export interface ResultScreenOpts {
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the bubble result screen: outcome headline, verification badge, the
 *  record (result / score / shots / seed / hash), and share/re-verify controls. */
export function renderResultScreen(
  env: BubbleEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, verification)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every shot against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  row("Shots used", String(rec.move_count));
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

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
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s board" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- canvas palette (theme-aware) ----------

interface Palette {
  gems: string[];
  surface: string;
  ink: string;
  inkMuted: string;
  focus: string;
  active: string;
  aimLine: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    gems: [0, 1, 2, 3, 4, 5].map((i) => v(`--gem-${i}`, "#888")),
    surface: v("--surface", "#ffffff"),
    ink: v("--ink", "#111111"),
    inkMuted: v("--ink-muted", "#888888"),
    focus: v("--focus", "#3b82f6"),
    active: v("--active", "#10b981"),
    aimLine: v("--ink-muted", "#888888"),
  };
}

// ---------- the game module ----------

/** Construct a fresh bubble-shooter module (the registry `load`). */
export function bubbleModule(): GameModule {
  let game: Bubble | null = null;
  let verifier: Bubble | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let geom: Geom = { diam: 256, radius: 128, rowH: 222, fanLo: 10, fanHi: 170 };
  let aim = 90;
  let animating = false;
  let raf = 0;
  let canvas: HTMLCanvasElement | null = null;
  let aimInput: HTMLInputElement | null = null;
  let cascadeEl: HTMLElement | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: BubbleEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: BubbleEnvelope): VerifyResult => verifyRecord(verifier!, env);

  // The round is over when the board clears or the shot budget runs out.
  const gameOver = (): boolean => {
    if (!game) return false;
    const b = game.board();
    return b.cleared || b.shotsLeft === 0;
  };

  const origin = (board: BoardView) => launcherOrigin(board.width, board.height, geom);

  // ---------- canvas drawing ----------

  const drawBubble = (
    ctx: CanvasRenderingContext2D,
    p: Palette,
    x: number,
    y: number,
    color: number,
  ): void => {
    ctx.beginPath();
    ctx.arc(x, y, geom.radius * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = p.surface;
    ctx.fill();
    ctx.fillStyle = p.gems[color] ?? p.ink;
    ctx.font = `${Math.round(geom.radius * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BUBBLE_GLYPH[color] ?? "●", x, y + geom.radius * 0.06);
  };

  // Draw the board + launcher, plus (when `flight` is null) the dotted aim
  // preview, or (during a shot) the flying projectile at `flight`.
  const drawScene = (flight: { x: number; y: number } | null = null): void => {
    if (!canvas || !game) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const board = game.board();
    const p = palette();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    board.cells.forEach((rowCells, r) => {
      rowCells.forEach((color, c) => {
        if (color >= 0) {
          const { x, y } = cellCenter(r, c, geom);
          drawBubble(ctx, p, x, y, color);
        }
      });
    });

    const o = origin(board);
    if (!board.cleared) drawBubble(ctx, p, o.x, o.y, board.currentColor);

    if (flight) {
      drawBubble(ctx, p, flight.x, flight.y, board.currentColor);
      return;
    }
    if (gameOver()) return;

    // Dotted trajectory preview + a landing ring where the shot resolves.
    const traj = game.trajectory(aim);
    ctx.save();
    ctx.strokeStyle = p.aimLine;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(2, geom.radius * 0.16);
    ctx.setLineDash([geom.radius * 0.5, geom.radius * 0.7]);
    ctx.beginPath();
    traj.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();

    const [lr, lc] = traj.landing;
    const lp = cellCenter(lr, lc, geom);
    ctx.save();
    ctx.strokeStyle = p.active;
    ctx.lineWidth = Math.max(2, geom.radius * 0.16);
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, geom.radius * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // ---------- flight animation ----------

  const pathAt = (points: [number, number][], dist: number): { x: number; y: number } => {
    let acc = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const seg = Math.hypot(bx - ax, by - ay);
      if (acc + seg >= dist) {
        const t = seg === 0 ? 0 : (dist - acc) / seg;
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
      }
      acc += seg;
    }
    const last = points[points.length - 1]!;
    return { x: last[0], y: last[1] };
  };

  const animateFlight = (points: [number, number][]): Promise<void> =>
    new Promise((resolve) => {
      const total = points.slice(1).reduce((s, [x, y], i) => {
        const [px, py] = points[i]!;
        return s + Math.hypot(x - px, y - py);
      }, 0);
      const speed = geom.diam * 0.06; // sub-pixels per ms → ~short, snappy flight
      const dur = Math.min(700, Math.max(140, total / speed));
      const start = performance.now();
      const step = (now: number): void => {
        if (disposed) return resolve();
        const t = Math.min(1, (now - start) / dur);
        drawScene(pathAt(points, t * total));
        if (t >= 1) return resolve();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });

  const fire = async (): Promise<void> => {
    if (!game || gameOver() || animating) return;
    const angle = aim;
    const traj = game.trajectory(angle);
    setStatus(`Fired at ${angle} degrees`);
    animating = true;
    syncControlsDisabled();
    if (!prefersReducedMotion() && traj.points.length >= 2) {
      await animateFlight(traj.points);
    }
    animating = false;
    if (disposed || !game) return;
    game.shoot(angle);
    render();
  };

  // ---------- controls + interaction ----------

  const syncAim = (): void => {
    if (aimInput) aimInput.value = String(aim);
    if (canvas) canvas.setAttribute("aria-label", boardLabel());
  };

  const setAim = (deg: number): void => {
    aim = clampAngle(deg, geom);
    syncAim();
    if (!animating) drawScene();
  };

  const syncControlsDisabled = (): void => {
    const off = animating || gameOver();
    aimInput?.toggleAttribute("disabled", off);
    container?.querySelector<HTMLButtonElement>(".bub-fire")?.toggleAttribute("disabled", off);
  };

  const boardLabel = (): string => {
    if (!game) return "Bubble board";
    const b = game.board();
    const bubbles = b.cells.reduce((n, row) => n + row.filter((c) => c >= 0).length, 0);
    return `Bubble board: ${bubbles} bubbles left, ${b.shotsLeft} shots left, aiming ${aim} degrees`;
  };

  const canvasToSub = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas!.width,
      y: ((clientY - rect.top) / rect.height) * canvas!.height,
    };
  };

  const showHint = (): void => {
    if (!game || gameOver()) return;
    game.markAssistance();
    setAim(game.hintAngle());
    setStatus(`Hint: aim at ${aim} degrees (a hint counts as assistance)`);
  };

  const endNow = (): void => {
    setStatus("Ended — reporting the result honestly.");
    render(true);
  };

  const renderControls = (board: BoardView): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });

    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Board" });
    const daily = el(
      "button",
      { type: "button", class: "sol-mode-daily", "aria-pressed": String(mode === "daily") },
      "Today’s board",
    );
    const fresh = el(
      "button",
      { type: "button", class: "sol-new", "aria-pressed": String(mode === "free") },
      "New board",
    );
    daily.addEventListener("click", () => void startGame("daily"));
    fresh.addEventListener("click", () => void startGame("free"));
    modes.append(daily, fresh);

    const hints = hintsEnabled();
    const actionBtn = el(
      "button",
      { type: "button", class: hints ? "sol-hint" : "sol-stuck" },
      hints ? "Hint" : "I’m done",
    );
    actionBtn.addEventListener("click", hints ? showHint : endNow);

    const setting = (
      checked: boolean,
      label: string,
      cls: string,
      onChange: (on: boolean) => void,
    ): HTMLElement => {
      const wrap = el("label", { class: "sol-setting" });
      const input = el("input", { type: "checkbox", class: cls });
      (input as HTMLInputElement).checked = checked;
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      wrap.append(input, document.createTextNode(` ${label}`));
      return wrap;
    };
    const settings = el("details", { class: "sol-settings" });
    settings.append(
      el("summary", {}, "Settings"),
      setting(hints, "Enable hints", "sol-set-hints", (on) => {
        setHintsEnabled(on);
        render();
      }),
      setting(declareAssistanceEnabled(), "Declare assistance used", "sol-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
    );

    const color = board.currentColor;
    const hud = el(
      "div",
      { class: "bub-hud" },
      el(
        "span",
        {
          class: `bub-loaded bub-color-${color}`,
          role: "img",
          "aria-label": `Launcher loaded: ${BUBBLE_NAME[color] ?? "bubble"}`,
        },
        BUBBLE_GLYPH[color] ?? "●",
      ),
      el("span", { class: "bub-score" }, `Score ${board.score}`),
      el("span", { class: "bub-shots" }, `Shots left ${board.shotsLeft}`),
    );

    bar.append(modes, actionBtn, settings);
    const wrap = el("div");
    wrap.append(bar, hud);
    return wrap;
  };

  const renderAimBar = (): HTMLElement => {
    const bar = el("div", { class: "bub-aimbar" });
    const range = el("input", {
      type: "range",
      class: "bub-aim",
      min: String(geom.fanLo),
      max: String(geom.fanHi),
      value: String(aim),
      "aria-label": "Aim angle in degrees",
    }) as HTMLInputElement;
    range.addEventListener("input", () => setAim(Number(range.value)));
    aimInput = range;
    const fireBtn = el("button", { type: "button", class: "bub-fire" }, "Fire");
    fireBtn.addEventListener("click", () => void fire());
    bar.append(el("span", { class: "bub-aim-label" }, "Aim"), range, fireBtn);
    return bar;
  };

  const renderCanvas = (board: BoardView): HTMLCanvasElement => {
    const { w, h } = boardSubpixelSize(board.width, board.height, geom);
    const c = el("canvas", {
      class: "bub-canvas",
      width: String(w),
      height: String(h),
      tabindex: "0",
      role: "img",
    }) as HTMLCanvasElement;
    canvas = c;
    c.setAttribute("aria-label", boardLabel());

    const aimFromEvent = (e: PointerEvent): void => {
      if (animating || gameOver()) return;
      const s = canvasToSub(e.clientX, e.clientY);
      setAim(pointerToAngle(s.x, s.y, origin(board), geom));
    };
    c.addEventListener("pointermove", aimFromEvent);
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      aimFromEvent(e);
    });
    c.addEventListener("pointerup", (e) => {
      aimFromEvent(e);
      void fire();
    });
    c.addEventListener("keydown", (e) => {
      if (animating || gameOver()) return;
      if (e.key === "ArrowLeft") {
        setAim(aim + 2); // left = larger angle (toward 170°)
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setAim(aim - 2);
        e.preventDefault();
      } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp") {
        void fire();
        e.preventDefault();
      }
    });
    return c;
  };

  // A brief celebratory bubble cascade on a cleared board; decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    if (prefersReducedMotion()) return;
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      const s = el("span", { class: `gem-${i % 6}` }, BUBBLE_GLYPH[i % 6]!);
      s.style.left = `${(i * 4.15) % 100}%`;
      s.style.animationDelay = `${(i % 8) * 0.08}s`;
      layer.append(s);
    }
    document.body.append(layer);
    cascadeEl = layer;
    setTimeout(() => {
      layer.remove();
      if (cascadeEl === layer) cascadeEl = null;
    }, 1900);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as BubbleEnvelope;
    if (env.payload.result === "Won") playCascade();
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(mode),
      });
    container.replaceChildren(build());
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (raf) cancelAnimationFrame(raf);
    if (force || gameOver()) {
      canvas = null;
      aimInput = null;
      void presentResult();
      return;
    }
    const board = game.board();
    aim = clampAngle(aim, geom);
    container.replaceChildren(renderControls(board), renderCanvas(board), renderAimBar(), statusEl);
    syncControlsDisabled();
    drawScene();
    exposeHook();
  }

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    game.newGame(seed);
    geom = game.geom();
    aim = clampAngle(90, geom);
    animating = false;
    setStatus("");
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: BubbleEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shared: true,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
      });
    container.replaceChildren(build());
  };

  const exposeHook = (): void => {
    if (!game || !verifier) return;
    window.__bubble = {
      game,
      verifier,
      refresh: () => render(),
      geom,
      seed,
      setAim,
      aim: () => aim,
      fire,
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading bubble shooter…"));
      void (async () => {
        try {
          game = await Bubble.load();
          verifier = await Bubble.load();
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
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          await startGame("free", BigInt(seedParam));
          return;
        }
        await startGame("daily");
      })();
    },
    unmount(): void {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      delete window.__bubble;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      canvas = null;
      aimInput = null;
      game = null;
      verifier = null;
    },
  };
}
