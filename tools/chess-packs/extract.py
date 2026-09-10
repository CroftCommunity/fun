#!/usr/bin/env python3
"""Cut a chess piece pack out of a rendered starting-position board.

A pack (`src/games/chess/assets/packs/<name>.png`) is one sprite sheet: six
columns in kind order — pawn, knight, bishop, rook, queen, king — over two
rows, White then Black. `chess-pieces.ts` names the packs and the CSS in
`styles.css` places a piece by kind and side, so this script owns nothing the
game reads at run time except the pixels.

The boards live in `tools/chess-packs/boards/<name>.jpg`: an 8×8 board in the
starting position, ranks labelled down the left, on the shelf's own square
colours (`--chs-light`/`--chs-dark`, or near them). Three steps per board:

1. **Find the grid.** Pixels are classed light-square / dark-square / other by
   distance to the two square colours (estimated from the empty middle band).
   File edges are the light↔dark changes along an empty rank, rank edges the
   changes down a file through the empty middle, extrapolated to all eight.
2. **Cut a cell and key its square out.** The square's colour is the median of
   the cell's own border ring (a global colour fails on a board with a vignette
   — Frontier's top rank was 20 levels off the middle). A flood fill from the
   border removes what is within `TOL` of that colour, plus a band along the
   edge within `TOL` of the *other* square colour, which is the neighbouring
   square bleeding through the JPEG. What the fill cannot reach is the piece.
3. **Choose an instance.** Rooks, knights and bishops appear twice and pawns
   eight times; `CHOICE` names the file used for each, queen-side unless a
   board drew the two differently.

Not part of the gate: run it by hand when a board changes, commit the sheet.

    python3 tools/chess-packs/extract.py            # every board
    python3 tools/chess-packs/extract.py tides      # one

Needs Pillow and numpy (`pip install pillow numpy`).
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
BOARDS = HERE / "boards"
OUT = HERE.parent.parent / "src" / "games" / "chess" / "assets" / "packs"

TOL = 34        # RGB distance a background pixel may sit from its square's colour
EDGE_BAND = 6   # px along the crop's edge where the *other* square's colour is background too
KINDS = "pnbrqk"  # sheet column order: pawn, knight, bishop, rook, queen, king

# Which file's instance to use, per side, per kind. White reads rank 1/2, Black rank 8/7.
DEFAULT_CHOICE = {"p": "a", "n": "b", "b": "c", "r": "a", "q": "d", "k": "e"}
CHOICE = {
    "garden": {},
    "arcade": {},
    "ancients": {},
    "frontier": {},
    "tides": {},
    "diner": {},
}


def runs(line):
    """[(value, start, end)] of constant runs along a 1-D array."""
    out, s = [], 0
    for i in range(1, len(line) + 1):
        if i == len(line) or line[i] != line[s]:
            out.append((int(line[s]), s, i))
            s = i
    return out


def square_colours(a):
    """The light and dark square colours, from the empty middle band."""
    h = a.shape[0]
    band = a[int(h * 0.40) : int(h * 0.60)].reshape(-1, 3).astype(int)
    lum = band.sum(axis=1)
    light = np.median(band[lum > np.percentile(lum, 60)], axis=0)
    dark = np.median(band[lum < np.percentile(lum, 40)], axis=0)
    return light, dark


def classify(a, light, dark, tol):
    dl = np.linalg.norm(a.astype(int) - light, axis=-1)
    dd = np.linalg.norm(a.astype(int) - dark, axis=-1)
    cls = np.zeros(a.shape[:2], dtype=np.int8)  # 0 other, 1 light, 2 dark
    cls[dl < tol] = 1
    cls[dd < tol] = 2
    return cls


def edges_between(rs, lo, hi, gap=8):
    """Midpoints of the small gaps between consecutive long light/dark runs of different colour."""
    good = [(v, s, e) for v, s, e in rs if v in (1, 2) and e - s >= 30]
    return [
        (good[i - 1][2] + s) / 2
        for i, (v, s, e) in enumerate(good)
        if i > 0 and 0 <= s - good[i - 1][2] <= gap and v != good[i - 1][0] and lo < s < hi
    ]


def detect_grid(a):
    light, dark = square_colours(a)
    cls = classify(a, light, dark, 28)
    h, w = cls.shape
    # Files: along the fullest row of the empty middle ranks.
    y = max(range(int(h * 0.42), int(h * 0.58)), key=lambda y: (cls[y] > 0).sum())
    xs = edges_between(runs(cls[y]), 0, w)
    if len(xs) != 7:
        raise SystemExit(f"expected 7 file edges, found {len(xs)}: {xs}")
    cw = float(np.median(np.diff(xs)))
    x0 = xs[0] - cw
    # Ranks: down the centre of file a, inside the empty middle; anchored to the board's top edge.
    ys = edges_between(runs(cls[:, int(x0 + cw / 2)]), int(h * 0.25), int(h * 0.75))
    if len(ys) < 2:
        raise SystemExit(f"expected rank edges in the middle band, found {ys}")
    ch = float(np.median(np.diff(ys)))
    frac = (cls[:, int(x0) : int(x0 + 8 * cw)] > 0).mean(axis=1)
    top = int(np.argmax(frac > 0.3))
    y0 = ys[0] - round((ys[0] - top) / ch) * ch
    return dict(x0=x0, y0=y0, cw=cw, ch=ch, light=light, dark=dark)


def cut_cell(im, g, file_idx, row_from_top):
    """The cell as RGBA at its full size, transparent where it runs past the image."""
    x = g["x0"] + file_idx * g["cw"]
    y = g["y0"] + row_from_top * g["ch"]
    box = [int(round(x)), int(round(y)), int(round(x + g["cw"])), int(round(y + g["ch"]))]
    cell = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    clamped = (max(box[0], 0), max(box[1], 0), min(box[2], im.width), min(box[3], im.height))
    cell.paste(im.crop(clamped).convert("RGBA"), (clamped[0] - box[0], clamped[1] - box[1]))
    return cell


def key_out(cell, other):
    """Make the square transparent: flood from the border over background-coloured pixels."""
    rgba = np.asarray(cell).astype(int)
    rgb, present = rgba[..., :3], rgba[..., 3] > 0
    h, w = present.shape
    ring = np.zeros((h, w), dtype=bool)
    ring[:3, :], ring[-3:, :], ring[:, :3], ring[:, -3:] = True, True, True, True
    own = np.median(rgb[ring & present], axis=0)
    d_own = np.linalg.norm(rgb - own, axis=-1)
    d_other = np.linalg.norm(rgb - np.asarray(other), axis=-1)
    band = np.zeros((h, w), dtype=bool)
    band[:EDGE_BAND, :], band[-EDGE_BAND:, :], band[:, :EDGE_BAND], band[:, -EDGE_BAND:] = True, True, True, True
    near = (d_own < TOL) | (band & (d_other < TOL)) | ~present
    filled = np.zeros((h, w), dtype=bool)
    q = deque()
    for yy in range(h):
        for xx in range(w):
            if (yy in (0, h - 1) or xx in (0, w - 1)) and near[yy, xx]:
                filled[yy, xx] = True
                q.append((yy, xx))
    while q:
        yy, xx = q.popleft()
        for ny, nx in ((yy - 1, xx), (yy + 1, xx), (yy, xx - 1), (yy, xx + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not filled[ny, nx]:
                filled[ny, nx] = True
                q.append((ny, nx))
    alpha = np.where(filled, 0, 255)
    # A one-pixel feather: kept pixels touching the fill fade by how far they sit from the square.
    pad = np.pad(filled, 1)
    adj = (pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]) & ~filled
    soft = np.clip((d_own - TOL * 0.5) / TOL, 0.25, 1.0) * 255
    alpha = np.where(adj, soft, alpha).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA")


def build(name):
    im = Image.open(BOARDS / f"{name}.jpg").convert("RGB")
    a = np.asarray(im)
    g = detect_grid(a)
    choice = {**DEFAULT_CHOICE, **CHOICE.get(name, {})}
    size = int(round(g["cw"]))
    sheet = Image.new("RGBA", (6 * size, 2 * size), (0, 0, 0, 0))
    for row, back_rank, pawn_rank in ((0, 7, 6), (1, 0, 1)):  # White from ranks 1/2, Black from 8/7
        for col, kind in enumerate(KINDS):
            file_idx = "abcdefgh".index(choice[kind])
            top_row = pawn_rank if kind == "p" else back_rank
            cell = cut_cell(im, g, file_idx, top_row)
            other = g["dark"] if (file_idx + top_row) % 2 == 0 else g["light"]
            piece = key_out(cell, other).resize((size, size), Image.LANCZOS) if cell.size != (size, size) else key_out(cell, other)
            sheet.paste(piece, (col * size, row * size), piece)
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / f"{name}.png", optimize=True)
    print(f"{name}: cell {g['cw']:.1f}×{g['ch']:.1f} at ({g['x0']:.1f},{g['y0']:.1f}) → {sheet.size[0]}×{sheet.size[1]}")


if __name__ == "__main__":
    for name in sys.argv[1:] or sorted(CHOICE):
        build(name)
