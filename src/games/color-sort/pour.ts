//! The pour — the art of the move (mock E proposal 3; plan D1/D2). Zero
//! dependencies: a choreography of Web Animations on the DOM the game has
//! ALREADY re-rendered to the true state. The core applied the move at tap time;
//! this only shows how it happened, so a tap during the animation acts on the
//! real board and the next pour simply cancels this one.
//!
//! Water: the source lifts, travels and tilts about its LIP (the transform
//! origin is the mouth corner facing the target) until the spout is over the
//! target's mouth, a stream bridges the two while each moved unit leaves the
//! source (a ghost unit shrinking toward the mouth) and arrives in the target
//! (the real unit growing from the bottom), then the tube returns.
//! Balls: no tilt — each ball hops an arc from its old slot to its new one.
//! Bolts: no tilt — each nut unscrews (spinning as it rises off the thread),
//! carries level, and screws down onto the target.
//! Off (or reduced motion): no transforms; the arrived units cross-fade in.
//!
//! The pure half — timings, the plan, the docking geometry — is exported and
//! unit-tested; the DOM half consumes it.

import type { ColorSortSkin, PourSpeed } from "../../settings.js";

export type { PourSpeed };

/** Milliseconds per phase of a water pour. */
export interface PourTimings {
  readonly lift: number;
  readonly travel: number;
  readonly perUnit: number;
  readonly ret: number;
}

const NORMAL: PourTimings = { lift: 120, travel: 200, perUnit: 160, ret: 200 };
const SCALE: Record<PourSpeed, number> = { slow: 1.75, normal: 1, fast: 0.5, off: 0 };

/** The mock's numbers at Normal, scaled for Slow and Fast, zero for Off. */
export function pourTimings(speed: PourSpeed): PourTimings {
  const k = SCALE[speed];
  return { lift: NORMAL.lift * k, travel: NORMAL.travel * k, perUnit: NORMAL.perUnit * k, ret: NORMAL.ret * k };
}

const BALL_HOP = 140;
const BOLT = { unscrew: 200, carry: 150, screw: 200 };
const FADE = 150;
/** How far the source rises before it travels, and how high the spout hovers over the target. */
export const LIFT_PX = 14;
export const HOVER_PX = 32;
/** How far inside the target's lip the spout docks. */
export const LIP_INSET_PX = 8;
/** Past horizontal: a physically small tilt "reads as stuck" (Decanta's finding). */
export const TILT_DEG = 104;

/** One step of a plan. */
export interface PourStep {
  readonly id: string;
  readonly ms: number;
}

/** The docking geometry: how the source moves so its spout is over the target's mouth. */
export interface PourGeometry {
  /** The lip corner the tube rotates about — `"100% 0"` pouring right, `"0 0"` pouring left. */
  readonly origin: string;
  readonly dx: number;
  readonly dy: number;
  /** Degrees; positive (clockwise) pouring right, negative pouring left. */
  readonly tilt: number;
}

/** What a pour will do — read back by the parity spec (mock E3.x). */
export interface PourPlan {
  readonly skin: ColorSortSkin;
  readonly speed: PourSpeed;
  readonly units: number;
  readonly from: number;
  readonly to: number;
  readonly reverse: boolean;
  readonly tilts: boolean;
  readonly steps: readonly PourStep[];
  readonly total: number;
  readonly geometry: PourGeometry | null;
}

