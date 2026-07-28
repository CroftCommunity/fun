//! RNG-free tie-break unit tests — one per legal-move-rule edge (RULES.md
//! T1–T5). Constructed states, no deal. These name the *edges* (accept AND
//! reject on each rule) so a one-line mutation to a predicate fails a test.
//!
//! Suit order `♣=0(black) ♦=1(red) ♥=2(red) ♠=3(black)`.

use solitaire_core::{Card, GameState, Move, MoveError, TableauCard};

fn card(suit: u8, rank: u8) -> Card {
    Card { suit, rank }
}
fn up(c: Card) -> TableauCard {
    TableauCard {
        card: c,
        face_up: true,
    }
}
fn down(c: Card) -> TableauCard {
    TableauCard {
        card: c,
        face_up: false,
    }
}
fn empty() -> GameState {
    GameState {
        foundations: [0; 4],
        stock: Vec::new(),
        waste: Vec::new(),
        tableau: std::array::from_fn(|_| Vec::new()),
        draws: 0,
    }
}

// ---- Foundation-build rule (T2 / T4) ----

#[test]
fn foundation_accepts_ace_to_empty_rejects_non_ace() {
    let mut g = empty();
    g.waste = vec![card(0, 1)]; // A♣
    assert!(g.play_move(Move::WasteToFoundation).is_ok());
    assert_eq!(g.foundations[0], 1);
    assert!(g.waste.is_empty());

    let mut g = empty();
    g.waste = vec![card(0, 2)]; // 2♣ to empty foundation
    assert_eq!(
        g.play_move(Move::WasteToFoundation),
        Err(MoveError::Illegal)
    );
    assert_eq!(g.foundations[0], 0, "rejected move leaves state unchanged");
    assert_eq!(g.waste.len(), 1);
}

#[test]
fn foundation_ascends_same_suit_rejects_gap_and_wrong_suit() {
    let mut g = empty();
    g.foundations[0] = 1; // A♣ already down
    g.waste = vec![card(0, 2)]; // 2♣ — one above
    assert!(g.play_move(Move::WasteToFoundation).is_ok());
    assert_eq!(g.foundations[0], 2);

    // Gap (skip 3): 4♣ onto a foundation at 2 — rejected.
    g.waste = vec![card(0, 4)];
    assert_eq!(
        g.play_move(Move::WasteToFoundation),
        Err(MoveError::Illegal)
    );
    assert_eq!(g.foundations[0], 2);

    // Wrong suit: 3♦ targets the (empty) diamonds foundation, needs an Ace.
    g.waste = vec![card(1, 3)];
    assert_eq!(
        g.play_move(Move::WasteToFoundation),
        Err(MoveError::Illegal)
    );
    assert_eq!(g.foundations[1], 0);
}

// ---- Tableau-build rule (T3 / T5) ----

#[test]
fn tableau_empty_accepts_only_king() {
    let mut g = empty();
    g.waste = vec![card(3, 13)]; // K♠
    assert!(g.play_move(Move::WasteToTableau { pile: 0 }).is_ok());
    assert_eq!(g.tableau[0].len(), 1);
    assert!(g.tableau[0][0].face_up);

    let mut g = empty();
    g.waste = vec![card(3, 12)]; // Q♠ to empty pile
    assert_eq!(
        g.play_move(Move::WasteToTableau { pile: 0 }),
        Err(MoveError::Illegal)
    );
    assert!(g.tableau[0].is_empty());
}

#[test]
fn tableau_accepts_alt_colour_descending_rejects_same_colour_and_gap() {
    // 6♥ (red) onto 7♠ (black): alternating colour, one lower — ok.
    let mut g = empty();
    g.tableau[0] = vec![up(card(3, 7))];
    g.waste = vec![card(2, 6)]; // 6♥
    assert!(g.play_move(Move::WasteToTableau { pile: 0 }).is_ok());
    assert_eq!(g.tableau[0].len(), 2);

    // Same colour: 6♣ (black) onto 7♠ (black) — rejected.
    let mut g = empty();
    g.tableau[0] = vec![up(card(3, 7))];
    g.waste = vec![card(0, 6)]; // 6♣
    assert_eq!(
        g.play_move(Move::WasteToTableau { pile: 0 }),
        Err(MoveError::Illegal)
    );

    // Non-sequential: 5♥ onto 7♠ — rejected.
    let mut g = empty();
    g.tableau[0] = vec![up(card(3, 7))];
    g.waste = vec![card(2, 5)]; // 5♥
    assert_eq!(
        g.play_move(Move::WasteToTableau { pile: 0 }),
        Err(MoveError::Illegal)
    );
}

#[test]
fn tableau_rejects_placement_on_face_down_top() {
    let mut g = empty();
    g.tableau[0] = vec![down(card(3, 7))]; // contrived face-down top
    g.waste = vec![card(2, 6)];
    assert_eq!(
        g.play_move(Move::WasteToTableau { pile: 0 }),
        Err(MoveError::Illegal)
    );
}

