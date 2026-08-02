//! Golden vectors + the engine rulings (brief §10). Hand-built states pin the
//! pour quantity, legality, UI rulings, win/deadlock, and determinism; the hash
//! golden is a regression anchor. These are the unit-test surface the engine
//! purity buys.

use color_sort_core::{
    apply_move, deal, is_deadlocked, is_legal, legal_moves, pack_seed, state_hash, ui_moves,
    DealParams, Move, MoveError, State,
};

fn st(tubes: &[&[u8]], colors: u8, cap: u8) -> State {
    State::from_tubes(tubes.iter().map(|t| t.to_vec()).collect(), colors, cap)
}

// ---- §10.1 pour quantity ----

#[test]
fn partial_pour_moves_only_what_fits() {
    // Source has a run of 3 red (0) on top; target's top is also red with 1 free
    // slot → exactly 1 moves (partial pour), 2 red remain on the source.
    let mut s = st(&[&[0, 0, 0], &[1, 1, 0]], 2, 4);
    let moved = apply_move(&mut s, Move { from: 0, to: 1 }).expect("legal");
    assert_eq!(moved, 1, "run 3 into free 1 moves exactly 1");
    assert_eq!(s.tubes[0], vec![0, 0], "2 red remain on the source");
    assert_eq!(s.tubes[1], vec![1, 1, 0, 0]);
}

#[test]
fn full_run_pours_into_empty_up_to_capacity() {
    // Whole run of 3 red into an empty tube (cap 4) → all 3 move.
    let mut s = st(&[&[0, 0, 0], &[]], 1, 4);
    let moved = apply_move(&mut s, Move { from: 0, to: 1 }).expect("legal");
    assert_eq!(moved, 3);
    assert!(s.tubes[0].is_empty());
    assert_eq!(s.tubes[1], vec![0, 0, 0]);
}

#[test]
fn only_the_top_colour_run_pours_not_below_it() {
    // Source bottom→top [red, red, blue]; top run is one blue → only blue moves.
    let mut s = st(&[&[0, 0, 1], &[1]], 2, 4);
    let moved = apply_move(&mut s, Move { from: 0, to: 1 }).expect("legal");
    assert_eq!(moved, 1, "only the contiguous top-colour run moves");
    assert_eq!(s.tubes[0], vec![0, 0]);
    assert_eq!(s.tubes[1], vec![1, 1]);
}

// ---- §10.2 legality ----

#[test]
fn legality_rejects_bad_pours() {
    let s = st(&[&[0, 1], &[1], &[]], 2, 4);
    // non-matching tops (top of 0 is blue(1), top of 1 is blue(1)) → legal here;
    // build a mismatch: top of 0 is 1, target top is 0.
    let s2 = st(&[&[1], &[0]], 2, 4);
    assert!(
        !is_legal(&s2, Move { from: 0, to: 1 }),
        "non-matching tops rejected"
    );
    // full target
    let full = st(&[&[0], &[1, 1, 1, 1]], 2, 4);
    assert!(
        !is_legal(&full, Move { from: 0, to: 1 }),
        "full target rejected"
    );
    // self-pour
    assert!(!is_legal(&s, Move { from: 0, to: 0 }), "self-pour rejected");
    // from empty
    assert!(
        !is_legal(&s, Move { from: 2, to: 0 }),
        "pour from empty rejected"
    );
    // onto empty is legal
    assert!(is_legal(&s, Move { from: 0, to: 2 }), "onto empty is legal");
    // applying an illegal move errors and changes nothing
    let mut m = s2.clone();
    assert_eq!(
        apply_move(&mut m, Move { from: 0, to: 1 }),
        Err(MoveError::Illegal)
    );
    assert_eq!(m, s2);
}

// ---- §10.3 UI rulings ----

