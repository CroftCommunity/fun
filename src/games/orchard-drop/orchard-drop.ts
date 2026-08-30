//! Orchard Drop — a Croft-native fruit-merge game over the `orchard-wasm`
//! binding.
//!
//! Drop fruit into the crate; two of the same merge into the next one up an
//! eleven-step ladder. **The core decides everything**: the drop cooldown, where
//! an aim off the edge lands, which two of three touching fruit merge, and when
//! the crate has overflowed. This file aims, draws, and reports — it never
//! re-implements a rule, because a rule decided here would be one the record
//! could not verify.
//!
//! A finished run emits a `pond-outcome` record and a `?r=` share that
//! re-verifies before it displays.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec } from "../../game-frame.js";
import type { SettingRow } from "../../settings-sheet.js";
import { dayIndexUTC } from "../share.js";
import {
  bestScore,
  decodeRecord,
  dropCount,
  encodeRecord,
  envelope,
  headline,
  recordBest,
  verifyRecord,
  type OrchardEnvelope,
  type OrchardRecord,
} from "./orchard-drop-outcome.js";
import { OrchardDrop, type WorldView } from "./orchard-wasm.js";
import { CRATE_H, CRATE_W, describe, draw, fruitName } from "./render.js";

/** Simulation rate. Matches the core; the loop converts wall-clock to ticks. */
const TICK_HZ = 64;

declare global {
  interface Window {
    /**
     * E2E hook: aim, drop, read the world, and advance time.
     *
     * `fastForward` exists because the run is wall-clock driven, and a test that
     * had to wait real seconds for a crate to fill would be both slow and flaky.
     * It adds ticks to the same clock the game reads, so the core sees exactly
     * what it would have seen — the test skips the waiting, not the rules.
     */
    __orchard?: OrchardTestHooks;
  }
}

/** The handles the e2e spec drives, so a test never has to fake a gesture. */
interface OrchardTestHooks {
  aim(x: number): void;
  release(): void;
  world(): WorldView | null;
  fastForward(ticks: number): void;
  over(): boolean;
}

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

type ModeChoice = "daily" | "free";
const MODE_LABEL: Record<ModeChoice, string> = { daily: "Daily", free: "Free play" };

// The New game card's choice lives at module scope: the poster renders the card
// before the module exists, and the module reads it when a run starts.
let chosenMode: ModeChoice = "daily";

