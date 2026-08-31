//! Phase 0 D2 spike: how many nodes does a quiescent alpha-beta need per depth
//! on chess middlegames, and what does that cost in wasm?
//!
//! THROWAWAY MEASUREMENT CODE (plan 2026-08-30-plan-chess-vs-engine.md, D2).
//! Not the engine chess-solver will ship: cozy-chess generates the moves, the
//! eval is material + a centre nudge, and none of it is under TDD (Discovery
//! Exemption). The one thing this must get right is COUNTING — every search
//! node increments `nodes` exactly once — because the node table it produces
//! seeds Phase 4's level budgets.
//!
//! Shared by the native driver (main.rs) and the wasm build: the position set
//! is computed deterministically in here so both measure the same searches.

use cozy_chess::{Board, Color, GameStatus, Move, Piece};
use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;
use std::sync::OnceLock;

/// Mate scores are folded to this bound; anything beyond it is a proven mate.
pub const MATE: i32 = 30_000;

fn piece_value(p: Piece) -> i32 {
    match p {
        Piece::Pawn => 100,
        Piece::Knight => 320,
        Piece::Bishop => 330,
        Piece::Rook => 500,
        Piece::Queen => 900,
        Piece::King => 0,
    }
}

/// Material + a small centre nudge, from the side to move's perspective.
fn eval(board: &Board) -> i32 {
    let mut score = 0i32;
    for &piece in &Piece::ALL {
        for sq in board.colored_pieces(Color::White, piece) {
            score += piece_value(piece) + centre_nudge(piece, sq as usize);
        }
        for sq in board.colored_pieces(Color::Black, piece) {
            score -= piece_value(piece) + centre_nudge(piece, sq as usize);
        }
    }
    if board.side_to_move() == Color::White {
        score
    } else {
        -score
    }
}

/// A tiny centrality bonus so the search has *some* positional signal.
fn centre_nudge(piece: Piece, sq: usize) -> i32 {
    let file = (sq % 8) as i32;
    let rank = (sq / 8) as i32;
    let centre = 6 - ((2 * file - 7).abs() + (2 * rank - 7).abs()) / 2;
    match piece {
        Piece::Knight | Piece::Bishop => 4 * centre,
        Piece::Pawn => 2 * centre,
        _ => 0,
    }
}

#[derive(Clone, Copy, Default)]
struct TtEntry {
    key: u64,
    depth: i8,
    bound: u8, // 0 empty, 1 exact, 2 lower, 3 upper
    value: i32,
    best: u16, // packed from|to<<6|promo<<12, 0 = none
}

const TT_BITS: u32 = 20; // 2^20 entries * 16 B = 16 MiB

fn pack(mv: Move) -> u16 {
    let promo = match mv.promotion {
        None => 0u16,
        Some(Piece::Knight) => 1,
        Some(Piece::Bishop) => 2,
        Some(Piece::Rook) => 3,
        Some(Piece::Queen) => 4,
        _ => 0,
    };
    mv.from as u16 | (mv.to as u16) << 6 | promo << 12
}

/// The searcher: negamax alpha-beta, MVV-LVA ordering, replace-always TT,
/// optional quiescence (captures + promotions, stand-pat).
pub struct Search {
    tt: Vec<TtEntry>,
    pub nodes: u64,
    use_quiescence: bool,
}

impl Search {
    pub fn new(use_quiescence: bool) -> Self {
        Search {
            tt: vec![TtEntry::default(); 1 << TT_BITS],
            nodes: 0,
            use_quiescence,
        }
    }

    fn moves(board: &Board) -> Vec<Move> {
        let mut out = Vec::with_capacity(48);
        board.generate_moves(|pm| {
            out.extend(pm);
            false
        });
        out
    }

    fn order(&self, board: &Board, moves: &mut [Move], tt_best: u16) {
        let mut keyed: Vec<(i32, Move)> = moves
            .iter()
            .map(|&mv| {
                let mut k = 0i32;
                if pack(mv) == tt_best && tt_best != 0 {
                    k = 1_000_000;
                } else if let Some(victim) = board.piece_on(mv.to) {
                    let attacker = board.piece_on(mv.from).unwrap_or(Piece::King);
                    k = 10_000 + 10 * piece_value(victim) - piece_value(attacker);
                } else if mv.promotion.is_some() {
                    k = 9_000;
                }
                (k, mv)
            })
            .collect();
        keyed.sort_by_key(|&(k, _)| -k);
        for (slot, (_, mv)) in moves.iter_mut().zip(keyed) {
            *slot = mv;
        }
    }

