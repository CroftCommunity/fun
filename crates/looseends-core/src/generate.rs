//! The level generator — **solvable by construction**.
//!
//! Arrows are placed in reverse solution order: each new arrow's exit ray must
//! be clear of everything already placed *and* of its own body. Releasing in
//! reverse placement order then always succeeds, so every board is solvable by
//! definition (the greedy solver in the tests is the proof, not a hope).
//!
//! A direct, integer-exact port of the spec's `generate` + its retry wrapper;
//! the `Rng` helpers ([`Rng::below`], [`Rng::lt_half`]) reproduce the spec's
//! `(rng()*n)|0` / `rng()<0.5` draw-for-draw.

use crate::board::{Arrow, Board};
use crate::config::Config;
use crate::rng::Rng;

const DIRS: [[i32; 2]; 4] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/// One generation attempt over an empty board — the spec's `generate`.
///
/// The spec's per-attempt `used` `Set` is a **stamp buffer**: `used[idx]` holds
/// the id of the attempt that last touched that cell, so "is this cell in the
/// current path?" is `used[idx] == stamp` with no per-attempt allocation and no
/// clearing. The two orientations are evaluated without cloning the path (only
/// the accepted one is materialised). The RNG draw sequence is byte-identical to
/// the spec's `generate`.
fn generate_once(cfg: &Config, rng: &mut Rng) -> Vec<Arrow> {
    let (w, h) = (cfg.w, cfg.h);
    let idx = |x: i32, y: i32| (y * w + x) as usize;
    let in_b = |x: i32, y: i32| x >= 0 && y >= 0 && x < w && y < h;
    let n = (w * h) as usize;

    let mut occ = vec![-1i32; n];
    let mut used = vec![0u32; n];
    let mut stamp = 0u32;
    let mut path: Vec<[i32; 2]> = Vec::new();
    let mut arrows: Vec<Arrow> = Vec::new();
    let mut attempts = 0i32;
    let max_attempts = cfg.target.saturating_mul(90);

    while (arrows.len() as i32) < cfg.target && attempts < max_attempts {
        attempts += 1;

        // 1. self-avoiding random walk from an empty start cell.
        let sx = rng.below(w as u32) as i32;
        let sy = rng.below(h as u32) as i32;
        if occ[idx(sx, sy)] != -1 {
            continue;
        }
        stamp += 1;
        path.clear();
        path.push([sx, sy]);
        used[idx(sx, sy)] = stamp;
        let len = cfg.min_len + rng.below((cfg.max_len - cfg.min_len + 1) as u32) as i32;
        let mut prev: Option<[i32; 2]> = None;

        while (path.len() as i32) < len {
            let last = *path.last().expect("non-empty path");
            let (cx, cy) = (last[0], last[1]);
            let mut opts: [[i32; 2]; 4] = [[0, 0]; 4];
            let mut n_opts = 0usize;
            for d in DIRS {
                let (nx, ny) = (cx + d[0], cy + d[1]);
                if in_b(nx, ny) && occ[idx(nx, ny)] == -1 && used[idx(nx, ny)] != stamp {
                    opts[n_opts] = d;
                    n_opts += 1;
                }
            }
            if n_opts == 0 {
                break;
            }
            // 50% bias to continue straight (snakier, more readable shapes).
            // Draw-for-draw with the spec's short-circuit: when `prev` exists,
            // `lt_half()` is always consumed; the fallback index draw only when
            // we don't take the straight step.
            let d = if let Some(pv) = prev {
                if rng.lt_half() && opts[..n_opts].contains(&pv) {
                    pv
                } else {
                    opts[rng.below(n_opts as u32) as usize]
                }
            } else {
                opts[rng.below(n_opts as u32) as usize]
            };
            prev = Some(d);
            let nc = [cx + d[0], cy + d[1]];
            path.push(nc);
            used[idx(nc[0], nc[1])] = stamp;
        }

        if (path.len() as i32) < cfg.min_len.max(2) {
            continue;
        }

        // 2. try both orientations (random first, per the spec's `cands`);
        // accept if the exit ray is clear of others AND of the arrow's own body.
        let first_forward = rng.lt_half();
        for k in 0..2 {
            // Orientation A is the path as-walked (head = last cell); B is
            // reversed (head = first cell). `cands[0]` is the forward path iff
            // `lt_half()`, matching `rng()<0.5 ? [path, reversed] : ...`.
            let forward = if k == 0 {
                first_forward
            } else {
                !first_forward
            };
            let (head, pv) = if forward {
                (path[path.len() - 1], path[path.len() - 2])
            } else {
                (path[0], path[1])
            };
            let d = [head[0] - pv[0], head[1] - pv[1]];
            let mut ok = true;
            let (mut x, mut y) = (head[0] + d[0], head[1] + d[1]);
            while in_b(x, y) {
                if occ[idx(x, y)] != -1 || used[idx(x, y)] == stamp {
                    ok = false;
                    break;
                }
                x += d[0];
                y += d[1];
            }
            if !ok {
                continue;
            }
            let id = arrows.len() as i32;
            let cells: Vec<[i32; 2]> = if forward {
                path.clone()
            } else {
                path.iter().rev().copied().collect()
            };
            for c in &cells {
                occ[idx(c[0], c[1])] = id;
            }
            arrows.push(Arrow { cells, dir: d });
            break;
        }
    }
    arrows
}

