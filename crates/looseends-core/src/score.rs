//! Star and score grading — pure functions of mistakes and hints, per the spec.
//! These live in the core so the UI never re-implements the rules.

/// Stars earned: **3** for a flawless solve (no mistakes, no hints), **2** for
/// exactly one mistake-or-hint, else **1**.
#[must_use]
pub fn stars(mistakes: u32, hints: u32) -> u8 {
    if mistakes == 0 && hints == 0 {
        3
    } else if mistakes + hints == 1 {
        2
    } else {
        1
    }
}

/// Score: `max(300, 1500 - 300*mistakes - 200*hints)`.
#[must_use]
pub fn score(mistakes: u32, hints: u32) -> u32 {
    let raw = 1500i64 - 300 * i64::from(mistakes) - 200 * i64::from(hints);
    raw.max(300) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grading_matches_spec() {
        assert_eq!(stars(0, 0), 3);
        assert_eq!(stars(1, 0), 2);
        assert_eq!(stars(0, 1), 2);
        assert_eq!(stars(1, 1), 1);
        assert_eq!(stars(2, 0), 1);

        assert_eq!(score(0, 0), 1500);
        assert_eq!(score(1, 0), 1200);
        assert_eq!(score(0, 1), 1300);
        assert_eq!(score(3, 3), 300); // clamped floor
        assert_eq!(score(10, 10), 300);
    }
}