    fn qsearch(&mut self, board: &Board, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        self.nodes += 1;
        let moves = Self::moves(board);
        if moves.is_empty() {
            return if board.checkers().is_empty() {
                0
            } else {
                -MATE + ply
            };
        }
        let stand = eval(board);
        if stand >= beta {
            return stand;
        }
        if stand > alpha {
            alpha = stand;
        }
        let mut noisy: Vec<Move> = moves
            .into_iter()
            .filter(|mv| {
                board.piece_on(mv.to).is_some()
                    || mv.promotion.is_some()
                    || (board.piece_on(mv.from) == Some(Piece::Pawn)
                        && Some(mv.to.file()) == board.en_passant()
                        && board.piece_on(mv.to).is_none()
                        && mv.from.file() != mv.to.file())
            })
            .collect();
        self.order(board, &mut noisy, 0);
        let mut best = stand;
        for mv in noisy {
            let mut child = board.clone();
            child.play_unchecked(mv);
            let v = -self.qsearch(&child, -beta, -alpha, ply + 1);
            if v > best {
                best = v;
            }
            if v > alpha {
                alpha = v;
            }
            if alpha >= beta {
                break;
            }
        }
        best
    }

    fn alphabeta(&mut self, board: &Board, depth: i32, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        self.nodes += 1;
        let moves = Self::moves(board);
        if moves.is_empty() {
            return if board.checkers().is_empty() {
                0
            } else {
                -MATE + ply
            };
        }
        if board.halfmove_clock() >= 100 {
            return 0;
        }
        if depth <= 0 {
            return if self.use_quiescence {
                // The node at the horizon was already counted here; qsearch
                // counts its own nodes from the first capture on.
                self.nodes -= 1;
                self.qsearch(board, alpha, beta, ply)
            } else {
                eval(board)
            };
        }
        let idx = (board.hash() & ((1 << TT_BITS) - 1)) as usize;
        let entry = self.tt[idx];
        let mut tt_best = 0u16;
        if entry.key == board.hash() && entry.bound != 0 {
            tt_best = entry.best;
            if i32::from(entry.depth) >= depth {
                match entry.bound {
                    1 => return entry.value,
                    2 if entry.value >= beta => return entry.value,
                    3 if entry.value <= alpha => return entry.value,
                    _ => {}
                }
            }
        }
        let mut moves = moves;
        self.order(board, &mut moves, tt_best);
        let alpha_orig = alpha;
        let mut best = -MATE - 1;
        let mut best_mv = 0u16;
        for mv in moves {
            let mut child = board.clone();
            child.play_unchecked(mv);
            let v = -self.alphabeta(&child, depth - 1, -beta, -alpha, ply + 1);
            if v > best {
                best = v;
                best_mv = pack(mv);
            }
            if v > alpha {
                alpha = v;
            }
            if alpha >= beta {
                break;
            }
        }
        let bound = if best <= alpha_orig {
            3
        } else if best >= beta {
            2
        } else {
            1
        };
        self.tt[idx] = TtEntry {
            key: board.hash(),
            depth: depth as i8,
            bound,
            value: best,
            best: best_mv,
        };
        best
    }

    /// Search to `depth`; returns (value, best move) and leaves `nodes` counted.
    pub fn root(&mut self, board: &Board, depth: i32) -> (i32, Option<Move>) {
        let mut moves = Self::moves(board);
        if moves.is_empty() {
            return (0, None);
        }
        self.order(board, &mut moves, 0);
        let mut alpha = -MATE - 1;
        let mut best = None;
        for mv in moves {
            let mut child = board.clone();
            child.play_unchecked(mv);
            let v = -self.alphabeta(&child, depth - 1, -MATE - 1, -alpha, 1);
            if v > alpha {
                alpha = v;
                best = Some(mv);
            }
        }
        (alpha, best)
    }
}