/** The plan for a pour: which steps, how long each, whether the tube tilts. */
export function pourPlan(opts: {
  skin: ColorSortSkin;
  speed: PourSpeed;
  units: number;
  from?: number;
  to?: number;
  reverse?: boolean;
  geometry?: PourGeometry | null;
}): PourPlan {
  const { skin, speed, units } = opts;
  const reverse = opts.reverse ?? false;
  const k = reverse ? 0.5 : 1;
  let steps: PourStep[];
  let tilts = false;
  if (speed === "off") {
    steps = [{ id: "fade", ms: FADE }];
  } else if (skin === "ball") {
    const s = SCALE[speed] * k;
    steps = [
      { id: "lift", ms: NORMAL.lift * s },
      ...Array.from({ length: units }, (_, i) => ({ id: `hop-${i}`, ms: BALL_HOP * s })),
      { id: "return", ms: NORMAL.ret * s },
    ];
  } else if (skin === "bolt") {
    const s = SCALE[speed] * k;
    steps = Array.from({ length: units }, (_, i) => [
      { id: `unscrew-${i}`, ms: BOLT.unscrew * s },
      { id: `carry-${i}`, ms: BOLT.carry * s },
      { id: `screw-${i}`, ms: BOLT.screw * s },
    ]).flat();
  } else {
    const t = pourTimings(speed);
    tilts = true;
    steps = [
      { id: "lift", ms: t.lift * k },
      { id: "travel", ms: t.travel * k },
      ...Array.from({ length: units }, (_, i) => ({ id: `unit-${i}`, ms: t.perUnit * k })),
      { id: "return", ms: t.ret * k },
    ];
  }
  return {
    skin,
    speed,
    units,
    from: opts.from ?? -1,
    to: opts.to ?? -1,
    reverse,
    tilts,
    steps,
    total: steps.reduce((a, s) => a + s.ms, 0),
    geometry: tilts ? (opts.geometry ?? null) : null,
  };
}

/** Pure: where the source must go so its spout hangs over the target's mouth. */
export function pourGeometry(src: DOMRect, dst: DOMRect): PourGeometry {
  const right = src.left < dst.left;
  const dy = dst.top - HOVER_PX - src.top;
  return right
    ? { origin: "100% 0", dx: dst.left + LIP_INSET_PX - src.right, dy, tilt: TILT_DEG }
    : { origin: "0 0", dx: dst.right - LIP_INSET_PX - src.left, dy, tilt: -TILT_DEG };
}

// ---------------------------------------------------------------------------
// The DOM half.

/** What the DOM half needs: the two tube buttons after the re-render, the board, and the move. */
export interface PourScene {
  readonly board: HTMLElement;
  readonly source: HTMLElement;
  readonly target: HTMLElement;
  readonly units: number;
  /** The colour that moved, as a CSS colour. */
  readonly color: string;
  /** How many units the target held BEFORE the pour (its arrived units sit above them). */
  readonly targetBefore: number;
  /** How many units the source holds AFTER the pour (its ghosts sit above them). */
  readonly sourceAfter: number;
  readonly icon?: string;
}

/** A running pour; `cancel()` when the next one starts or the DOM is replaced. */
export interface RunningPour {
  readonly plan: PourPlan;
  readonly done: Promise<void>;
  cancel(): void;
}

function slots(tube: HTMLElement): HTMLElement[] {
  return Array.from(tube.querySelectorAll<HTMLElement>(".cs-slot"));
}

function ghostUnit(color: string, icon: string | undefined, extra: string): HTMLElement {
  const g = document.createElement("div");
  g.className = `cs-unit cs-ghost ${extra}`;
  g.style.setProperty("--cs-fill", color);
  g.setAttribute("aria-hidden", "true");
  if (icon) {
    const i = document.createElement("span");
    i.className = "cs-icon";
    i.textContent = icon;
    g.append(i);
  }
  return g;
}

function offsetWithin(el: Element, board: HTMLElement): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  return { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
}

/**
 * Run a pour. The scene is the re-rendered DOM (true state). Returns at once with
 * the plan; the animation runs to `done`. Every animation carries an `id`
 * beginning `cs-pour-` so a spec can read it back, and every one is cancelled
 * by `cancel()` so a cancelled pour leaves no `fill: forwards` behind.
 */
