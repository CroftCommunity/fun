//! Color Sort's sound — synthesised in Web Audio, zero bytes shipped (plan D11;
//! mock E proposal 8). A cue is data (`cueFor`, pure, unit-tested: a distinct
//! voice per skin and per event); `play` renders it, and only when the shelf's
//! Sound row is on. The context is created lazily, inside the first tap's
//! handler, so the browser's gesture rule is met without a resume dance.
//!
//! Water: four short sine blips rising 200–500 Hz — the glug — and a low plop on
//! settle. Balls: a short high clink per landing. Bolts: a ratchet of quick
//! triangle ticks while the nut turns, a clack when it seats. Complete: a
//! two-note chime, in every skin.

import { MUSIC_KEY, resolveMusic } from "../../music.js";
import type { ColorSortSkin } from "../../settings.js";

/** The shelf's Sound row (`fun-music`), read at play time so a flip applies at once. */
function soundEnabled(): boolean {
  try {
    return resolveMusic(localStorage.getItem(MUSIC_KEY));
  } catch {
    return false;
  }
}

export type CueKind = "pour" | "complete";

/** One note of a cue: when it starts (ms), how long (ms), its pitch, its waveform, its loudness. */
export interface Note {
  readonly at: number;
  readonly ms: number;
  readonly hz: number;
  readonly wave: OscillatorType;
  readonly gain: number;
  /** A pitch glide to this frequency over the note (the plop). */
  readonly to?: number;
}

export interface Cue {
  readonly skin: ColorSortSkin;
  readonly kind: CueKind;
  readonly notes: readonly Note[];
}

/** The cue for an event in a skin — pure data. `units` lengthens a pour's voice. */
export function cueFor(skin: ColorSortSkin, kind: CueKind, units = 1): Cue {
  if (kind === "complete") {
    return {
      skin,
      kind,
      notes: [
        { at: 0, ms: 110, hz: 660, wave: "sine", gain: 0.18 },
        { at: 120, ms: 220, hz: 990, wave: "sine", gain: 0.16 },
      ],
    };
  }
  const n = Math.max(1, units);
  if (skin === "ball") {
    return {
      skin,
      kind,
      notes: Array.from({ length: n }, (_, i) => ({ at: i * 140, ms: 60, hz: 1200 + i * 90, wave: "triangle", gain: 0.14 })),
    };
  }
  if (skin === "bolt") {
    const ticks: Note[] = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 5; k++) ticks.push({ at: i * 550 + k * 40, ms: 22, hz: 320 + k * 12, wave: "square", gain: 0.05 });
      ticks.push({ at: i * 550 + 400, ms: 50, hz: 180, wave: "triangle", gain: 0.16 });
    }
    return { skin, kind, notes: ticks };
  }
  const blips: Note[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) blips.push({ at: i * 160 + k * 40, ms: 80, hz: 200 + k * 100, wave: "sine", gain: 0.12 });
  }
  blips.push({ at: n * 160, ms: 150, hz: 400, to: 150, wave: "sine", gain: 0.14 });
  return { skin, kind, notes: blips };
}

/** What a play attempt recorded — read by the parity spec (mock E8.1). */
export interface PlayLog {
  readonly skin: ColorSortSkin;
  readonly kind: CueKind;
  readonly played: boolean;
}

/** One synth per game module. */
export class ColorSortSound {
  private ctx: AudioContext | null = null;
  readonly log: PlayLog[] = [];

  /** Render a cue now, if the Sound row is on. Records the attempt either way. */
  play(skin: ColorSortSkin, kind: CueKind, units = 1): void {
    const on = soundEnabled() && typeof AudioContext !== "undefined";
    this.log.push({ skin, kind, played: on });
    if (!on) return;
    const cue = cueFor(skin, kind, units);
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of cue.notes) {
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
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