/// The 16 hand-written opening/middlegame lines (UCI from the start position).
/// One cozy-chess quirk, worth recording for Phase 1: cozy encodes castling
/// king-takes-rook (e1h1), Chess960-style — chess-core will use the standard
/// UCI two-square king move (e1g1) as the plan specifies.
const LINES: &[&str] = &[
    // Italian, quiet
    "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1h1 e8h8",
    // Ruy Lopez, closed
    "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1h1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8h8",
    // French advance, closed centre
    "e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6",
    // QGD orthodox
    "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8h8 g1f3 h7h6 g5h4 b7b6",
    // King's Indian, closed
    "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8h8 f1e2 e7e5 d4d5",
    // Sicilian, open
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f1e2 e7e5 d4b3 f8e7",
    // Caro-Kann classical
    "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6",
    // London
    "d2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3 b8c6 b1d2 e7e6 g1f3 f8d6 f4g3",
    // English, reversed dragon
    "c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6",
    // Scandinavian
    "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6 f1c4 c8f5",
    // Vienna, tactical
    "e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 f8e7",
    // Scotch
    "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 f8c5 c1e3 d8f6 c2c3 g8e7",
    // Modern Benoni
    "d2d4 g8f6 c2c4 c7c5 d4d5 e7e6 b1c3 e6d5 c4d5 d7d6 e2e4 g7g6",
    // Dutch stonewall-ish
    "d2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7 e1h1 e8h8 c2c4 d7d6",
    // Slav
    "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6 f1c4",
    // Colle/stonewall setup
    "d2d4 d7d5 e2e3 g8f6 f1d3 c7c5 c2c3 b8c6 f2f4",
];

/// The 9 hand-written endgame/quiet FENs.
const FENS: &[&str] = &[
    // Lucena
    "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    // KP vs K
    "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
    // R+P vs K
    "8/8/8/4k3/8/8/4P3/4K2R w - - 0 1",
    // Q vs K (mate-finding stress)
    "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
    // Q+pawns vs Q+pawns
    "q5k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 1",
    // R endgame, 3 v 3 + active rook
    "6k1/5ppp/8/8/8/8/r4PPP/3R2K1 w - - 0 1",
    // N vs nothing, pawns
    "6k1/5ppp/8/8/8/2n5/5PPP/2B3K1 w - - 0 1",
    // opposite-coloured bishops
    "6k1/5ppp/8/8/8/2b5/2B2PPP/6K1 w - - 0 1",
    // N vs B, both wings
    "6k1/pp3ppp/2b5/8/8/2N5/PP3PPP/6K1 w - - 0 1",
];

/// The 50 measurement positions: 16 lines + 9 FENs + 25 random-play boards
/// (seeded ChaCha20, 20-40 plies, terminal or near-50-move boards skipped).
/// Deterministic, so the native and wasm builds measure the same searches.
pub fn positions() -> &'static Vec<Board> {
    static POSITIONS: OnceLock<Vec<Board>> = OnceLock::new();
    POSITIONS.get_or_init(|| {
        let mut out = Vec::with_capacity(50);
        for (li, line) in LINES.iter().enumerate() {
            let mut b = Board::default();
            for mv in line.split_whitespace() {
                let parsed: Move = mv.parse().unwrap_or_else(|_| panic!("line {li}: {mv} does not parse"));
                b.try_play(parsed)
                    .unwrap_or_else(|_| panic!("line {li}: {mv} is illegal here ({b})"));
            }
            out.push(b);
        }
        for fen in FENS {
            out.push(fen.parse().expect("spike FEN parses"));
        }
        let mut rng = ChaCha20Rng::seed_from_u64(0xC4E5_5000);
        let mut produced = 0;
        while produced < 25 {
            let target = 20 + (produced % 21);
            let mut b = Board::default();
            let mut ok = true;
            for _ in 0..target {
                if b.status() != GameStatus::Ongoing {
                    ok = false;
                    break;
                }
                let moves = Search::moves(&b);
                let mv = moves[(rng.next_u32() as usize) % moves.len()];
                b.play(mv);
            }
            if ok && b.status() == GameStatus::Ongoing {
                out.push(b);
                produced += 1;
            }
        }
        out
    })
}

/// The static evaluation from the side to move's perspective (hang probe).
pub fn static_value(board: &Board) -> i32 {
    eval(board)
}

/// A captures-only resolution of the position (hang probe): what the static
/// eval settles to once the standing captures are played out.
pub fn quiesce_value(board: &Board) -> i32 {
    let mut s = Search::new(true);
    s.qsearch(board, -MATE - 1, MATE + 1, 0)
}

// ---- wasm exports (raw C ABI; timed from JS with performance.now()) ----

/// Number of measurement positions.
#[no_mangle]
pub extern "C" fn pos_count() -> u32 {
    positions().len() as u32
}

/// Run one search; returns the node count. `use_q` non-zero enables quiescence.
/// A fresh TT per call, as the native driver does per position/depth.
#[no_mangle]
pub extern "C" fn search_nodes(pos: u32, depth: u32, use_q: u32) -> u64 {
    let board = &positions()[pos as usize];
    let mut s = Search::new(use_q != 0);
    let _ = s.root(board, depth as i32);
    s.nodes
}
