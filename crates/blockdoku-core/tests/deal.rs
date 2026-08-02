//! B3: difficulty pools + the seeded deal (determinism, frequency purity, the
//! square3x3 trap, and the placeability guarantee).

use blockdoku_core::board::{Board, SIZE};
use blockdoku_core::deal::{deal, DealOptions, DealState};
use blockdoku_core::difficulty::{Allowed, Difficulty};
use blockdoku_core::shapes::{by_key, Tier};
use blockdoku_core::DetRng;

fn opts(difficulty: Difficulty) -> DealOptions {
    DealOptions {
        difficulty,
        ..DealOptions::default()
    }
}

#[test]
fn presets_match_the_reference() {
    assert_eq!(Difficulty::Easy.size_range(), (2, 4));
    assert_eq!(Difficulty::Normal.size_range(), (1, 5));
    assert_eq!(Difficulty::Hard.size_range(), (1, 3));
    assert_eq!(Difficulty::Expert.size_range(), (1, 4));

    assert!(Difficulty::Easy.hints_default());
    assert!(!Difficulty::Normal.hints_default());
    assert_eq!(Difficulty::Expert.move_limit(), Some(50));
    assert_eq!(Difficulty::Normal.move_limit(), None);

    assert_eq!(Difficulty::Normal.allowed(), Allowed::All);
    assert_eq!(Difficulty::Expert.allowed(), Allowed::All);
    assert!(matches!(Difficulty::Hard.allowed(), Allowed::List(_)));
}

#[test]
fn easy_drops_the_nonexistent_square3x3_key() {
    // easy's allowed list names square2x2, square3x3, l2x2, line2, line3.
    // square3x3 is not in the catalog -> dropped silently. Size range [2,4]
    // keeps all four real keys (each has max_dimension 2 or 3).
    let (standard, _wild, _magic) = Difficulty::Easy.resolve_pool();
    let mut got = standard.clone();
    got.sort_unstable();
    assert_eq!(got, vec!["l2x2", "line2", "line3", "square2x2"]);
    assert!(
        !standard.contains(&"square3x3"),
        "the nonexistent key must not leak into the pool"
    );
    assert!(
        by_key("square3x3").is_none(),
        "square3x3 is not in the catalog"
    );
}

#[test]
fn hard_pool_is_the_restricted_list_within_size() {
    let (standard, _w, _m) = Difficulty::Hard.resolve_pool();
    // hard list: single,line2,line3,l2x2,t3x2,z3x2 — all max_dimension <= 3.
    let mut got = standard.clone();
    got.sort_unstable();
    assert_eq!(
        got,
        vec!["l2x2", "line2", "line3", "single", "t3x2", "z3x2"]
    );
}

#[test]
fn magic_pool_is_kept_regardless_of_allowed_list() {
    // Even for hard (a restricted list), magic is only size-filtered, never
    // allowed-list filtered. hard size range [1,3] keeps the small magic blocks.
    let (_s, _w, magic) = Difficulty::Hard.resolve_pool();
    assert!(!magic.is_empty(), "magic pool kept under a restricted list");
    // Every magic key present is a real magic shape within the size range.
    for key in &magic {
        let s = by_key(key).unwrap();
        assert_eq!(s.tier, Tier::Magic);
        assert!(s.max_dimension() <= 3);
    }
}

#[test]
fn deal_is_deterministic_for_a_fixed_seed_and_options() {
    let o = opts(Difficulty::Normal);
    let run = || {
        let mut rng = DetRng::from_seed(12345);
        let mut st = DealState::default();
        let board = Board::empty();
        let mut keys = Vec::new();
        for _ in 0..20 {
            let tray = deal(3, &o, &board, &mut rng, &mut st);
            keys.push(tray.iter().map(|s| s.key).collect::<Vec<_>>());
        }
        keys
    };
    assert_eq!(run(), run(), "same seed+options -> identical deal sequence");
}

#[test]
fn different_seeds_diverge() {
    let o = opts(Difficulty::Normal);
    let board = Board::empty();
    let first = |seed| {
        let mut rng = DetRng::from_seed(seed);
        let mut st = DealState::default();
        deal(3, &o, &board, &mut rng, &mut st)
            .iter()
            .map(|s| s.key)
            .collect::<Vec<_>>()
    };
    // Not a hard guarantee for all seed pairs, but these two differ.
    assert_ne!(first(1), first(999_999));
}

#[test]
fn frequency_zero_deals_have_no_wild_or_magic_across_1000_deals() {
    // Default options: magic/wild disabled. Across many seeded deals, every piece
    // is a standard shape.
    let o = opts(Difficulty::Normal);
    let board = Board::empty();
    for seed in 0..1000u64 {
        let mut rng = DetRng::from_seed(seed);
        let mut st = DealState::default();
        let tray = deal(3, &o, &board, &mut rng, &mut st);
        assert_eq!(tray.len(), 3);
        for s in tray {
            assert_eq!(
                s.tier,
                Tier::Standard,
                "seed {seed}: {} is not standard",
                s.key
            );
        }
    }
}

#[test]
fn always_deals_three_pieces() {
    let o = opts(Difficulty::Normal);
    let board = Board::empty();
    let mut rng = DetRng::from_seed(7);
    let mut st = DealState::default();
    for _ in 0..50 {
        assert_eq!(deal(3, &o, &board, &mut rng, &mut st).len(), 3);
    }
}

#[test]
fn guarantee_placeable_yields_a_placeable_tray_on_a_nearly_full_board() {
    // Fill everything except a single free cell at (4,4): only a `single` fits.
    // With the guarantee on, the dealt tray must contain a placeable piece.
    let mut board = Board::empty();
    for r in 0..SIZE {
        for c in 0..SIZE {
            if (r, c) != (4, 4) {
                board.set(r, c, 1);
            }
        }
    }
    let o = opts(Difficulty::Normal); // guarantee_placeable defaults on
                                      // Try several seeds; each must produce a placeable tray.
    for seed in 0..25u64 {
        let mut rng = DetRng::from_seed(seed);
        let mut st = DealState::default();
        let tray = deal(3, &o, &board, &mut rng, &mut st);
        assert!(
            board.has_any_placement(&tray),
            "seed {seed}: guaranteed tray should be placeable"
        );
    }
}

#[test]
fn wild_frequency_deals_wild_pieces_when_enabled() {
    // With wild enabled at a high frequency, wild pieces appear across deals.
    let o = DealOptions {
        difficulty: Difficulty::Normal,
        enable_wild: true,
        wild_frequency: 10,
        ..DealOptions::default()
    };
    let board = Board::empty();
    let mut rng = DetRng::from_seed(42);
    let mut st = DealState::default();
    let mut wild_seen = 0;
    for _ in 0..50 {
        for s in deal(3, &o, &board, &mut rng, &mut st) {
            if s.tier == Tier::Wild {
                wild_seen += 1;
            }
        }
    }
    assert!(
        wild_seen > 0,
        "wild pieces should appear when enabled at freq 10"
    );
}
