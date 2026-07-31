//! Aim → landing resolution for the bubble shooter (RULES.md "Aim / The shot").
//!
//! The player aims a **quantized integer angle** (whole degrees in a legal fan).
//! [`resolve_shot`] ray-casts the projectile from the launcher along that angle
//! in **fixed-point integer math**, reflecting off the side walls, until it first
//! contacts an occupied cell or the ceiling, then snaps to the nearest empty hex
//! cell. Everything here is integer (a committed direction table replaces runtime
//! trig, which `wasm32-unknown-unknown` lacks), so a shot replays byte-identically
//! and `native == wasm`. The returned `path` (segment vertices) is for the UI to
//! draw the preview + animate the flight — it never affects the hash.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::board::{Board, Cell, Pos};

/// Bubble diameter in sub-pixel units (the coordinate quantum).
pub const DIAM: i32 = 256;
/// Bubble radius.
pub const RADIUS: i32 = 128;
/// Row vertical spacing = round(DIAM · √3/2) — a fixed integer (no floats).
pub const ROW_H: i32 = 222;

const FP: i64 = 65536; // shift-16 fixed point (matches the direction table)
const STEP: i64 = 24; // march distance per step, < RADIUS so we never tunnel
const MAX_STEPS: i32 = 40_000;

/// A quantized aim angle in whole degrees (legal fan `min..=max`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
pub struct Angle(pub u16);

/// The resolved outcome of aiming: where the bubble lands, and the flight path
/// (segment vertices: launcher → each wall bounce → stop) for the UI to render.
#[derive(Clone, Debug)]
pub struct Landing {
    /// The empty hex cell the shot snaps to.
    pub pos: Pos,
    /// Fixed-point path vertices `(x, y)` — presentational only, not hashed.
    pub path: Vec<(i32, i32)>,
}

#[derive(Deserialize)]
struct DirTable {
    min_deg: u16,
    max_deg: u16,
    dirs: Vec<[i64; 3]>, // [deg, dx, dy] unit vectors × FP
}

static DIR_JSON: &str = include_str!("../data/directions.json");

fn table() -> &'static DirTable {
    static CELL: OnceLock<DirTable> = OnceLock::new();
    CELL.get_or_init(|| serde_json::from_str(DIR_JSON).expect("committed directions.json is valid"))
}

/// The legal aim fan (inclusive), in whole degrees.
#[must_use]
pub fn fan() -> (u16, u16) {
    let t = table();
    (t.min_deg, t.max_deg)
}

/// The fixed-point unit direction `(dx, dy)` for `angle`, clamped into the fan.
fn direction(angle: Angle) -> (i64, i64) {
    let t = table();
    let deg = angle.0.clamp(t.min_deg, t.max_deg);
    let idx = (deg - t.min_deg) as usize;
    let d = t.dirs[idx];
    (d[1], d[2])
}

/// The sub-pixel center of hex cell `(r, c)` on a `width`-wide board.
#[must_use]
pub fn cell_center(width: usize, r: usize, c: usize) -> (i32, i32) {
    let x = if r % 2 == 0 {
        RADIUS + (c as i32) * DIAM
    } else {
        RADIUS + DIAM / 2 + (c as i32) * DIAM
    };
    let y = RADIUS + (r as i32) * ROW_H;
    (x, y)
}

fn is_occupied(board: &Board, r: usize, c: usize) -> bool {
    matches!(board.get(r, c), Some(Cell::Bubble(_)))
}

fn is_empty(board: &Board, r: usize, c: usize) -> bool {
    matches!(board.get(r, c), Some(Cell::Empty))
}

/// Does a bubble centered at `(px, py)` overlap any occupied cell?
fn collides(board: &Board, px: i64, py: i64) -> bool {
    let d2 = (DIAM as i64) * (DIAM as i64);
    for r in 0..board.height {
        for c in 0..Board::row_len(board.width, r) {
            if is_occupied(board, r, c) {
                let (cx, cy) = cell_center(board.width, r, c);
                let ddx = px - i64::from(cx);
                let ddy = py - i64::from(cy);
                if ddx * ddx + ddy * ddy < d2 {
                    return true;
                }
            }
        }
    }
    false
}

/// The empty cell whose center is nearest to `(px, py)`.
fn nearest_empty(board: &Board, px: i64, py: i64) -> Pos {
    let mut best: Pos = (0, 0);
    let mut best_d = i64::MAX;
    for r in 0..board.height {
        for c in 0..Board::row_len(board.width, r) {
            if is_empty(board, r, c) {
                let (cx, cy) = cell_center(board.width, r, c);
                let ddx = px - i64::from(cx);
                let ddy = py - i64::from(cy);
                let d = ddx * ddx + ddy * ddy;
                if d < best_d {
                    best_d = d;
                    best = (r, c);
                }
            }
        }
    }
    best
}

/// Ray-cast a shot at `angle` and return where it lands + the flight path
/// (segment vertices: launcher → each wall bounce → stop).
#[must_use]
pub fn resolve_shot(board: &Board, angle: Angle) -> Landing {
    let (mut vx, vy) = direction(angle);
    let min_x = i64::from(RADIUS);
    let max_x = i64::from(board.width as i32 * DIAM - RADIUS);

    // Launcher: board-centre, just below the last row.
    let mut px = i64::from(board.width as i32 * DIAM) / 2;
    let mut py = i64::from(RADIUS + board.height as i32 * ROW_H);
    let mut path = vec![(px as i32, py as i32)];

    for _ in 0..MAX_STEPS {
        px += vx * STEP / FP;
        py += vy * STEP / FP;

        // Reflect off the side walls. Record the bounce vertex exactly on the
        // wall (so the drawn/animated path touches it), then mirror back inside.
        if px < min_x {
            path.push((min_x as i32, py as i32));
            px = 2 * min_x - px;
            vx = -vx;
        } else if px > max_x {
            path.push((max_x as i32, py as i32));
            px = 2 * max_x - px;
            vx = -vx;
        }

        // Ceiling or a collision with the cluster ends the flight.
        if py <= i64::from(RADIUS) || collides(board, px, py) {
            break;
        }
    }

    path.push((px as i32, py as i32));
    Landing {
        pos: nearest_empty(board, px, py),
        path,
    }
}
