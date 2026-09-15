//! The platform fee: a share of the loser's stake, taken when a duel settles.
//!
//! Three rules, and every function here exists to keep them:
//!
//! * **Never above the cap.** `MAX_FEE_BPS` is a constant in the program.
//! * **Never a rate you did not see.** A raise reaches only duels created at
//!   least `FEE_NOTICE_SECS` after it was set. A cut reaches every duel at once.
//! * **Never in the way of a payout.** Settlement takes the fee only when the
//!   settler passes the fee accounts and they check out; otherwise the winner
//!   gets everything, exactly as before there was a fee. Ties, refunds and
//!   cancels are never charged.
//!
//! The schedule is two numbers and a time: `fee_bps` for duels created at or
//! after `from_ts`, and `prior_bps` as the most any older duel pays. Folding a
//! new change into those can only ever lower what an existing duel pays, never
//! raise it, so no history has to be kept.

use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, FEE_NOTICE_SECS, MAX_FEE_BPS};
use crate::errors::DuelError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Schedule {
    pub fee_bps: u16,
    pub prior_bps: u16,
    pub from_ts: i64,
}

/// The rate a duel created at `created_ts` pays under `s`.
pub fn rate_for(s: Schedule, created_ts: i64) -> u16 {
    if created_ts >= s.from_ts {
        s.fee_bps
    } else {
        s.fee_bps.min(s.prior_bps)
    }
}

/// The schedule after the admin asks for `new_bps` at `now`.
pub fn schedule(current: Schedule, new_bps: u16, now: i64) -> Result<Schedule> {
    require!(new_bps <= MAX_FEE_BPS, DuelError::FeeTooHigh);
    if new_bps <= current.fee_bps {
        // A cut, or no change: for everyone, now. An older duel's ceiling can
        // only come down with it.
        Ok(Schedule {
            fee_bps: new_bps,
            prior_bps: current.prior_bps.min(new_bps),
            from_ts: current.from_ts,
        })
    } else {
        // A raise: only for duels created after the notice. Everything created
        // before then pays at most what the lowest rate it could have seen was.
        Ok(Schedule {
            fee_bps: new_bps,
            prior_bps: current.prior_bps.min(current.fee_bps),
            from_ts: now.checked_add(FEE_NOTICE_SECS).ok_or(DuelError::MathOverflow)?,
        })
    }
}

/// The fee on `stake` at `bps`, rounded down: a fee never rounds up against a player.
pub fn fee_amount(stake: u64, bps: u16) -> u64 {
    ((stake as u128) * (bps as u128) / (BPS_DENOMINATOR as u128)) as u64
}

/* WHERE A FEE MAY GO.
 *
 * A token account for exactly this mint, owned by the treasury, initialized and
 * not frozen, and carrying no extension that could refuse an incoming transfer.
 * Anything else, and the fee is skipped rather than risked: a transfer that
 * fails would fail the settlement with it, and a settlement that anyone (an
 * admin turning on required memos for the treasury, an issuer freezing its
 * account) could make fail is a payout somebody can freeze.
 *
 * Checked on the raw bytes, like `mint_check.rs`. Token-2022 extensions are
 * allowed only from a short list of ones that never refuse a credit. */
const TOKEN_ACCOUNT_LEN: usize = 165;
const STATE_OFFSET: usize = 108;
const STATE_INITIALIZED: u8 = 1;
const ACCOUNT_TYPE_OFFSET: usize = 165;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
const EXT_UNINITIALIZED: u16 = 0;
/// TransferFeeAmount, ImmutableOwner, TransferHookAccount, PausableAccount.
const HARMLESS_ACCOUNT_EXTENSIONS: [u16; 4] = [2, 7, 15, 27];

