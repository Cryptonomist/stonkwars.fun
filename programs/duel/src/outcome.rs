//! Who won: the stock with the larger percentage move.
//!
//! Decided in exact integer arithmetic. Two moves are compared by cross
//! multiplication, `c_end / c_start` against `o_end / o_start`, so there is no
//! division, no rounding and no basis-point truncation anywhere in the
//! decision. Basis points exist only for the event and the page.

use anchor_lang::prelude::*;
use std::cmp::Ordering;

use crate::errors::DuelError;
use crate::state::PricePoint;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Winner {
    Creator,
    Opponent,
    Tie,
}

/// A Pyth price and its exponent: the value is `price * 10^expo`.
#[derive(Clone, Copy, Debug)]
pub struct Px {
    pub price: i64,
    pub expo: i32,
}

impl From<PricePoint> for Px {
    fn from(p: PricePoint) -> Self {
        Px {
            price: p.price,
            expo: p.expo,
        }
    }
}

fn pow10(n: i64) -> Result<i128> {
    require!((0..=30).contains(&n), DuelError::MathOverflow);
    Ok(10i128.pow(n as u32))
}

/// Scale two mantissas to a common exponent.
fn align(a: i128, a_expo: i64, b: i128, b_expo: i64) -> Result<(i128, i128)> {
    match a_expo.cmp(&b_expo) {
        Ordering::Greater => Ok((
            a.checked_mul(pow10(a_expo - b_expo)?).ok_or(DuelError::MathOverflow)?,
            b,
        )),
        Ordering::Less => Ok((
            a,
            b.checked_mul(pow10(b_expo - a_expo)?).ok_or(DuelError::MathOverflow)?,
        )),
        Ordering::Equal => Ok((a, b)),
    }
}

/* A feed's exponent is fixed in practice, but nothing in the protocol promises
 * it, and a duel can last a month. So a start and an end with different
 * exponents are compared by value rather than by mantissa. */
pub fn decide(c_start: Px, c_end: Px, o_start: Px, o_end: Px) -> Result<Winner> {
    for p in [c_start, c_end, o_start, o_end] {
        require!(p.price > 0, DuelError::BadPrice);
    }
    // c_end/c_start  vs  o_end/o_start   <=>   c_end*o_start  vs  o_end*c_start
    let lhs = (c_end.price as i128)
        .checked_mul(o_start.price as i128)
        .ok_or(DuelError::MathOverflow)?;
    let rhs = (o_end.price as i128)
        .checked_mul(c_start.price as i128)
        .ok_or(DuelError::MathOverflow)?;
    let lhs_expo = c_end.expo as i64 + o_start.expo as i64;
    let rhs_expo = o_end.expo as i64 + c_start.expo as i64;
    let (lhs, rhs) = align(lhs, lhs_expo, rhs, rhs_expo)?;

    Ok(match lhs.cmp(&rhs) {
        Ordering::Greater => Winner::Creator,
        Ordering::Less => Winner::Opponent,
        Ordering::Equal => Winner::Tie,
    })
}

/// The move from `start` to `end` in basis points, truncated toward zero.
/// Display only: never used to decide a duel.
pub fn return_bps(start: Px, end: Px) -> Result<i64> {
    require!(start.price > 0 && end.price > 0, DuelError::BadPrice);
    let (s, e) = align(
        start.price as i128,
        start.expo as i64,
        end.price as i128,
        end.expo as i64,
    )?;
    let bps = (e - s)
        .checked_mul(10_000)
        .ok_or(DuelError::MathOverflow)?
        / s;
    i64::try_from(bps).map_err(|_| error!(DuelError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(price: i64) -> Px {
        Px { price, expo: -8 }
    }

    #[test]
    fn the_larger_percentage_move_wins_not_the_larger_dollar_move() {
        // NVDA 100 -> 103 (+3%), a $900 stock 900 -> 918 (+2%, but $18).
        let w = decide(px(100_0000_0000), px(103_0000_0000), px(900_0000_0000), px(918_0000_0000));
        assert_eq!(w.unwrap(), Winner::Creator);
        let w = decide(px(900_0000_0000), px(918_0000_0000), px(100_0000_0000), px(103_0000_0000));
        assert_eq!(w.unwrap(), Winner::Opponent);
    }

    #[test]
    fn losing_less_beats_losing_more() {
        // -1% against -4%.
        let w = decide(px(100_00), px(99_00), px(200_00), px(192_00)).unwrap();
        assert_eq!(w, Winner::Creator);
    }

    #[test]
    fn identical_moves_tie_exactly() {
        // +2% each, from different prices.
        let w = decide(px(50_00), px(51_00), px(300_00), px(306_00)).unwrap();
        assert_eq!(w, Winner::Tie);
    }

    #[test]
    fn a_one_unit_edge_is_still_decided() {
        let w = decide(px(1_000_000), px(1_000_001), px(1_000_000), px(1_000_000)).unwrap();
        assert_eq!(w, Winner::Creator);
    }

    #[test]
    fn mismatched_exponents_are_compared_by_value() {
        // Creator: 100.00 (expo -2) -> 110.000 (expo -3): +10%.
        // Opponent: flat.
        let c_start = Px { price: 100_00, expo: -2 };
        let c_end = Px { price: 110_000, expo: -3 };
        let o = Px { price: 5_000, expo: -2 };
        assert_eq!(decide(c_start, c_end, o, o).unwrap(), Winner::Creator);
        assert_eq!(return_bps(c_start, c_end).unwrap(), 1_000);
    }

    #[test]
    fn realistic_prices_do_not_overflow() {
        // $9,999.99999999 at expo -8 is ~1e12; the products are ~1e24.
        let big = px(999_999_999_999);
        assert!(decide(big, big, big, px(999_999_999_998)).is_ok());
    }

    #[test]
    fn return_bps_truncates_toward_zero() {
        assert_eq!(return_bps(px(100_00), px(103_12)).unwrap(), 312);
        assert_eq!(return_bps(px(100_00), px(96_88)).unwrap(), -312);
        assert_eq!(return_bps(px(3), px(4)).unwrap(), 3_333);
    }

    #[test]
    fn non_positive_prices_are_refused() {
        assert!(decide(px(0), px(1), px(1), px(1)).is_err());
        assert!(return_bps(px(-1), px(1)).is_err());
    }
}
