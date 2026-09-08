//! Beats — life on the versus boards (phase 9 of the play-surface plan, mock F
//! Q11). Before this the six versus games and cribbage had one animation
//! between them (Drop 4's win pop): a capture, a king, a flip of four, a closed
//! box, a pegged fifteen-two looked like an ordinary move. Six games each
//! doing their own animation would be the drift the frame was built to end, so
//! this is one vocabulary:
//!
//! - **drop** — a disc falls into its slot and settles (Drop 4).
//! - **flip** — a disc turns over (Othello), staggered outward from the play.
//! - **slide** — a piece glides a short way (a hop).
//! - **shrink** — a taken piece shrinks out where it stood (checkers, chess),
//!   as a `ghost` over the stage, because the real node is already gone.
//! - **line** — a pulse along something completed (a closed box, a four).
//! - **tick** — a counter nudges (a store, a score).
//! - **word** — one word over the stage: "Capture!", "King!", "Fifteen two".
//!
//! Three rules, kept here so no game keeps its own copy:
//!
//! 1. **A beat shows how a move happened; it never decides one.** Every call
//!    comes AFTER the core applied the move and the DOM re-rendered to the true
//!    state (Color Sort's pour set the rule). A tap during a beat acts on the
//!    real board.
//! 2. **Reduced motion collapses each beat to its last frame.** The board is
//!    already at rest, so a motion beat becomes nothing; a word appears and goes
//!    without moving. The stage's `data-beat` is still written — the beat
//!    happened, and a test reads that seam rather than racing an animation.
//! 3. **One voice per beat, under the Sound row.** A short synthesised cue,
//!    zero bytes shipped, silent unless Sound is on.

import { MUSIC_KEY, resolveMusic } from "./music.js";