pub fn treasury_account_ok(data: &[u8], mint: &Pubkey, treasury: &Pubkey, token_2022: bool) -> bool {
    if data.len() < TOKEN_ACCOUNT_LEN {
        return false;
    }
    if &data[0..32] != mint.as_ref() || &data[32..64] != treasury.as_ref() {
        return false;
    }
    if data[STATE_OFFSET] != STATE_INITIALIZED {
        return false; // uninitialized or frozen
    }
    if data.len() == TOKEN_ACCOUNT_LEN {
        return true;
    }
    if !token_2022 || data[ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_ACCOUNT {
        return false;
    }
    let mut at = ACCOUNT_TYPE_OFFSET + 1;
    while at + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = u16::from_le_bytes([data[at + 2], data[at + 3]]) as usize;
        if kind == EXT_UNINITIALIZED {
            break;
        }
        if !HARMLESS_ACCOUNT_EXTENSIONS.contains(&kind) {
            return false;
        }
        match (at + 4).checked_add(len) {
            Some(end) if end <= data.len() => at = end,
            _ => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;
    const NOW: i64 = 1_800_000_000;
    const FRESH: Schedule = Schedule { fee_bps: 0, prior_bps: 0, from_ts: 0 };

    #[test]
    fn a_fresh_deployment_charges_nothing_and_zero_stays_zero() {
        assert_eq!(rate_for(FRESH, NOW), 0);
        let s = schedule(FRESH, 0, NOW).unwrap();
        assert_eq!(s, FRESH);
    }

    #[test]
    fn the_cap_is_absolute() {
        assert!(schedule(FRESH, MAX_FEE_BPS, NOW).is_ok());
        assert!(schedule(FRESH, MAX_FEE_BPS + 1, NOW).is_err());
    }

    #[test]
    fn a_raise_waits_a_week_and_never_reaches_older_duels() {
        let s = schedule(FRESH, 250, NOW).unwrap();
        assert_eq!(s.from_ts, NOW + FEE_NOTICE_SECS);
        assert_eq!(rate_for(s, NOW - DAY), 0, "created before the announcement");
        assert_eq!(rate_for(s, NOW + DAY), 0, "created during the notice");
        assert_eq!(rate_for(s, NOW + FEE_NOTICE_SECS), 250, "created after it");
    }

    #[test]
    fn a_cut_reaches_everyone_at_once() {
        let raised = schedule(FRESH, 300, NOW).unwrap();
        let later = NOW + FEE_NOTICE_SECS + DAY;
        let cut = schedule(raised, 100, later).unwrap();
        assert_eq!(rate_for(raised, raised.from_ts + DAY / 2), 300);
        assert_eq!(rate_for(cut, raised.from_ts + DAY / 2), 100, "a duel created at 300 now pays 100");
        assert_eq!(rate_for(cut, later + DAY), 100);
        assert_eq!(rate_for(cut, NOW - DAY), 0, "older duels stay at what they saw");
    }

    #[test]
    fn a_second_raise_never_raises_a_duel_created_before_it() {
        let first = schedule(FRESH, 200, NOW).unwrap();
        let t = NOW + FEE_NOTICE_SECS + DAY;
        let second = schedule(first, 400, t).unwrap();
        for created in [NOW - DAY, NOW + DAY, t - DAY, t, t + DAY] {
            let before = rate_for(first, created);
            let after = rate_for(second, created);
            assert!(after <= before, "created {created}, before the new notice ended: {before} -> {after}");
        }
        assert_eq!(rate_for(second, t + FEE_NOTICE_SECS), 400);
    }

    #[test]
    fn a_cut_during_a_pending_raise_keeps_the_notice() {
        let raise = schedule(FRESH, 300, NOW).unwrap();
        let cut = schedule(raise, 200, NOW + DAY).unwrap();
        assert_eq!(cut.from_ts, raise.from_ts);
        assert_eq!(rate_for(cut, NOW + 2 * DAY), 0, "still inside the notice");
        assert_eq!(rate_for(cut, raise.from_ts), 200);
    }

    fn token_account(mint: &Pubkey, owner: &Pubkey, state: u8, exts: &[(u16, usize)]) -> Vec<u8> {
        let mut d = vec![0u8; TOKEN_ACCOUNT_LEN];
        d[0..32].copy_from_slice(mint.as_ref());
        d[32..64].copy_from_slice(owner.as_ref());
        d[STATE_OFFSET] = state;
        if !exts.is_empty() {
            d.push(ACCOUNT_TYPE_ACCOUNT);
            for (kind, len) in exts {
                d.extend_from_slice(&kind.to_le_bytes());
                d.extend_from_slice(&(*len as u16).to_le_bytes());
                d.extend(std::iter::repeat(0u8).take(*len));
            }
        }
        d
    }

    #[test]
    fn a_treasury_account_must_be_this_mint_this_treasury_and_open() {
        let (mint, treasury, other) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        assert!(treasury_account_ok(&token_account(&mint, &treasury, 1, &[]), &mint, &treasury, false));
        assert!(!treasury_account_ok(&token_account(&other, &treasury, 1, &[]), &mint, &treasury, false), "other mint");
        assert!(!treasury_account_ok(&token_account(&mint, &other, 1, &[]), &mint, &treasury, false), "other owner");
        assert!(!treasury_account_ok(&token_account(&mint, &treasury, 2, &[]), &mint, &treasury, false), "frozen");
        assert!(!treasury_account_ok(&token_account(&mint, &treasury, 0, &[]), &mint, &treasury, false), "uninitialized");
        assert!(!treasury_account_ok(&[0u8; 40], &mint, &treasury, false), "too short");
    }

    #[test]
    fn a_token_2022_treasury_account_may_carry_only_harmless_extensions() {
        let (mint, treasury) = (Pubkey::new_unique(), Pubkey::new_unique());
        // An xStock ATA: immutable owner and the pausable account marker.
        let plain = token_account(&mint, &treasury, 1, &[(7, 0), (27, 0)]);
        assert!(treasury_account_ok(&plain, &mint, &treasury, true));
        assert!(!treasury_account_ok(&plain, &mint, &treasury, false), "extensions on a classic account");
        // Required memos on incoming transfers would fail every settlement.
        let memo = token_account(&mint, &treasury, 1, &[(7, 0), (8, 1)]);
        assert!(!treasury_account_ok(&memo, &mint, &treasury, true));
        let confidential = token_account(&mint, &treasury, 1, &[(5, 20)]);
        assert!(!treasury_account_ok(&confidential, &mint, &treasury, true));
        let mut truncated = token_account(&mint, &treasury, 1, &[(7, 0)]);
        truncated.extend_from_slice(&2u16.to_le_bytes());
        truncated.extend_from_slice(&8u16.to_le_bytes());
        assert!(!treasury_account_ok(&truncated, &mint, &treasury, true));
    }

    #[test]
    fn fee_rounds_down_and_cannot_overflow() {
        assert_eq!(fee_amount(10_000, 250), 250);
        assert_eq!(fee_amount(399, 250), 9);
        assert_eq!(fee_amount(39, 250), 0);
        assert_eq!(fee_amount(u64::MAX, MAX_FEE_BPS), u64::MAX / 20);
        assert_eq!(fee_amount(12_345, 0), 0);
    }
}
