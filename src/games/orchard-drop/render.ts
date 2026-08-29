//! Canvas rendering for Orchard Drop. **Presentational only** — nothing here
//! decides anything. Positions, radii and rotations all arrive from the core via
//! `world_json`; this file turns them into pixels and never the other way round.
//!
//! # The fruit art is ported, not invented
//!
//! Every shape below comes from the wrapped game's `drawFruit`: a radial-gradient
//! body, a per-kind texture, a clipped shine, a stem and leaf (a crown for the
//! pineapple), and the kawaii face. Keeping the art identical is what let the
//! rebuild be judged against the original on the physics rather than on the
//! drawing.
//!
//! # Where the skin applies, and where it does not
//!
//! `M1` split the token vocabulary: **chrome roles are skinnable, game palettes
//! are not.** So the crate, the danger line and the ground read from CSS custom
//! properties and follow the active skin; the eleven fruit colours are the
//! game's own identity and stay fixed. A cherry is red in every skin.

/** The logical playfield, in px. The canvas scales; these never change. */
export const CRATE_W = 440;
/** Logical crate height, px. */
export const CRATE_H = 640;
/** The danger line's height, px from the top. */
export const LINE_Y = 112;

/** `(name, light, dark, kind)` per ladder tier — the wrapped game's `FRUITS`. */
const FRUITS: readonly (readonly [string, string, string, string])[] = [
  ["cherry", "#F26D6D", "#D8403F", "cherry"],
  ["strawberry", "#F2708B", "#DB4463", "strawberry"],
  ["grape", "#B07DE0", "#8B54C9", "plain"],
  ["dekopon", "#FFC24D", "#F09E23", "citrus"],
  ["persimmon", "#FA9A4B", "#E8792A", "citrus"],
  ["apple", "#F26060", "#D63C3C", "plain"],
  ["pear", "#CFE06A", "#A9C244", "plain"],
  ["peach", "#FFC3CF", "#F79BB0", "plain"],
  ["pineapple", "#FBD75B", "#E9B92E", "pineapple"],
  ["melon", "#BEE07A", "#98C24E", "melon"],
  ["watermelon", "#5CA84E", "#3E8948", "watermelon"],
] as const;

/** The name of a tier, for the guide and for screen readers. */
export function fruitName(tier: number): string {
  return FRUITS[tier]?.[0] ?? "fruit";
}

/** The lit colour of a tier, for the next-fruit chip. */
export function fruitColor(tier: number): string {
  return FRUITS[tier]?.[1] ?? "#888";
}

/** Chrome colours, read from the active skin. */
export interface CratePalette {
  /** The crate's interior. */
  readonly crate: string;
  /** The crate's wooden frame. */
  readonly wood: string;
  /** The danger line. */
  readonly danger: string;
  /** Text drawn on the crate. */
  readonly ink: string;
}

/**
 * Resolve the crate's colours from the active skin.
 *
 * Falls back to the wrapped game's own values when a token is missing, so a
 * canvas never renders invisible — a blank crate is a much worse failure than a
 * slightly off one.
 */
export function cratePalette(): CratePalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    crate: v("--orchard-crate", "#FBEED2"),
    wood: v("--orchard-wood", "#C68B59"),
    danger: v("--orchard-danger", "#D8403F"),
    ink: v("--ink-muted", "#5a4632"),
  };
}

/** A fruit to draw, as the binding reports it. */
export interface DrawableFruit {
  readonly id: number;
  readonly tier: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Rotation in milliradians. */
  readonly ang: number;
}

