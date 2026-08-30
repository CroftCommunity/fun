//! Mahjong tile faces as original inline SVG, in two styles: the traditional
//! face and a large-print set that carries no CJK glyph. Face ids are the dense
//! `0..42` order of `crates/mahjong-core/src/tiles.rs`: dots 1–9, bamboo 1–9,
//! characters 1–9, winds E S W N, dragons red green white, flowers plum orchid
//! chrysanthemum bamboo, seasons spring summer autumn winter. Pure functions,
//! no DOM. Colours are CSS tokens (`--mj-ink`, `--mj-red`, `--mj-green`,
//! `--mj-blue`) so a skin restyles the set without touching this file.

export type TileStyle = "classic" | "large";

export type FaceKind = "dots" | "bamboo" | "characters" | "wind" | "dragon" | "flower" | "season";

export const FACE_COUNT = 42;

const INK = "var(--mj-ink)";
const RED = "var(--mj-red)";
const GREEN = "var(--mj-green)";
const BLUE = "var(--mj-blue)";
const CYCLE = [GREEN, RED, BLUE] as const;

const WINDS = ["東", "南", "西", "北"] as const;
const WIND_NAMES = ["East", "South", "West", "North"] as const;
const DRAGON_NAMES = ["Red", "Green", "White"] as const;
const FLOWERS = ["梅", "蘭", "菊", "竹"] as const;
const FLOWER_NAMES = ["Plum", "Orchid", "Chrysanthemum", "Bamboo"] as const;
const SEASONS = ["春", "夏", "秋", "冬"] as const;
const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"] as const;
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

function assertFace(face: number): void {
  if (!Number.isInteger(face) || face < 0 || face >= FACE_COUNT) {
    throw new RangeError(`mahjong face out of range: ${face}`);
  }
}

export function faceKind(face: number): FaceKind {
  assertFace(face);
  if (face <= 8) return "dots";
  if (face <= 17) return "bamboo";
  if (face <= 26) return "characters";
  if (face <= 30) return "wind";
  if (face <= 33) return "dragon";
  if (face <= 37) return "flower";
  return "season";
}

export function isBonus(face: number): boolean {
  assertFace(face);
  return face >= 34;
}

/** The 1-based rank within the family (1–9 suits, 1–4 winds/bonus, 1–3 dragons). */
function rank(face: number): number {
  switch (faceKind(face)) {
    case "dots":
      return face + 1;
    case "bamboo":
      return face - 8;
    case "characters":
      return face - 17;
    case "wind":
      return face - 26;
    case "dragon":
      return face - 30;
    case "flower":
      return face - 33;
    case "season":
      return face - 37;
  }
}

function pick<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range`);
  return v;
}

export function faceLabel(face: number): string {
  const r = rank(face);
  switch (faceKind(face)) {
    case "dots":
      return `Dots ${r}`;
    case "bamboo":
      return `Bamboo ${r}`;
    case "characters":
      return `Characters ${r}`;
    case "wind":
      return `${pick(WIND_NAMES, r - 1)} wind`;
    case "dragon":
      return `${pick(DRAGON_NAMES, r - 1)} dragon`;
    case "flower":
      return `${pick(FLOWER_NAMES, r - 1)} flower`;
    case "season":
      return `${pick(SEASON_NAMES, r - 1)} season`;
  }
}

// ---- SVG primitives -------------------------------------------------------

function svg(inner: string): string {
  return `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function text(x: number, y: number, size: number, fill: string, content: string, weight = "700"): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-family="'Noto Serif CJK SC','Songti SC','PingFang SC','Hiragino Sans GB',serif">${content}</text>`;
}

function latin(x: number, y: number, size: number, fill: string, content: string): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="800" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${content}</text>`;
}

function frame(stroke: string, width: number): string {
  return `<rect x="9" y="10" width="42" height="60" rx="4" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
}

// ---- Dots -----------------------------------------------------------------

type Pt = readonly [number, number];

/** Traditional circle arrangements, in the 60×80 face. */
const DOT_LAYOUT: readonly (readonly Pt[])[] = [
  [[30, 40]],
  [
    [30, 22],
    [30, 58],
  ],
  [
    [16, 20],
    [30, 40],
    [44, 60],
  ],
  [
    [18, 24],
    [42, 24],
    [18, 56],
    [42, 56],
  ],
  [
    [16, 20],
    [44, 20],
    [30, 40],
    [16, 60],
    [44, 60],
  ],
  [
    [18, 18],
    [42, 18],
    [18, 40],
    [42, 40],
    [18, 62],
    [42, 62],
  ],
  [
    [14, 14],
    [30, 22],
    [46, 30],
    [18, 48],
    [42, 48],
    [18, 66],
    [42, 66],
  ],
  [
    [18, 13],
    [42, 13],
    [18, 31],
    [42, 31],
    [18, 49],
    [42, 49],
    [18, 67],
    [42, 67],
  ],
  [
    [15, 18],
    [30, 18],
    [45, 18],
    [15, 40],
    [30, 40],
    [45, 40],
    [15, 62],
    [30, 62],
    [45, 62],
  ],
];

function dot(x: number, y: number, r: number, fill: string): string {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>` +
    `<circle cx="${x}" cy="${y}" r="${(r * 0.45).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="1"/>`
  );
}