// ---- Draw / recycle (T1) ----

#[test]
fn draw_moves_one_then_recycles_reversed() {
    let mut g = empty();
    g.stock = vec![card(0, 1), card(0, 2), card(0, 3)]; // top (drawn first) = 3♣
    for _ in 0..3 {
        assert!(g.play_move(Move::Draw).is_ok());
    }
    assert!(g.stock.is_empty());
    assert_eq!(g.waste.len(), 3);
    assert_eq!(
        g.waste.last().unwrap().rank,
        1,
        "last drawn = old bottom A♣"
    );

    // Recycle: waste back to stock reversed; next draw replays from old bottom.
    assert!(g.play_move(Move::Draw).is_ok());
    assert!(g.waste.is_empty());
    assert_eq!(g.stock.len(), 3);
    assert!(g.play_move(Move::Draw).is_ok());
    assert_eq!(
        g.waste.last().unwrap().rank,
        3,
        "recycle replays waste bottom-up"
    );
}

#[test]
fn draw_illegal_when_stock_and_waste_empty() {
    let mut g = empty();
    assert_eq!(g.play_move(Move::Draw), Err(MoveError::Illegal));
}

// ---- Tableau -> tableau run moves + auto-flip (T5) ----

#[test]
fn tableau_run_move_relocates_and_auto_flips_source() {
    let mut g = empty();
    // pile 0: [face-down 5♦][9♠ 8♥ 7♠] — a valid black-red-black run on top.
    g.tableau[0] = vec![
        down(card(1, 5)),
        up(card(3, 9)),
        up(card(2, 8)),
        up(card(3, 7)),
    ];
    // pile 1: [10♥] — 9♠ (black) sits on 10♥ (red).
    g.tableau[1] = vec![up(card(2, 10))];
    assert!(g
        .play_move(Move::TableauToTableau {
            from: 0,
            count: 3,
            to: 1
        })
        .is_ok());
    assert_eq!(g.tableau[1].len(), 4);
    assert_eq!(g.tableau[0].len(), 1);
    assert!(g.tableau[0][0].face_up, "exposed source card auto-flips");
}

#[test]
fn tableau_run_move_rejects_invalid_run() {
    let mut g = empty();
    g.tableau[0] = vec![up(card(3, 9)), up(card(3, 8))]; // 9♠,8♠ same colour: not a run
    assert_eq!(
        g.play_move(Move::TableauToTableau {
            from: 0,
            count: 2,
            to: 1
        }),
        Err(MoveError::Illegal)
    );
    assert_eq!(
        g.tableau[0].len(),
        2,
        "rejected move leaves state unchanged"
    );
}

#[test]
fn tableau_king_led_run_moves_to_empty_pile() {
    let mut g = empty();
    g.tableau[0] = vec![up(card(3, 13)), up(card(2, 12))]; // K♠, Q♥ — valid run
                                                           // pile 1 empty; bottom of the run is a King, so it may move to empty.
    assert!(g
        .play_move(Move::TableauToTableau {
            from: 0,
            count: 2,
            to: 1
        })
        .is_ok());
    assert_eq!(g.tableau[1].len(), 2);
    assert!(g.tableau[0].is_empty());
}

// ---- Tableau -> foundation + auto-flip (T4) ----

#[test]
fn tableau_to_foundation_moves_and_auto_flips() {
    let mut g = empty();
    g.tableau[0] = vec![down(card(1, 5)), up(card(0, 1))]; // A♣ on top of face-down 5♦
    assert!(g.play_move(Move::TableauToFoundation { pile: 0 }).is_ok());
    assert_eq!(g.foundations[0], 1);
    assert_eq!(g.tableau[0].len(), 1);
    assert!(g.tableau[0][0].face_up, "exposed card auto-flips");
}

// ---- Win + bad pile ----

#[test]
fn win_only_when_all_four_kings() {
    let mut g = empty();
    g.foundations = [13, 13, 13, 13];
    assert!(g.is_won());
    g.foundations = [13, 13, 13, 12];
    assert!(!g.is_won());
}

#[test]
fn bad_pile_index_is_reported() {
    let mut g = empty();
    g.waste = vec![card(3, 13)];
    assert_eq!(
        g.play_move(Move::WasteToTableau { pile: 9 }),
        Err(MoveError::BadPile(9))
    );
}

// ---- legal_moves canonical order ----

#[test]
fn legal_moves_are_enumerated_in_canonical_order() {
    let mut g = empty();
    g.stock = vec![card(0, 5)]; // a draw is available
    g.waste = vec![card(0, 1)]; // A♣ -> foundation legal; not placeable on empty tableau
                                // Draw, then WasteToFoundation; no tableau moves (all piles empty, A can't lead).
    assert_eq!(g.legal_moves(), vec![Move::Draw, Move::WasteToFoundation]);
}