/** Draw one fruit centred at its own position, rotated by its own angle. */
function drawFruit(g: CanvasRenderingContext2D, f: DrawableFruit): void {
  const spec = FRUITS[f.tier];
  if (!spec) return;
  const [, c1, c2, kind] = spec;
  const r = f.r;

  g.save();
  g.translate(f.x, f.y);
  g.rotate(f.ang / 1000);

  // Body.
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, 0, r);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  // Per-kind texture.
  g.lineWidth = Math.max(1.5, r * 0.06);
  if (kind === "watermelon") {
    g.strokeStyle = "rgba(30,80,40,.55)";
    for (let i = -2; i <= 2; i++) {
      const x = i * r * 0.38;
      const h = Math.sqrt(Math.max(0, r * r - x * x));
      g.beginPath();
      g.moveTo(x, -h);
      g.quadraticCurveTo(i * r * 0.55, 0, x, h);
      g.stroke();
    }
  } else if (kind === "melon") {
    g.strokeStyle = "rgba(255,255,255,.4)";
    g.beginPath();
    g.moveTo(-r * 0.7, -r * 0.5);
    g.quadraticCurveTo(0, 0, -r * 0.5, r * 0.7);
    g.stroke();
    g.beginPath();
    g.moveTo(r * 0.5, -r * 0.7);
    g.quadraticCurveTo(0, 0, r * 0.7, r * 0.5);
    g.stroke();
  } else if (kind === "pineapple") {
    g.strokeStyle = "rgba(160,110,20,.35)";
    for (let i = -2; i <= 2; i++) {
      const y = i * r * 0.4;
      g.beginPath();
      g.moveTo(-r, y - r * 0.2);
      g.lineTo(r, y + r * 0.6);
      g.stroke();
      g.beginPath();
      g.moveTo(-r, y + r * 0.6);
      g.lineTo(r, y - r * 0.2);
      g.stroke();
    }
  } else if (kind === "strawberry") {
    g.fillStyle = "rgba(255,240,180,.8)";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      g.save();
      g.translate(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, 0, r * 0.06, r * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  // Shine.
  g.fillStyle = "rgba(255,255,255,.35)";
  g.beginPath();
  g.ellipse(-r * 0.38, -r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  g.fill();

  // Stem and leaf, or the pineapple's crown.
  if (kind === "pineapple") {
    g.fillStyle = "#5F9E4A";
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(i * r * 0.18, -r * 0.85);
      g.quadraticCurveTo(i * r * 0.5, -r * 1.35, i * r * 0.12, -r * 1.3);
      g.quadraticCurveTo(i * r * 0.05, -r * 1.0, i * r * 0.18, -r * 0.85);
      g.fill();
    }
  } else {
    g.strokeStyle = "#6B4226";
    g.lineWidth = Math.max(2, r * 0.07);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, -r * 0.92);
    g.quadraticCurveTo(r * 0.08, -r * 1.12, r * 0.16, -r * 1.18);
    g.stroke();
    g.fillStyle = "#6FA84F";
    g.beginPath();
    g.ellipse(r * 0.3, -r * 1.08, r * 0.2, r * 0.1, 0.5, 0, Math.PI * 2);
    g.fill();
  }

  // The face. It is what turns an orb into a fruit, and because it rotates with
  // the body it is also how rolling becomes legible.
  const er = Math.max(1.8, r * 0.075);
  g.fillStyle = "#3A2430";
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * r * 0.28, -r * 0.05, er, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#fff";
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * r * 0.28 - er * 0.3, -r * 0.05 - er * 0.3, er * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#3A2430";
  g.lineWidth = Math.max(1.5, r * 0.05);
  g.beginPath();
  g.arc(0, r * 0.12, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.fillStyle = "rgba(255,120,120,.45)";
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * r * 0.5, r * 0.12, r * 0.11, 0, Math.PI * 2);
    g.fill();
  }

  g.restore();
}

/** What a frame needs beyond the fruit themselves. */
export interface Frame {
  readonly fruit: readonly DrawableFruit[];
  /** Where the held fruit would land, or `null` while it cannot be dropped. */
  readonly aimX: number | null;
  /** The held fruit's tier, for the drop preview. */
  readonly heldTier: number;
  /** Dim the crate — the run has ended. */
  readonly over: boolean;
}

/**
 * Draw one frame. Sizes the backing store to the element's own box, so the
 * canvas stays sharp on a high-DPI phone without the caller thinking about it.
 */
export function draw(canvas: HTMLCanvasElement, frame: Frame): void {
  const g = canvas.getContext("2d");
  if (!g) return;

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const want = { w: Math.round(CRATE_W * dpr), h: Math.round(CRATE_H * dpr) };
  if (canvas.width !== want.w || canvas.height !== want.h) {
    canvas.width = want.w;
    canvas.height = want.h;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const p = cratePalette();
  g.clearRect(0, 0, CRATE_W, CRATE_H);
  g.fillStyle = p.crate;
  g.fillRect(0, 0, CRATE_W, CRATE_H);

  // Wooden frame: two sides and a floor, drawn inside the playfield so the
  // fruit visibly rest against them.
  g.fillStyle = p.wood;
  g.fillRect(0, 0, 8, CRATE_H);
  g.fillRect(CRATE_W - 8, 0, 8, CRATE_H);
  g.fillRect(0, CRATE_H - 8, CRATE_W, 8);

  // The danger line.
  g.strokeStyle = p.danger;
  g.lineWidth = 2;
  g.setLineDash([6, 6]);
  g.beginPath();
  g.moveTo(0, LINE_Y);
  g.lineTo(CRATE_W, LINE_Y);
  g.stroke();
  g.setLineDash([]);

  // The aim guide, so a player can see where a drop will land before releasing.
  if (frame.aimX !== null && !frame.over) {
    g.strokeStyle = p.danger;
    g.globalAlpha = 0.25;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(frame.aimX, LINE_Y);
    g.lineTo(frame.aimX, CRATE_H - 8);
    g.stroke();
    g.globalAlpha = 1;
  }

  // Bottom-of-crate first, so a stem sits behind whatever rests on top of it
  // rather than poking through.
  for (const f of [...frame.fruit].sort((a, b) => b.y - a.y)) drawFruit(g, f);

  if (frame.over) {
    g.fillStyle = "rgba(0,0,0,.45)";
    g.fillRect(0, 0, CRATE_W, CRATE_H);
  }
}

/**
 * A one-line description of the crate for a screen reader.
 *
 * A canvas is opaque to assistive technology, so the game keeps a live text
 * summary beside it. This is that text — not decoration, and the reason the axe
 * scan on this page means something.
 */
export function describe(frame: Frame, score: number): string {
  if (frame.over) return `The crate overflowed. Final score ${score}.`;
  if (frame.fruit.length === 0) return `An empty crate. Score ${score}.`;
  const counts = new Map<number, number>();
  for (const f of frame.fruit) counts.set(f.tier, (counts.get(f.tier) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, n]) => `${n} ${fruitName(tier)}${n === 1 ? "" : "s"}`);
  const highest = Math.max(...frame.fruit.map((f) => f.tier));
  return `Score ${score}. The crate holds ${parts.join(", ")}. Largest: ${fruitName(highest)}.`;
}