function dotsClassic(n: number): string {
  if (n === 1) {
    return (
      `<circle cx="30" cy="40" r="22" fill="${GREEN}"/>` +
      `<circle cx="30" cy="40" r="15" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
      `<circle cx="30" cy="40" r="9" fill="${RED}"/>` +
      `<circle cx="30" cy="40" r="3" fill="${BLUE}"/>`
    );
  }
  const pts = pick(DOT_LAYOUT, n - 1);
  const r = n <= 3 ? 9 : n <= 6 ? 8 : 6.5;
  return pts.map(([x, y], i) => dot(x, y, r, pick(CYCLE, (i + n) % 3))).join("");
}

// ---- Bamboo ---------------------------------------------------------------

/** Stick layouts as rows of x-centres; each row is one stick height. */
const STICK_ROWS: readonly (readonly (readonly number[])[])[] = [
  [], // 1 is the bird
  [[30], [30]],
  [[30], [19, 41]],
  [
    [19, 41],
    [19, 41],
  ],
  [[19, 41], [30], [19, 41]],
  [
    [15, 30, 45],
    [15, 30, 45],
  ],
  [[30], [15, 30, 45], [15, 30, 45]],
  [
    [12, 24, 36, 48],
    [12, 24, 36, 48],
  ],
  [
    [15, 30, 45],
    [15, 30, 45],
    [15, 30, 45],
  ],
];

function stick(x: number, y: number, h: number, fill: string, band: string): string {
  const w = 7;
  return (
    `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="${fill}"/>` +
    `<rect x="${x - w / 2}" y="${(y + h / 2 - 1.5).toFixed(1)}" width="${w}" height="3" fill="${band}"/>`
  );
}

function bird(): string {
  return (
    `<rect x="12" y="66" width="36" height="4" rx="2" fill="${GREEN}"/>` +
    `<path d="M22 32 C14 32 12 42 16 50 C20 58 34 60 40 52 C46 44 40 32 30 30 Z" fill="${GREEN}"/>` +
    `<path d="M16 50 L6 62 L18 58 Z" fill="${BLUE}"/>` +
    `<circle cx="38" cy="26" r="8" fill="${GREEN}"/>` +
    `<circle cx="40" cy="24" r="1.6" fill="${INK}"/>` +
    `<path d="M45 26 L54 29 L45 32 Z" fill="${RED}"/>` +
    `<path d="M36 18 L38 12 L41 18 Z" fill="${RED}"/>` +
    `<path d="M26 58 L24 66 M34 58 L36 66" stroke="${RED}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M24 44 C28 40 34 42 36 46" fill="none" stroke="${BLUE}" stroke-width="1.5"/>`
  );
}

function bambooClassic(n: number): string {
  if (n === 1) return bird();
  const rows = pick(STICK_ROWS, n - 1);
  const gap = 2;
  const h = (72 - gap * (rows.length - 1)) / rows.length;
  return rows
    .map((xs, ri) => {
      const y = 4 + ri * (h + gap);
      const fill = ri % 2 === 0 ? GREEN : BLUE;
      return xs.map((x) => stick(x, y, h, fill, RED)).join("");
    })
    .join("");
}

// ---- Honours and bonus ----------------------------------------------------

function charactersClassic(n: number): string {
  return text(30, 22, 26, INK, pick(NUMERALS, n - 1)) + text(30, 58, 26, RED, "萬");
}

function windClassic(n: number): string {
  return text(30, 40, 40, INK, pick(WINDS, n - 1));
}

function dragonClassic(n: number): string {
  if (n === 1) return text(30, 40, 40, RED, "中");
  if (n === 2) return text(30, 40, 40, GREEN, "發");
  return frame(BLUE, 4) + `<rect x="15" y="17" width="30" height="46" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.5"/>`;
}

function bonusClassic(glyph: string, n: number, fill: string): string {
  return text(30, 44, 34, fill, glyph) + text(12, 12, 12, RED, String(n));
}

function classic(face: number): string {
  const n = rank(face);
  switch (faceKind(face)) {
    case "dots":
      return dotsClassic(n);
    case "bamboo":
      return bambooClassic(n);
    case "characters":
      return charactersClassic(n);
    case "wind":
      return windClassic(n);
    case "dragon":
      return dragonClassic(n);
    case "flower":
      return bonusClassic(pick(FLOWERS, n - 1), n, GREEN);
    case "season":
      return bonusClassic(pick(SEASONS, n - 1), n, BLUE);
  }
}

// ---- Large print ----------------------------------------------------------

function suitMark(kind: FaceKind): string {
  switch (kind) {
    case "dots":
      return `<circle cx="30" cy="66" r="6" fill="${BLUE}"/><circle cx="30" cy="66" r="2.5" fill="none" stroke="${INK}" stroke-width="1"/>`;
    case "bamboo":
      return `<rect x="26.5" y="58" width="7" height="16" rx="2.5" fill="${GREEN}"/><rect x="26.5" y="64.5" width="7" height="3" fill="${RED}"/>`;
    default:
      return latin(30, 66, 16, RED, "W");
  }
}

function large(face: number): string {
  const n = rank(face);
  const kind = faceKind(face);
  switch (kind) {
    case "dots":
    case "bamboo":
    case "characters":
      return latin(30, 32, 44, INK, String(n)) + suitMark(kind);
    case "wind":
      return latin(30, 40, 48, INK, pick(["E", "S", "W", "N"], n - 1));
    case "dragon":
      if (n === 1) return latin(30, 40, 48, RED, "R");
      if (n === 2) return latin(30, 40, 48, GREEN, "G");
      return frame(BLUE, 5);
    case "flower":
      return latin(30, 40, 36, GREEN, `F${n}`);
    case "season":
      return latin(30, 40, 36, BLUE, `S${n}`);
  }
}

/** The inline SVG for a face: a `<svg viewBox="0 0 60 80">` string, colours as CSS tokens. */
export function faceSvg(face: number, style: TileStyle): string {
  assertFace(face);
  return svg(style === "large" ? large(face) : classic(face));
}