export function runPour(scene: PourScene, opts: { skin: ColorSortSkin; speed: PourSpeed; from: number; to: number; reverse?: boolean }): RunningPour {
  const { board, source, target, units } = scene;
  const geometry = pourGeometry(source.getBoundingClientRect(), target.getBoundingClientRect());
  const plan = pourPlan({ ...opts, units, geometry });
  const anims: Animation[] = [];
  const extras: Element[] = [];
  let cancelled = false;
  const run = (el: Element, frames: Keyframe[], timing: KeyframeAnimationOptions): Animation => {
    const a = el.animate(frames, timing);
    anims.push(a);
    return a;
  };
  const step = (id: string): number => plan.steps.find((s) => s.id === id)?.ms ?? 0;
  const alive = (): boolean => !cancelled && source.isConnected && target.isConnected;
  const wait = async (a: Animation): Promise<void> => {
    try {
      await a.finished;
    } catch {
      // cancelled — the caller checks alive()
    }
  };
  const cleanup = (): void => {
    for (const a of anims) a.cancel();
    for (const e of extras) e.remove();
    source.style.removeProperty("will-change");
    source.style.removeProperty("transform-origin");
    source.classList.remove("cs-pouring");
  };

  // The arrived units (real DOM, in the target) and the ghosts (in the source's emptied slots).
  const targetSlots = slots(target);
  const arrived = Array.from({ length: units }, (_, i) => targetSlots[scene.targetBefore + i]?.firstElementChild as HTMLElement | null);
  const sourceSlots = slots(source);
  const ghosts: HTMLElement[] = [];
  if (plan.speed !== "off") {
    for (let i = 0; i < units; i++) {
      const slot = sourceSlots[scene.sourceAfter + i];
      if (!slot) continue;
      const g = ghostUnit(scene.color, scene.icon, plan.skin === "water" ? "" : "cs-ghost-unit");
      slot.append(g);
      extras.push(g);
      ghosts.push(g);
    }
  }

  const done = (async (): Promise<void> => {
    if (plan.speed === "off") {
      for (const u of arrived) {
        if (u) run(u, [{ opacity: 0 }, { opacity: 1 }], { duration: step("fade"), id: "cs-pour-fade" });
      }
      await Promise.all(anims.map(wait));
      return;
    }
    for (const u of arrived) if (u) u.style.opacity = "0";
    source.classList.add("cs-pouring");
    source.style.willChange = "transform";

    if (plan.skin === "water") await water();
    else if (plan.skin === "ball") await balls();
    else await bolts();
  })()
    .catch(() => undefined)
    .finally(() => {
      for (const u of arrived) u?.style.removeProperty("opacity");
      cleanup();
    });

  async function water(): Promise<void> {
    const g = geometry;
    source.style.transformOrigin = g.origin;
    const lifted = `translateY(${-LIFT_PX}px)`;
    const docked = `translate(${g.dx}px, ${g.dy}px) rotate(${g.tilt}deg)`;
    await wait(run(source, [{ transform: "translateY(0)" }, { transform: lifted }], { duration: step("lift"), easing: "ease-out", fill: "forwards", id: "cs-pour-lift" }));
    if (!alive()) return;
    await wait(run(source, [{ transform: lifted }, { transform: docked }], { duration: step("travel"), easing: "linear", fill: "forwards", id: "cs-pour-travel" }));
    if (!alive()) return;
    // The stream: from the spout down to the target's surface before the pour.
    const stream = document.createElement("div");
    stream.className = "cs-stream";
    stream.style.setProperty("--cs-fill", scene.color);
    const t = offsetWithin(target, board);
    const stack = target.querySelector(".cs-stack") ?? target;
    const st = offsetWithin(stack, board);
    const unitH = targetSlots[0]?.getBoundingClientRect().height ?? 0;
    const surfaceY = st.top + st.height - scene.targetBefore * unitH - 2;
    const spoutX = g.tilt > 0 ? t.left + LIP_INSET_PX : t.left + t.width - LIP_INSET_PX;
    const spoutY = t.top - HOVER_PX;
    stream.style.left = `${spoutX - 3}px`;
    stream.style.top = `${spoutY}px`;
    stream.style.height = `${Math.max(0, surfaceY - spoutY)}px`;
    board.append(stream);
    extras.push(stream);
    run(stream, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: Math.max(1, step("unit-0") * 0.4), fill: "forwards", easing: "ease-in", id: "cs-pour-stream" });
    // Units leave top-first and arrive bottom-first, one at a time.
    for (let i = 0; i < units; i++) {
      const ms = step(`unit-${i}`);
      const ghost = ghosts[units - 1 - i];
      const unit = arrived[i];
      const pair: Animation[] = [];
      if (ghost) pair.push(run(ghost, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: ms, easing: "ease-in", fill: "forwards", id: `cs-pour-unit-${i}` }));
      if (unit) {
        unit.style.removeProperty("opacity");
        pair.push(run(unit, [{ transform: "scaleY(0)" }, { transform: "scaleY(1.06)", offset: 0.85 }, { transform: "scaleY(1)" }], { duration: ms, easing: "ease-out", id: `cs-pour-arrive-${i}` }));
      }
      await Promise.all(pair.map(wait));
      if (!alive()) return;
    }
    run(target, [{ transform: "translateY(0)" }, { transform: "translateY(3px)", offset: 0.4 }, { transform: "translateY(0)" }], { duration: Math.max(1, step("return") * 0.6), id: "cs-pour-settle" });
    await wait(run(stream, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: Math.max(1, step("return") * 0.3), fill: "forwards", id: "cs-pour-stream-end" }));
    if (!alive()) return;
    const ret = run(source, [{ transform: docked }, { transform: "translate(0, 0) rotate(0deg)" }], { duration: step("return"), easing: "ease-out", id: "cs-pour-return" });
    for (const a of anims) if (a.id === "cs-pour-lift" || a.id === "cs-pour-travel") a.cancel();
    await wait(ret);
  }

  async function balls(): Promise<void> {
    await wait(run(source, [{ transform: "translateY(0)" }, { transform: `translateY(${-LIFT_PX}px)` }], { duration: step("lift"), easing: "ease-out", fill: "forwards", id: "cs-pour-lift" }));
    if (!alive()) return;
    for (let i = 0; i < units; i++) {
      const ghost = ghosts[units - 1 - i];
      const unit = arrived[i];
      if (!ghost || !unit) continue;
      const from = offsetWithin(ghost, board);
      const to = offsetWithin(unit, board);
      const fly = ghostUnit(scene.color, scene.icon, "cs-fly cs-ghost-unit");
      fly.style.left = `${from.left}px`;
      fly.style.top = `${from.top - LIFT_PX}px`;
      fly.style.width = `${from.width}px`;
      fly.style.height = `${from.height}px`;
      board.append(fly);
      extras.push(fly);
      ghost.style.visibility = "hidden";
      const dx = to.left - from.left;
      const dy = to.top - (from.top - LIFT_PX);
      const ms = step(`hop-${i}`);
      const arc = run(
        fly,
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${dx * 0.5}px, ${Math.min(dy, 0) - 70}px)`, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px)` },
        ],
        { duration: ms, easing: "ease-in-out", fill: "forwards", id: `cs-pour-hop-${i}` },
      );
      await wait(arc);
      if (!alive()) return;
      fly.remove();
      unit.style.removeProperty("opacity");
      run(unit, [{ transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: Math.max(1, ms * 0.4), id: `cs-pour-land-${i}` });
    }
    await wait(run(source, [{ transform: `translateY(${-LIFT_PX}px)` }, { transform: "translateY(0)" }], { duration: step("return"), easing: "ease-out", id: "cs-pour-return" }));
  }

  async function bolts(): Promise<void> {
    for (let i = 0; i < units; i++) {
      const ghost = ghosts[units - 1 - i];
      const unit = arrived[i];
      if (!ghost || !unit) continue;
      const from = offsetWithin(ghost, board);
      const to = offsetWithin(unit, board);
      const nut = ghostUnit(scene.color, scene.icon, "cs-fly cs-ghost-unit");
      nut.style.left = `${from.left}px`;
      nut.style.top = `${from.top}px`;
      nut.style.width = `${from.width}px`;
      nut.style.height = `${from.height}px`;
      board.append(nut);
      extras.push(nut);
      ghost.style.visibility = "hidden";
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const up = -48 + Math.min(0, dy);
      await wait(run(nut, [{ transform: "translate(0, 0) rotate(0deg)" }, { transform: `translate(0, ${up}px) rotate(-540deg)` }], { duration: step(`unscrew-${i}`), easing: "ease-out", fill: "forwards", id: `cs-pour-nut-unscrew-${i}` }));
      if (!alive()) return;
      await wait(run(nut, [{ transform: `translate(0, ${up}px) rotate(-540deg)` }, { transform: `translate(${dx}px, ${up}px) rotate(-540deg)` }], { duration: step(`carry-${i}`), easing: "linear", fill: "forwards", id: `cs-pour-nut-carry-${i}` }));
      if (!alive()) return;
      await wait(run(nut, [{ transform: `translate(${dx}px, ${up}px) rotate(-540deg)` }, { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` }], { duration: step(`screw-${i}`), easing: "ease-in", fill: "forwards", id: `cs-pour-nut-screw-${i}` }));
      if (!alive()) return;
      nut.remove();
      unit.style.removeProperty("opacity");
    }
  }

  return {
    plan,
    done,
    cancel(): void {
      cancelled = true;
      cleanup();
    },
  };
}