#[test]
fn ui_rulings_lock_and_block_vacuous() {
    // Tube 0 is a locked full-monochrome red; tube 1 has red on top; tube 2 empty.
    let s = st(&[&[0, 0, 0, 0], &[0, 1], &[]], 2, 4);
    assert!(s.is_locked(0));
    let ui = ui_moves(&s);
    // The locked tube 0 is never a source.
    assert!(
        ui.iter().all(|m| m.from != 0),
        "locked tube untappable as source"
    );
    // A full tube is never a legal target anyway.
    assert!(ui.iter().all(|m| m.to != 0));

    // Monochrome partial source into empty is blocked (vacuous); onto matching stays.
    let s2 = st(&[&[1, 1], &[1], &[]], 2, 4); // tube 0 monochrome blue (partial)
    let ui2 = ui_moves(&s2);
    assert!(
        !ui2.contains(&Move { from: 0, to: 2 }),
        "monochrome→empty is blocked"
    );
    assert!(
        ui2.contains(&Move { from: 0, to: 1 }),
        "monochrome→matching non-empty top stays allowed"
    );
    // Formally, monochrome→empty is still legal (the block is UI-only).
    assert!(is_legal(&s2, Move { from: 0, to: 2 }));
}

// ---- §10.4 win + deadlock ----

#[test]
fn win_condition() {
    let won = st(&[&[0, 0, 0, 0], &[1, 1, 1, 1], &[]], 2, 4);
    assert!(won.is_won());
    let not = st(&[&[0, 0, 0, 1], &[1, 1, 1, 0], &[]], 2, 4);
    assert!(!not.is_won());
}

#[test]
fn deadlock_with_empty_tube_but_only_vacuous_moves() {
    // Two monochrome partial tubes of different colours + one empty. The only
    // formal moves are each monochrome tube into the empty — all vacuous — so the
    // position is deadlocked despite an empty tube being present (§10.4).
    let s = st(&[&[0, 0], &[1, 1], &[]], 2, 4);
    assert!(!s.is_won());
    assert!(ui_moves(&s).is_empty(), "only vacuous moves exist");
    assert!(is_deadlocked(&s));
    // Formally there ARE legal moves (into the empty), so it is a UI deadlock.
    assert!(!legal_moves(&s).is_empty());
}

// ---- §10.5 determinism ----

#[test]
fn deal_is_deterministic_and_well_formed() {
    let p = DealParams {
        base: 12345,
        attempt: 0,
        colors: 10,
        empties: 2,
    };
    let a = deal(p);
    let b = deal(p);
    assert_eq!(a, b, "same params → identical deal");
    assert_eq!(a.tube_count(), 12, "10 colours + 2 empty");
    // Each colour appears exactly cap (4) times across the tubes.
    let mut counts = [0u32; 10];
    for tube in &a.tubes {
        for &c in tube {
            counts[c as usize] += 1;
        }
    }
    assert!(
        counts.iter().all(|&c| c == 4),
        "each colour appears exactly 4×"
    );
    // The last two tubes are the empties.
    assert!(a.tubes[10].is_empty() && a.tubes[11].is_empty());
}

#[test]
fn known_seed_deal_snapshot() {
    // A fixture snapshot: the daily-size deal for a fixed seed is pinned so a
    // determinism regression is caught (brief §10.5). Packed seed round-trips too.
    let p = DealParams {
        base: 2026_0802,
        attempt: 0,
        colors: 10,
        empties: 2,
    };
    let packed = pack_seed(p);
    let s = deal(p);
    assert_eq!(
        color_sort_core::deal_from_seed(packed),
        s,
        "packed seed reconstructs the deal"
    );
    // Snapshot the state hash (regression anchor).
    let h = state_hash(&s);
    assert_eq!(h.len(), 64);
    assert_eq!(
        h, "7bbb91e83654b3fbf7dfe8aa9d136f56d9fcdcc6f9b1d0b3b5892cb4a45461ae",
        "canonical state-hash encoding is stable"
    );
}

// ---- §10.7 skin invariance is a UI concern, but the engine exposes stable state ----

#[test]
fn state_hash_is_sensitive_to_arrangement() {
    let a = st(&[&[0, 1], &[1, 0]], 2, 4);
    let b = st(&[&[1, 0], &[0, 1]], 2, 4);
    assert_ne!(
        state_hash(&a),
        state_hash(&b),
        "tube arrangement is part of the state"
    );
}