/** The shelf's Sound row (`fun-music`), read at play time so a flip applies at once. */
function soundEnabled(): boolean {
  try {
    return resolveMusic(localStorage.getItem(MUSIC_KEY));
  } catch {
    return false;
  }
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

export type BeatKind = "drop" | "flip" | "slide" | "shrink" | "line" | "tick" | "word";
export const BEAT_KINDS: readonly BeatKind[] = ["drop", "flip", "slide", "shrink", "line", "tick", "word"];

/** One synthesised note of a cue. */
export interface Note {
  readonly hz: number;
  readonly to?: number;
  readonly at: number;
  readonly ms: number;
  readonly gain: number;
  readonly wave: OscillatorType;
}

/** What a beat is: its keyframes, its length, its easing, its voice. */
export interface BeatSpec {
  readonly frames: Keyframe[];
  readonly ms: number;
  readonly easing: string;
  readonly cue: readonly Note[];
}

export interface BeatOptions {
  /** drop: how far the disc falls; slide: how far it moves (px). */
  readonly distancePx?: number;
  /** slide: the direction, as a unit vector-ish pair. */
  readonly dx?: number;
  readonly dy?: number;
}

/** The vocabulary, as data. Pure. */
export function beatSpec(kind: BeatKind, opts: BeatOptions = {}): BeatSpec {
  const d = Math.max(0, opts.distancePx ?? 0);
  switch (kind) {
    case "drop":
      return {
        frames: [
          { transform: `translateY(${-d}px)`, offset: 0 },
          { transform: "translateY(0px)", offset: 0.7 },
          { transform: "translateY(-6px)", offset: 0.85 },
          { transform: "translateY(0px)", offset: 1 },
        ],
        ms: Math.round(220 + Math.min(d, 600) * 0.6),
        easing: "cubic-bezier(.3, 1, .6, 1)",
        cue: [{ hz: 170, to: 90, at: 0, ms: 120, gain: 0.25, wave: "sine" }],
      };
    case "flip":
      return {
        frames: [
          { transform: "rotateY(0deg)" },
          { transform: "rotateY(90deg)", offset: 0.5 },
          { transform: "rotateY(0deg)" },
        ],
        ms: 260,
        easing: "ease-in-out",
        cue: [{ hz: 660, at: 0, ms: 40, gain: 0.12, wave: "triangle" }],
      };
    case "slide":
      return {
        frames: [{ transform: `translate(${-(opts.dx ?? 0) * d}px, ${-(opts.dy ?? 0) * d}px)` }, { transform: "translate(0px, 0px)" }],
        ms: 180,
        easing: "ease-out",
        cue: [{ hz: 420, to: 520, at: 0, ms: 80, gain: 0.1, wave: "sine" }],
      };
    case "shrink":
      return {
        frames: [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(1.15)", opacity: 1, offset: 0.25 },
          { transform: "scale(0)", opacity: 0 },
        ],
        ms: 320,
        easing: "ease-in",
        cue: [{ hz: 400, to: 180, at: 0, ms: 160, gain: 0.18, wave: "sawtooth" }],
      };
    case "line":
      return {
        frames: [{ transform: "scale(1)" }, { transform: "scale(1.08)", offset: 0.5 }, { transform: "scale(1)" }],
        ms: 420,
        easing: "ease-in-out",
        cue: [
          { hz: 523, at: 0, ms: 200, gain: 0.12, wave: "triangle" },
          { hz: 659, at: 60, ms: 200, gain: 0.12, wave: "triangle" },
          { hz: 784, at: 120, ms: 260, gain: 0.12, wave: "triangle" },
        ],
      };
    case "tick":
      return {
        frames: [{ transform: "scale(1)" }, { transform: "scale(1.25)", offset: 0.4 }, { transform: "scale(1)" }],
        ms: 240,
        easing: "ease-out",
        cue: [{ hz: 880, at: 0, ms: 30, gain: 0.1, wave: "square" }],
      };
    case "word":
      return {
        frames: [
          { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1.08)", opacity: 1, offset: 0.2 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.8 },
          { transform: "translate(-50%, -60%) scale(1)", opacity: 0 },
        ],
        ms: 1100,
        easing: "ease-out",
        cue: [
          { hz: 523, at: 0, ms: 120, gain: 0.14, wave: "triangle" },
          { hz: 784, at: 110, ms: 220, gain: 0.14, wave: "triangle" },
        ],
      };
  }
}

/** The player's motion preference, read each time (it can change mid-game). */
export function reducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const stageOf = (node: Element): HTMLElement | null => node.closest<HTMLElement>(".gf-stage");

/** The test seam: the last beat the stage saw, whatever motion did or did not run. */
function mark(stage: Element | null, kind: BeatKind): void {
  if (stage instanceof HTMLElement) stage.dataset.beat = kind;
}

type Animatable = Element & { animate?: (frames: Keyframe[], opts: KeyframeAnimationOptions) => Animation };

/**
 * Play one beat on one element. Returns the Animation, or null when there is
 * nothing to run (reduced motion, or no Web Animations) — the beat is still
 * recorded on the stage.
 */
export function beat(node: Element, kind: BeatKind, opts: BeatOptions & { readonly delay?: number } = {}): Animation | null {
  mark(stageOf(node), kind);
  const target = node as Animatable;
  if (reducedMotion() || typeof target.animate !== "function") return null;
  const spec = beatSpec(kind, opts);
  return target.animate(spec.frames, { duration: spec.ms, easing: spec.easing, delay: opts.delay ?? 0, fill: "none" });
}

/** The same beat on each element, staggered — `beatEach(flipped, "flip", 60)`. */
export function beatEach(nodes: readonly Element[], kind: BeatKind, staggerMs: number, opts: BeatOptions = {}): void {
  nodes.forEach((n, i) => beat(n, kind, { ...opts, delay: i * staggerMs }));
}

/** A piece that moved slides in from the box it left: the slide beat, measured. */
export function slideFrom(moved: Element, from: Element): Animation | null {
  const a = moved.getBoundingClientRect();
  const b = from.getBoundingClientRect();
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  const d = Math.hypot(dx, dy);
  if (d < 1) return null;
  return beat(moved, "slide", { distancePx: d, dx: dx / d, dy: dy / d });
}

let wordTimer = 0;

/** One word over the stage. A second word replaces the first. */
export function beatWord(stage: HTMLElement, text: string): HTMLElement {
  stage.querySelector(".gf-beat-word")?.remove();
  window.clearTimeout(wordTimer);
  const w = el("div", { class: "gf-beat-word", "aria-hidden": "true" }, text);
  stage.append(w);
  const spec = beatSpec("word");
  mark(stage, "word");
  const anim = reducedMotion() || typeof (w as Animatable).animate !== "function" ? null : (w as Animatable).animate!(spec.frames, { duration: spec.ms, easing: spec.easing, fill: "forwards" });
  wordTimer = window.setTimeout(() => w.remove(), spec.ms);
  void anim;
  return w;
}

/**
 * A taken piece shrinks out where it stood: `from` is cloned over the stage at
 * `at`'s box (the real piece is already gone from the re-rendered board, so the
 * caller rebuilds its node and names the square it stood on).
 */
export function ghost(stage: HTMLElement, from: Element, at: Element = from): HTMLElement {
  const g = from.cloneNode(true) as HTMLElement;
  g.classList.add("gf-beat-ghost");
  g.setAttribute("aria-hidden", "true");
  const sb = stage.getBoundingClientRect();
  const fb = at.getBoundingClientRect();
  g.style.left = `${fb.left - sb.left + stage.scrollLeft}px`;
  g.style.top = `${fb.top - sb.top + stage.scrollTop}px`;
  g.style.width = `${fb.width}px`;
  g.style.height = `${fb.height}px`;
  stage.append(g);
  beat(g, "shrink");
  window.setTimeout(() => g.remove(), beatSpec("shrink").ms);
  return g;
}

let ctx: AudioContext | null = null;

/** The beat's voice, if Sound is on. Silent about every failure. */
export function beatSound(kind: BeatKind): void {
  if (!soundEnabled() || typeof AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of beatSpec(kind).cue) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.wave;
      osc.frequency.setValueAtTime(n.hz, t0 + n.at / 1000);
      if (n.to !== undefined) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + (n.at + n.ms) / 1000);
      g.gain.setValueAtTime(0.0001, t0 + n.at / 1000);
      g.gain.exponentialRampToValueAtTime(n.gain, t0 + (n.at + 8) / 1000);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (n.at + n.ms) / 1000);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + n.at / 1000);
      osc.stop(t0 + (n.at + n.ms) / 1000 + 0.02);
    }
  } catch {
    // Audio is decoration.
  }
}
