//! Deal + game tests: reverse construction yields a full, winnable board for
//! every layout and seed; the game plays, undoes, shuffles and replays; a
//! record verifies and a tampered one does not.

use mahjong_core::{
    daily_seed, deal, hash_str, layout, level_origin, matches, pair_up, pairs, state_hash, Board,
    Face, Game, LayoutId, Mahjong, Move, MoveError, Origin, Rng, SHUFFLE,
};
use pond_outcome::{attest, verify, Game as _, Outcome};

// ---------- rng ----------

#[test]
fn rng_is_the_integer_exact_fnv_mulberry_pair() {
    assert_eq!(hash_str(""), 2_166_136_261);
    assert_eq!(hash_str("a"), 0xE40C_292C);
    let mut a = Rng::new(7);
    let mut b = Rng::new(7);
    let xs: Vec<u32> = (0..8).map(|_| a.next_u32()).collect();
    let ys: Vec<u32> = (0..8).map(|_| b.next_u32()).collect();
    assert_eq!(xs, ys);
    for _ in 0..1000 {
        assert!(a.below(6) < 6);
    }
}

// ---------- deals ----------

fn face_multiset(faces: &[Face]) -> Vec<u8> {
    let mut v: Vec<u8> = faces.iter().map(|f| f.0).collect();
    v.sort_unstable();
    v
}

#[test]
fn a_deal_fills_every_slot_and_its_line_clears_the_board() {
    for id in LayoutId::ALL {
        for seed in [0u32, 1, 42, 0xDEAD_BEEF] {
            let l = layout(id);
            let d = deal(&l, seed).expect("deal");
            assert_eq!(d.faces.len(), l.len(), "{id:?}: one face per slot");
            assert_eq!(
                d.line.len() * 2,
                l.len(),
                "{id:?}: the line removes every tile"
            );
            let mut b = Board::new(l.clone(), d.faces.clone());
            for &(a, c) in &d.line {
                assert!(
                    matches(b.face(a), b.face(c)),
                    "{id:?} seed {seed}: line pair matches"
                );
                b.remove_pair(a, c).unwrap_or_else(|e| {
                    panic!("{id:?} seed {seed}: line pair ({a},{c}) refused: {e}")
                });
            }
            assert!(
                b.is_cleared(),
                "{id:?} seed {seed}: the construction line clears the board"
            );
        }
    }
}

#[test]
fn a_turtle_deal_uses_the_whole_set_and_smaller_boards_whole_pairs() {
    let turtle = deal(&layout(LayoutId::Turtle), 3).unwrap();
    let mut full: Vec<u8> = pairs().iter().flat_map(|p| [p[0].0, p[1].0]).collect();
    full.sort_unstable();
    assert_eq!(face_multiset(&turtle.faces), full);

    let pond = deal(&layout(LayoutId::Pond), 3).unwrap();
    assert!(
        pair_up(&pond.faces).is_some(),
        "a small deal is whole matchable pairs"
    );
}

#[test]
fn deals_are_deterministic_per_seed_and_differ_across_seeds() {
    let l = layout(LayoutId::Fortress);
    let a = deal(&l, 99).unwrap();
    let b = deal(&l, 99).unwrap();
    assert_eq!(a.faces, b.faces);
    assert_eq!(a.line, b.line);
    let c = deal(&l, 100).unwrap();
    assert_ne!(a.faces, c.faces);
}

#[test]
fn generation_rarely_needs_a_retry() {
    // The placement rules (support first, no single-slot gap) make a dead end
    // rare; this pins the measured rate so a regression in them shows up.
    let l = layout(LayoutId::Turtle);
    let mut retries = 0u32;
    for seed in 0..300u32 {
        let d = deal(&l, seed).unwrap();
        retries += d.attempts - 1;
    }
    println!("turtle retries over 300 seeds: {retries}");
    assert!(retries <= 30, "{retries} retries over 300 turtles");
}

// ---------- the game ----------