/** The New game card: today's crate, or a fresh one. */
export function orchardSetupRows(): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "mode",
      label: "Mode",
      hint: "The daily crate is the same for everyone today, so a score is worth comparing. Free play deals a fresh crate.",
      value: chosenMode,
      options: [
        { value: "daily", label: "Daily" },
        { value: "free", label: "Free play" },
      ],
      onChange: (v) => {
        chosenMode = v === "free" ? "free" : "daily";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const orchardSetup = (): SettingRow[] => orchardSetupRows();

/** Construct a fresh Orchard Drop module (the registry `load`). */
export function orchardDropModule(): GameModule {
  let binding: OrchardDrop | null = null;
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let raf = 0;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let startedAt = 0;
  let aimX = CRATE_W / 2;
  let held = 0;
  let over = false;
  let scoreNow = 0;
  /** Ticks added by the keyboard/test fast-forward, on top of wall clock. */
  let extraTicks = 0;

  // ---------- DOM ----------
  const status = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  let gf: GameFrame | null = null;
  let toasted = false;
  /** The last stats the meters showed — the loop syncs every frame; the frame is told only on a change. */
  let shown = "";
  const result = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });

  /** The tick the core should be at, from wall clock plus any fast-forward. */
  function nowTick(): number {
    if (startedAt === 0) return extraTicks;
    return Math.floor(((performance.now() - startedAt) / 1000) * TICK_HZ) + extraTicks;
  }

  function frame(): { fruit: WorldView["fruit"]; aimX: number | null; heldTier: number; over: boolean } {
    const w = binding?.world();
    return {
      fruit: w?.fruit ?? [],
      aimX: over ? null : aimX,
      heldTier: held,
      over,
    };
  }

  /**
   * Pull the core's state into the UI, firing the end screen on the **rising
   * edge** of game-over.
   *
   * One place owns `over`. An earlier version let `paint` assign it too, so by
   * the time a caller asked "did it just end?" the flag was already true and the
   * end screen never appeared — a derived flag written in two places, which is a
   * bug that reads as correct in both of them.
   */
  function sync(): void {
    if (!binding) return;
    const w = binding.world();
    if (!w) return;
    held = w.held;
    scoreNow = w.score;
    declareIfChanged();
    if (w.over && !over) {
      over = true;
      finish();
    }
  }

  function paint(): void {
    if (!canvas || !binding) return;
    sync();
    draw(canvas, frame());
  }

  function announce(): void {
    if (!binding) return;
    status.textContent = describe(frame(), scoreNow);
  }

  /** One animation frame: advance the core to the wall-clock tick, then draw. */
  function tick(): void {
    if (disposed || !binding) return;
    if (!over) binding.waitUntil(nowTick());
    paint();
    raf = requestAnimationFrame(tick);
  }

  // ---------- input: the core decides, this only aims ----------

  function clampAim(x: number): number {
    return Math.max(0, Math.min(CRATE_W, Math.round(x)));
  }

  function aimFromEvent(e: PointerEvent): void {
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    aimX = clampAim(((e.clientX - box.left) / box.width) * CRATE_W);
  }

  function release(): void {
    if (!binding || over) return;
    // The core is asked; if it refuses (the cooldown has not elapsed) that is
    // the answer, and the UI does not second-guess it or track its own timer.
    const outcome = binding.drop(nowTick(), aimX);
    if (outcome === "dropped") announce();
  }

  // ---------- the end screen ----------

  function finish(): void {
    if (!binding) return;
    const json = binding.record();
    if (!json) return;
    const record = JSON.parse(json) as OrchardRecord;
    const env = envelope(record);
    const v = verifyRecord(binding, env);
    recordBest(record.score ?? 0);
    shown = "";
    declareIfChanged();
    announce();
    showResult(env, v.ok);
  }

  function showResult(env: OrchardEnvelope, verified: boolean): void {
    result.replaceChildren();
    const rec = env.payload;
    result.append(
      el("h2", {}, headline(env, { ok: verified, expected: "", actual: "" })),
      el(
        "dl",
        { class: "orch-result-rows" },
        el("div", {}, el("dt", {}, "Score"), el("dd", {}, String(rec.score ?? 0))),
        el("div", {}, el("dt", {}, "Drops"), el("dd", {}, String(dropCount(rec)))),
        el("div", {}, el("dt", {}, "Best"), el("dd", {}, String(bestScore()))),
      ),
    );

    const controls = el("div", { class: "sol-result-controls" });

    const reverify = el("button", { type: "button" }, "Re-verify");
    reverify.addEventListener("click", () => {
      if (!binding) return;
      const again = verifyRecord(binding, env);
      status.textContent = again.ok
        ? "Re-verified: the record replays to the same result."
        : "This record did not verify.";
    });

    const share = el("button", { type: "button", class: "sol-share" }, "Copy share link");
    share.addEventListener("click", () => {
      void (async () => {
        const payload = await encodeRecord(env);
        const url = `${location.origin}${location.pathname}?r=${payload}`;
        try {
          await navigator.clipboard.writeText(url);
          status.textContent = "Share link copied. Opening it re-checks the run.";
        } catch {
          status.textContent = url;
        }
      })();
    });

    const again = el("button", { type: "button" }, "Play again");
    again.addEventListener("click", () => {
      void start(mode);
    });

    controls.append(reverify, share, again);
    result.append(controls);
    result.hidden = false;
  }

  /** Open a shared record: **re-verify before display**, never trust it. */
  async function openShared(payload: string): Promise<boolean> {
    if (!binding) return false;
    try {
      const env = await decodeRecord(payload);
      const v = verifyRecord(binding, env);
      showResult(env, v.ok);
      status.textContent = v.ok
        ? "A shared run, re-checked here: it replays to the result it claims."
        : "This shared record did not verify, so its result is not shown as proven.";
      return true;
    } catch {
      status.textContent = "That share link could not be read.";
      return false;
    }
  }

  // ---------- lifecycle ----------

  // --- what the frame shows: score, best and the next fruit; the mode chip; New game ---
  const spec = (): GameFrameSpec => {
    const w = binding?.world();
    return {
      title: "Orchard Drop",
      mode: MODE_LABEL[mode],
      meters: [
        { kind: "stat", id: "score", value: w?.score ?? 0, label: "score" },
        { kind: "stat", id: "best", value: bestScore(), label: "best" },
        { kind: "stat", id: "next", value: w ? fruitName(w.next) : "—", label: "next" },
      ],
      verbs: [{ id: "new", label: "New game", icon: "⟳", onPress: (btn) => gf?.openSheet("setup", btn) }],
      setup: orchardSetupRows(),
      preferences: [],
      onStart: () => void start(chosenMode),
    };
  };
  const declare = (): void => gf?.update(spec());
  const declareIfChanged = (): void => {
    const w = binding?.world();
    const key = `${w?.score ?? 0}|${bestScore()}|${w?.next ?? -1}|${mode}`;
    if (key === shown) return;
    shown = key;
    declare();
  };

  async function start(next: "daily" | "free"): Promise<void> {
    if (!binding) return;
    mode = next;
    chosenMode = next;
    const params = new URLSearchParams(location.search);
    const override = params.get("seed");
    seed =
      override !== null
        ? BigInt(override)
        : next === "daily"
          ? binding.dailySeed(dayIndexUTC(new Date()))
          : BigInt(Math.floor(Math.random() * 0xffffffff));
    binding.newGame(seed);
    startedAt = performance.now();
    extraTicks = 0;
    aimX = CRATE_W / 2;
    over = false;
    result.hidden = true;
    result.replaceChildren();
    shown = "";
    declareIfChanged();
    paint();
    announce();
    if (!toasted) {
      toasted = true;
      gf?.toast("Drag across the crate to aim, let go to drop. Two of a kind merge into the next fruit up; keep the crate from overflowing.", 6000);
    }
  }

  return {
    mount(container: HTMLElement, services?: GameServices): void {
      host = container;
      gf = services?.frame ?? null;
      disposed = false;
      declare();

      canvas = el("canvas", {
        class: "orch-canvas",
        role: "img",
        "aria-label": "The fruit crate",
      });
      // The canvas is opaque to assistive technology, so the live region beside
      // it is the accessible view of the same state — not a courtesy, the
      // actual interface for anyone not looking at pixels.
      canvas.style.aspectRatio = `${CRATE_W} / ${CRATE_H}`;

      // Tap-first: drag anywhere across the crate to aim, release to drop.
      canvas.addEventListener("pointerdown", (e) => {
        canvas?.setPointerCapture(e.pointerId);
        aimFromEvent(e);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (e.pressure > 0 || e.buttons > 0) aimFromEvent(e);
      });
      canvas.addEventListener("pointerup", (e) => {
        aimFromEvent(e);
        release();
      });

      // Full keyboard control, with the same reach as the pointer.
      const surface = el("div", { class: "orch-surface", tabindex: "0", role: "application" });
      surface.setAttribute("aria-label", "Orchard Drop crate. Left and right arrows aim, space drops.");
      surface.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
          aimX = clampAim(aimX - 18);
          e.preventDefault();
        } else if (e.key === "ArrowRight") {
          aimX = clampAim(aimX + 18);
          e.preventDefault();
        } else if (e.key === " " || e.key === "Spacebar") {
          release();
          e.preventDefault();
        } else {
          return;
        }
        paint();
        announce();
      });

      surface.append(canvas);
      container.replaceChildren(surface, status, result);
      result.hidden = true;

      window.__orchard = {
        aim: (x) => {
          aimX = clampAim(x);
          paint();
        },
        release,
        world: () => binding?.world() ?? null,
        fastForward: (ticks) => {
          extraTicks += ticks;
          if (binding && !over) binding.waitUntil(nowTick());
          paint();
        },
        over: () => over,
      };

      void (async () => {
        binding = await OrchardDrop.load("/orchard-drop.wasm");
        if (disposed) return;
        const params = new URLSearchParams(location.search);
        const shared = params.get("r");
        // A `?seed=` deep link is a free-play run of that seed, as on every other
        // shelf game; the daily is the day's seed and nothing else.
        await start(params.get("seed") !== null ? "free" : chosenMode);
        if (shared !== null) await openShared(shared);
        // No `prefers-reduced-motion` branch: in this game the motion IS the
        // game. There is no decorative animation to strip, and a still crate
        // would not be a reduced experience, it would be no experience. The
        // setting is honoured where the shelf has motion to spare — the chrome.
        raf = requestAnimationFrame(tick);
      })();
    },

    unmount(): void {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      binding = null;
      canvas = null;
      host?.replaceChildren();
      host = null;
      gf = null;
      delete window.__orchard;
    },
  };
}
