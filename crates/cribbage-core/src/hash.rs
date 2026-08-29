//! Canonical state hash — the verifiable-outcome anchor.
//!
//! Lowercase-hex SHA-256 over a domain tag, a version, and every field of the
//! position in a fixed order, each integer little-endian, each list
//! length-prefixed — so the hash is byte-identical on native and `wasm32`.

use sha2::{Digest, Sha256};

use crate::game::{GameState, Phase, Seat, ShowStep};

/// The lowercase-hex SHA-256 of `s`'s canonical encoding.
#[must_use]
pub fn state_hash(s: &GameState) -> String {
    let mut h = Sha256::new();
    h.update(b"cribbage\x00");
    h.update(1u32.to_le_bytes());
    h.update(s.seed.to_le_bytes());
    h.update(s.deal_no.to_le_bytes());
    h.update([
        seat_byte(s.dealer),
        seat_byte(s.to_move),
        phase_byte(s.phase),
    ]);
    h.update(s.scores);
    for seat in [Seat::A, Seat::B] {
        cards(&mut h, &s.hands[seat.idx()]);
        cards(&mut h, &s.kept[seat.idx()]);
        cards(&mut h, &s.thrown[seat.idx()]);
    }
    cards(&mut h, &s.crib);
    h.update([s.cut.code()]);
    cards(&mut h, &s.stack);
    h.update((s.played.len() as u32).to_le_bytes());
    for (who, c) in &s.played {
        h.update([seat_byte(*who), c.code()]);
    }
    h.update([u8::from(s.go[0]), u8::from(s.go[1])]);
    h.update([s.last_player.map_or(0, seat_byte)]);
    h.update((s.shown.len() as u32).to_le_bytes());
    for sh in &s.shown {
        h.update([
            step_byte(sh.step),
            sh.claimed,
            sh.actual.total(),
            sh.muggins,
        ]);
    }
    hex::encode(h.finalize())
}

fn cards(h: &mut Sha256, list: &[crate::card::Card]) {
    h.update((list.len() as u32).to_le_bytes());
    for c in list {
        h.update([c.code()]);
    }
}

const fn seat_byte(seat: Seat) -> u8 {
    match seat {
        Seat::A => 1,
        Seat::B => 2,
    }
}

const fn step_byte(step: ShowStep) -> u8 {
    match step {
        ShowStep::NonDealer => 1,
        ShowStep::Dealer => 2,
        ShowStep::Crib => 3,
    }
}

const fn phase_byte(phase: Phase) -> u8 {
    match phase {
        Phase::Discard => 1,
        Phase::Peg => 2,
        Phase::Show(step) => 0x10 | step_byte(step),
        Phase::Over => 0xFF,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{apply, Move};

    #[test]
    fn hash_is_stable_lowercase_hex_sha256() {
        let a = GameState::new(3);
        let h = state_hash(&a);
        assert_eq!(h, state_hash(&GameState::new(3)));
        assert_eq!(h.len(), 64);
        assert!(h
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn every_phase_hashes_to_its_own_byte() {
        // Mutation audit 2026-08-29: `0x10 | step` survived `|` -> `&` because no
        // two positions differ only in their show step. The bytes are pinned
        // directly so the encoding cannot collapse the three show steps.
        let bytes = [
            phase_byte(Phase::Discard),
            phase_byte(Phase::Peg),
            phase_byte(Phase::Show(ShowStep::NonDealer)),
            phase_byte(Phase::Show(ShowStep::Dealer)),
            phase_byte(Phase::Show(ShowStep::Crib)),
            phase_byte(Phase::Over),
        ];
        let mut sorted = bytes.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), bytes.len(), "phase bytes collide: {bytes:?}");
    }

    #[test]
    fn every_transition_changes_the_hash_and_seeds_differ() {
        assert_ne!(
            state_hash(&GameState::new(3)),
            state_hash(&GameState::new(4))
        );
        let s = GameState::new(3);
        let t = apply(&s, Move::Discard(0)).unwrap();
        let u = apply(&t, Move::Discard(0)).unwrap();
        assert_ne!(state_hash(&s), state_hash(&t));
        assert_ne!(state_hash(&t), state_hash(&u));
    }
}