#[test]
fn origins_pack_to_a_js_safe_integer_and_back() {
    let o = Origin {
        layout: LayoutId::Steps,
        seed: 0xFFFF_FFFF,
    };
    let p = o.to_packed();
    assert!(p < (1u64 << 53));
    assert_eq!(Origin::from_packed(p), Some(o));
    assert_eq!(
        Origin::from_packed(9u64 << 32),
        None,
        "an unknown layout byte"
    );
}

#[test]
fn the_ladder_ramps_through_the_layouts_then_cycles() {
    assert_eq!(level_origin(1).layout, LayoutId::Pond);
    assert_eq!(level_origin(3).layout, LayoutId::Pond);
    assert_eq!(level_origin(4).layout, LayoutId::Bridge);
    assert_eq!(level_origin(9).layout, LayoutId::Fortress);
    assert_eq!(level_origin(16).layout, LayoutId::Steps);
    assert_eq!(level_origin(26).layout, LayoutId::Turtle);
    assert_eq!(level_origin(31).layout, LayoutId::Pond);
    assert_eq!(level_origin(35).layout, LayoutId::Turtle);
    assert_eq!(level_origin(36).layout, LayoutId::Pond);
    assert_ne!(level_origin(1).seed, level_origin(2).seed);
    assert_eq!(level_origin(7).seed, hash_str("mahjong-level-7"));
    assert_eq!(
        daily_seed("2026-08-30"),
        hash_str("mahjong-daily-2026-08-30")
    );
}

#[test]
fn play_removes_a_legal_pair_and_refuses_everything_else() {
    let mut g = Game::new(Origin {
        layout: LayoutId::Pond,
        seed: 1,
    })
    .unwrap();
    let before = g.current_hash();
    let (a, b) = g.board().legal_moves()[0];
    // A blocked tile, a non-matching pair, the same tile twice: no change.
    let blocked = (0..g.board().layout().len())
        .find(|&i| !g.board().is_free(i))
        .unwrap();
    assert_eq!(g.play(Move::pair(a, blocked)), Err(MoveError::Blocked));
    let other = g
        .board()
        .free_slots()
        .into_iter()
        .find(|&i| i != a && !matches(g.board().face(a), g.board().face(i)));
    if let Some(o) = other {
        assert_eq!(g.play(Move::pair(a, o)), Err(MoveError::NoMatch));
    }
    assert_eq!(g.play(Move::pair(a, a)), Err(MoveError::SameSlot));
    assert_eq!(
        g.current_hash(),
        before,
        "refusals leave the board untouched"
    );
    assert!(g.moves().is_empty());

    assert_eq!(g.play(Move::pair(a, b)), Ok(()));
    assert_eq!(g.board().remaining(), 34);
    assert_eq!(g.moves(), &[Move::pair(a, b)]);
    assert_eq!(g.play(Move::pair(a, b)), Err(MoveError::Gone));
}

#[test]
fn moves_encode_pairs_and_shuffle_in_one_number() {
    let m = Move::pair(7, 3);
    assert_eq!(m, Move::pair(3, 7), "a pair is unordered");
    assert_eq!(m.pair_slots(), Some((3, 7)));
    assert_eq!(SHUFFLE.pair_slots(), None);
    assert_eq!(Move::from_u32(m.to_u32()), m);
    assert_eq!(Move::from_u32(SHUFFLE.to_u32()), SHUFFLE);
}

#[test]
fn undo_restores_the_previous_position_exactly() {
    let mut g = Game::new(level_origin(2)).unwrap();
    let h0 = g.current_hash();
    let first = g.board().legal_moves()[0];
    g.play(Move::pair(first.0, first.1)).unwrap();
    let h1 = g.current_hash();
    let second = g.board().legal_moves()[0];
    g.play(Move::pair(second.0, second.1)).unwrap();
    assert!(g.undo());
    assert_eq!(g.current_hash(), h1);
    assert!(g.undo());
    assert_eq!(g.current_hash(), h0);
    assert!(!g.undo(), "nothing left to undo");
}