/// Generate a board for `cfg` with up to 6 deterministic retries (the same RNG
/// stream continues across them), keeping the attempt with the most arrows and
/// stopping early once fill reaches 85% of target — the spec's retry wrapper.
#[must_use]
pub fn generate(cfg: &Config) -> Board {
    let mut rng = Rng::new(cfg.seed);
    let mut best: Option<Vec<Arrow>> = None;
    let stop = (f64::from(cfg.target) * 0.85).floor() as i32;
    for _ in 0..6 {
        let arrows = generate_once(cfg, &mut rng);
        if best.as_ref().is_none_or(|b| arrows.len() > b.len()) {
            best = Some(arrows);
        }
        if best.as_ref().map(Vec::len).unwrap_or(0) as i32 >= stop {
            break;
        }
    }
    Board::new(cfg.w, cfg.h, best.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{daily_config, daily_seed, level_config};

    /// The generated arrow list for a level, in the spec's JSON shape, so it can
    /// be compared to a golden vector byte-for-byte.
    fn arrows_json(board: &Board) -> serde_json::Value {
        serde_json::to_value(board.arrows()).expect("serialize arrows")
    }

    #[test]
    fn level1_board_matches_golden() {
        let board = generate(&level_config(1));
        let golden: serde_json::Value = serde_json::from_str(
            r#"[{"cells":[[2,4],[1,4],[0,4]],"dir":[-1,0]},{"cells":[[3,4],[4,4],[4,5]],"dir":[0,1]},{"cells":[[1,3],[1,2],[1,1]],"dir":[0,-1]}]"#,
        )
        .unwrap();
        assert_eq!(arrows_json(&board), golden);
    }

    #[test]
    fn level50_board_matches_golden() {
        let board = generate(&level_config(50));
        let golden: serde_json::Value = serde_json::from_str(GOLDEN_L50).unwrap();
        assert_eq!(arrows_json(&board), golden);
    }

    #[test]
    fn deterministic_byte_identical() {
        for n in [1u32, 7, 42, 100] {
            let a = generate(&level_config(n));
            let b = generate(&level_config(n));
            assert_eq!(
                arrows_json(&a),
                arrows_json(&b),
                "level {n} re-generates identically"
            );
        }
        let seed = daily_seed("2026-08-02");
        let a = generate(&daily_config(seed));
        let b = generate(&daily_config(seed));
        assert_eq!(arrows_json(&a), arrows_json(&b));
    }

    // Golden arrow counts for all 100 levels, from the JS reference. A single
    // off-by-one anywhere in the port trips this.
    const GOLDEN_COUNTS: [i32; 100] = [
        3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 9, 11, 12, 12, 13, 14, 14, 15, 15, 16, 17, 17, 18, 19,
        18, 17, 18, 20, 21, 23, 21, 22, 22, 24, 25, 26, 25, 27, 25, 26, 30, 31, 31, 30, 31, 28, 30,
        29, 30, 30, 28, 35, 32, 32, 35, 29, 34, 30, 35, 33, 34, 38, 35, 35, 39, 36, 37, 40, 38, 37,
        35, 43, 43, 43, 40, 42, 43, 41, 45, 43, 44, 45, 47, 48, 43, 51, 47, 52, 55, 50, 56, 50, 51,
        49, 51, 58, 51, 52, 54,
    ];

    #[test]
    fn all_100_level_counts_match_golden() {
        for n in 1..=100u32 {
            let board = generate(&level_config(n));
            assert_eq!(
                board.arrows().len() as i32,
                GOLDEN_COUNTS[(n - 1) as usize],
                "arrow count for level {n}"
            );
        }
    }

    const GOLDEN_L50: &str = r#"[{"cells":[[8,0],[7,0],[6,0]],"dir":[-1,0]},{"cells":[[3,1],[4,1],[5,1],[6,1]],"dir":[1,0]},{"cells":[[8,1],[8,2],[8,3],[7,3],[7,4],[7,5]],"dir":[0,1]},{"cells":[[1,4],[1,5],[0,5]],"dir":[-1,0]},{"cells":[[9,5],[9,4],[9,3],[9,2],[9,1],[9,0]],"dir":[0,-1]},{"cells":[[1,1],[0,1],[0,0]],"dir":[0,-1]},{"cells":[[9,10],[10,10],[10,11],[10,12],[9,12],[9,13],[9,14],[9,15]],"dir":[0,1]},{"cells":[[3,2],[2,2],[2,1]],"dir":[0,-1]},{"cells":[[3,10],[3,11],[2,11],[1,11],[1,12],[1,13],[1,14],[1,15]],"dir":[0,1]},{"cells":[[9,11],[8,11],[8,12]],"dir":[0,1]},{"cells":[[10,3],[10,2],[10,1],[10,0]],"dir":[0,-1]},{"cells":[[5,6],[5,7]],"dir":[0,1]},{"cells":[[2,5],[2,6],[1,6],[0,6],[0,7],[0,8]],"dir":[0,1]},{"cells":[[4,11],[4,12],[5,12],[5,13],[5,14]],"dir":[0,1]},{"cells":[[7,7],[6,7],[6,8],[6,9],[6,10],[6,11],[6,12]],"dir":[0,1]},{"cells":[[6,15],[6,14],[6,13],[7,13],[8,13],[8,14],[8,15]],"dir":[0,1]},{"cells":[[6,3],[5,3]],"dir":[-1,0]},{"cells":[[2,8],[2,9],[2,10],[1,10],[0,10],[0,11],[0,12]],"dir":[0,1]},{"cells":[[4,5],[4,4],[4,3],[3,3]],"dir":[-1,0]},{"cells":[[2,12],[3,12],[3,13],[4,13],[4,14],[3,14],[3,15]],"dir":[0,1]},{"cells":[[4,6],[3,6],[3,5],[3,4],[2,4],[2,3],[1,3]],"dir":[-1,0]},{"cells":[[6,4],[6,5],[6,6],[7,6],[8,6],[9,6],[10,6]],"dir":[1,0]},{"cells":[[10,13],[10,14],[10,15]],"dir":[0,1]},{"cells":[[2,13],[2,14]],"dir":[0,1]},{"cells":[[0,13],[0,14],[0,15]],"dir":[0,1]},{"cells":[[9,8],[9,9],[10,9]],"dir":[1,0]},{"cells":[[7,14],[7,15]],"dir":[0,1]},{"cells":[[7,10],[8,10],[8,9],[8,8],[8,7],[9,7],[10,7]],"dir":[1,0]},{"cells":[[1,2],[0,2]],"dir":[-1,0]},{"cells":[[1,7],[1,8],[1,9],[0,9]],"dir":[-1,0]}]"#;
}
