//! Phase 9 of the play-surface plan (mock F, Q11): life on the versus boards.
//! One vocabulary of beats — drop, flip, slide, shrink, line, tick, word — that
//! Drop 4, Othello, checkers, chess, Dots, Furrow and cribbage call from the
//! move the core already resolved. One reduced-motion policy (each beat
//! collapses to its last frame), one seam for a test (the stage's `data-beat`),
//! one voice per beat under the Sound row. Nothing here touches a core.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEAT_KINDS, beat, beatEach, beatSound, beatSpec, beatWord, ghost, type BeatKind } from "../src/beats.js";

let stage: HTMLElement;
let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  stage = document.createElement("div");
  stage.className = "gf-stage";
  host = document.createElement("div");
  stage.append(host);
  document.body.append(stage);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom has no Web Animations; a stub that records the call is the seam. */
function stubAnimate(el: Element): ReturnType<typeof vi.fn> {
  const anim = vi.fn(() => ({ finished: Promise.resolve(), cancel: () => {}, onfinish: null }));
  (el as unknown as { animate: unknown }).animate = anim;
  return anim;
}

describe("beatSpec — the vocabulary", () => {
  it("every kind has frames and a duration, and drop falls from the distance it is given", () => {
    for (const k of BEAT_KINDS) {
      const s = beatSpec(k, { distancePx: 120 });
      expect(s.frames.length, k).toBeGreaterThanOrEqual(2);
      expect(s.ms, k).toBeGreaterThan(0);
    }
    const near = beatSpec("drop", { distancePx: 40 });
    const far = beatSpec("drop", { distancePx: 400 });
    expect(String(near.frames[0]!.transform)).toContain("-40px");
    expect(String(far.frames[0]!.transform)).toContain("-400px");
    expect(far.ms).toBeGreaterThan(near.ms); // a longer fall takes longer, so the bounce lands with the disc
  });
  it("the last frame of every on-board beat is rest — collapsing to it changes nothing on the board (shrink runs on a ghost, whose rest is gone)", () => {
    for (const k of ["drop", "flip", "slide", "line", "tick"] as const) {
      const last = beatSpec(k).frames.at(-1)!;
      expect(last.transform ?? "none", k).toMatch(/none|scale\(1\)|translate[XY]?\(0(px)?(, 0px)?\)|rotateY\(0deg\)/);
    }
    expect(beatSpec("shrink").frames.at(-1)!.transform).toBe("scale(0)");
  });
});

describe("beat — one element, one beat", () => {
  it("animates with the spec's frames and marks the stage with the kind", () => {
    const anim = stubAnimate(host);
    const a = beat(host, "flip");
    expect(a).not.toBeNull();
    expect(anim).toHaveBeenCalledTimes(1);
    const [frames, opts] = anim.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(frames).toEqual(beatSpec("flip").frames);
    expect(opts.duration).toBe(beatSpec("flip").ms);
    expect(stage.dataset.beat).toBe("flip");
  });
  it("under reduced motion it does not animate, but the beat still happened for the stage", () => {
    const anim = stubAnimate(host);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    expect(beat(host, "drop", { distancePx: 100 })).toBeNull();
    expect(anim).not.toHaveBeenCalled();
    expect(stage.dataset.beat).toBe("drop");
  });
  it("with no Web Animations at all (jsdom) it is a no-op that still marks the stage", () => {
    expect(beat(host, "slide")).toBeNull();
    expect(stage.dataset.beat).toBe("slide");
  });
  it("beatEach staggers a sequence by index — the flips run outward from the placed disc", () => {
    const cells = [0, 1, 2].map(() => {
      const c = document.createElement("i");
      host.append(c);
      return c;
    });
    const anims = cells.map(stubAnimate);
    beatEach(cells, "flip", 60);
    const delays = anims.map((a) => (a.mock.calls[0]![1] as KeyframeAnimationOptions).delay);
    expect(delays).toEqual([0, 60, 120]);
  });
});

describe("beatWord — one word over the stage", () => {
  it("shows the word, hidden from the accessibility tree (the seat's sub-line already says it), and takes it away after its beat", () => {
    const w = beatWord(stage, "King!");
    expect(w.classList.contains("gf-beat-word")).toBe(true);
    expect(w.textContent).toBe("King!");
    expect(w.getAttribute("aria-hidden")).toBe("true");
    expect(stage.contains(w)).toBe(true);
    expect(stage.dataset.beat).toBe("word");
    vi.advanceTimersByTime(beatSpec("word").ms + 50);
    expect(stage.contains(w)).toBe(false);
  });
  it("a second word replaces the first — never a stack of them", () => {
    beatWord(stage, "Capture!");
    beatWord(stage, "King!");
    expect(stage.querySelectorAll(".gf-beat-word")).toHaveLength(1);
    expect(stage.querySelector(".gf-beat-word")!.textContent).toBe("King!");
  });
});

describe("ghost — a piece that was taken shrinks out where it stood", () => {
  it("clones the node over the stage at its box and removes it after the shrink", () => {
    const piece = document.createElement("span");
    piece.className = "checkers-piece a";
    host.append(piece);
    const g = ghost(stage, piece);
    expect(g.classList.contains("gf-beat-ghost")).toBe(true);
    expect(g.classList.contains("checkers-piece")).toBe(true);
    expect(g.getAttribute("aria-hidden")).toBe("true");
    expect(stage.dataset.beat).toBe("shrink");
    vi.advanceTimersByTime(beatSpec("shrink").ms + 50);
    expect(stage.contains(g)).toBe(false);
  });
});

describe("beatSound — a voice per beat, under the Sound row", () => {
  it("makes no AudioContext while Sound is off", () => {
    const Ctx = vi.fn();
    vi.stubGlobal("AudioContext", Ctx);
    localStorage.removeItem("fun-music");
    beatSound("drop");
    expect(Ctx).not.toHaveBeenCalled();
  });
  it("every kind has a cue", () => {
    for (const k of BEAT_KINDS) expect(beatSpec(k as BeatKind).cue.length, k).toBeGreaterThan(0);
  });
});