#[test]
fn shuffle_redeals_the_remaining_tiles_into_a_winnable_board_and_is_recorded() {
    let mut g = Game::new(level_origin(20)).unwrap();
    for _ in 0..10 {
        let (a, b) = g.board().legal_moves()[0];
        g.play(Move::pair(a, b)).unwrap();
    }
    let remaining_before = g.board().remaining();
    let present_before: Vec<bool> = g.board().present().to_vec();
    let faces_before: Vec<Face> = (0..present_before.len())
        .filter(|&i| present_before[i])
        .map(|i| g.board().face(i))
        .collect();
    let h_before = g.current_hash();

    assert_eq!(g.play(SHUFFLE), Ok(()));
    assert_eq!(g.moves().last(), Some(&SHUFFLE));
    assert_eq!(g.board().remaining(), remaining_before);
    assert_eq!(
        g.board().present(),
        &present_before[..],
        "shuffle moves faces, never slots"
    );
    let faces_after: Vec<Face> = (0..present_before.len())
        .filter(|&i| present_before[i])
        .map(|i| g.board().face(i))
        .collect();
    assert_eq!(face_multiset(&faces_before), face_multiset(&faces_after));
    assert_ne!(g.current_hash(), h_before);

    // Winnable again: the recorded construction line clears it.
    let mut b = g.board().clone();
    for &(a, c) in g.last_line() {
        b.remove_pair(a, c).unwrap();
    }
    assert!(b.is_cleared());

    // Undo takes the shuffle back.
    assert!(g.undo());
    assert_eq!(g.current_hash(), h_before);
}

#[test]
fn a_greedy_hint_is_a_legal_pair_or_none_when_stuck() {
    let g = Game::new(level_origin(1)).unwrap();
    let h = g.hint_greedy().expect("a fresh deal has a move");
    let (a, b) = h.pair_slots().unwrap();
    assert!(g.board().legal_moves().contains(&(a, b)));
}

#[test]
fn a_full_solve_attests_and_verifies_and_a_tampered_record_fails() {
    let mut g = Game::new(level_origin(1)).unwrap();
    // Follow the construction line through the live API.
    let line = g.last_line().to_vec();
    for (a, b) in line {
        g.play(Move::pair(a, b)).unwrap();
    }
    assert!(g.is_won());
    let record = attest::<Mahjong>(
        g.packed_seed(),
        g.moves().to_vec(),
        Outcome::Abandoned,
        Some(false),
    );
    assert_eq!(record.result, Outcome::Won);
    assert_eq!(record.kind, "mahjong");
    assert!(verify::<Mahjong>(&record).ok);

    let mut bad = record.clone();
    bad.moves.reverse();
    assert!(
        !verify::<Mahjong>(&bad).ok,
        "a reversed line replays to a different board"
    );

    let mut forged = record.clone();
    forged.moves.truncate(3);
    assert!(
        !verify::<Mahjong>(&forged).ok,
        "a truncated line is not a win"
    );
}

#[test]
fn replay_is_a_pure_function_of_the_packed_seed() {
    let g = Game::new(level_origin(9)).unwrap();
    let r = Mahjong::replay(g.packed_seed(), &[]);
    assert_eq!(r.final_hash, g.current_hash());
    assert!(!r.won);
    // A packed seed naming a layout that does not exist replays to a sentinel,
    // never a panic.
    let r = Mahjong::replay(200u64 << 32, &[]);
    assert!(!r.won);
}

#[test]
fn state_hash_distinguishes_positions_and_a_cleared_board_hashes_by_layout() {
    let l = layout(LayoutId::Pond);
    let mut a = Board::new(l.clone(), deal(&l, 5).unwrap().faces);
    let mut b = Board::new(l.clone(), deal(&l, 6).unwrap().faces);
    assert_ne!(state_hash(&a), state_hash(&b));
    for board in [&mut a, &mut b] {
        while let Some(&(x, y)) = board.legal_moves().first() {
            board.remove_pair(x, y).unwrap();
        }
    }
    if a.is_cleared() && b.is_cleared() {
        assert_eq!(state_hash(&a), state_hash(&b));
    }
}
