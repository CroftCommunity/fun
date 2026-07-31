//! Golden vectors — pin the deterministic deal output so a refill/geometry/hash
//! regression is caught (RULES.md "State hash"). Values are generated from the
//! green engine and pinned; regenerating them is a deliberate, reviewed act.

use bubble_core::clear_board_mode as m;
use bubble_core::{deal, state_hash};

#[test]
fn clear_board_deal_seed_1_is_pinned() {
    let d = deal(1, m::WIDTH, m::HEIGHT, m::ROWS_FILLED, m::COLORS);
    // 5 filled rows of width 8 (8+7+8+7+8) = 38 bubbles => 38 RNG draws.
    assert_eq!(d.draws, 38);
    let h = state_hash(&d.board, m::COLORS, d.draws, 0);
    assert_eq!(
        h,
        "e8d02919947a677f676d6cacadd1d1878d5507f3e44b60ee9db9d896d5332cee"
    );
}
