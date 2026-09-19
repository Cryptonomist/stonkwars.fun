//! Reading Pyth prices without the Pyth SDK.
//!
//! The one account type we need is parsed by hand. It is small, its layout is
//! fixed by the receiver's IDL, every byte of it is checked below, and the
//! dependency tree stays at what Anchor already pulls in. (When this was
//! written `pyth-solana-receiver-sdk` stopped at Anchor 0.31; its 2.0 release
//! supports Anchor 1.x. The parser stayed: it is smaller and fully tested.)
//!
//! ```text
//! PriceUpdateV2 (Borsh, after the 8-byte discriminator)
//!   write_authority     Pubkey   32
//!   verification_level  enum     1 (Full) or 2 (Partial { num_signatures: u8 })
//!   price_message:
//!     feed_id           [u8;32]  32
//!     price             i64       8
//!     conf              u64       8
//!     exponent          i32       4
//!     publish_time      i64       8
//!     prev_publish_time i64       8
//!     ema_price         i64       8
//!     ema_conf          u64       8
//!   posted_slot         u64       8
//! ```

use anchor_lang::prelude::*;

use crate::constants::PYTH_RECEIVER;
use crate::errors::DuelError;

/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

const VERIFICATION_PARTIAL: u8 = 0;
const VERIFICATION_FULL: u8 = 1;

/// Everything after the verification level that we read: feed id through
/// prev_publish_time.
const MESSAGE_PREFIX_LEN: usize = 32 + 8 + 8 + 4 + 8 + 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Observation {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
}

fn read_i64(data: &[u8], at: usize) -> i64 {
    i64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

/// Parse a PriceUpdateV2 account's data, refusing anything that is not fully
/// verified. A partially verified update has been checked against fewer
/// guardian signatures than a quorum, which is not good enough to move stakes.
pub fn parse_price_update(data: &[u8]) -> Result<Observation> {
    require!(data.len() >= 8 + 32 + 1, DuelError::NotPriceUpdate);
    require!(
        data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        DuelError::NotPriceUpdate
    );

    let mut at = 8 + 32;
    match data[at] {
        VERIFICATION_FULL => at += 1,
        VERIFICATION_PARTIAL => return err!(DuelError::PartiallyVerified),
        _ => return err!(DuelError::NotPriceUpdate),
    }
    require!(data.len() >= at + MESSAGE_PREFIX_LEN, DuelError::NotPriceUpdate);

    let feed_id: [u8; 32] = data[at..at + 32].try_into().unwrap();
    at += 32;
    let price = read_i64(data, at);
    at += 8;
    let conf = u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
    at += 8;
    let expo = i32::from_le_bytes(data[at..at + 4].try_into().unwrap());
    at += 4;
    let publish_time = read_i64(data, at);
    at += 8;
    let prev_publish_time = read_i64(data, at);

    Ok(Observation {
        feed_id,
        price,
        conf,
        expo,
        publish_time,
        prev_publish_time,
    })
}

/* THE ONE PRICE THAT COUNTS.
 *
 * Pyth publishes a new price several times a second, so "the price at 3:59:30"
 * is ambiguous: dozens of signed updates are valid near any moment, and a
 * settler who could choose among them could choose the winner. What makes it
 * unambiguous is that every update carries the publish time of the one before
 * it. Exactly one update satisfies
 *
 *     prev_publish_time < boundary <= publish_time
 *
 * — the first one published at or after the boundary. That is the only one
 * accepted. It is the same rule Pyth's EVM contract enforces in
 * `parsePriceFeedUpdatesUnique`, for the same reason. Anyone may post it, and
 * whoever does, the number is the same. */
pub fn check_boundary(obs: &Observation, feed_id: &[u8; 32], boundary: i64) -> Result<()> {
    require!(obs.feed_id == *feed_id, DuelError::WrongFeed);
    require!(obs.publish_time >= boundary, DuelError::PriceTooEarly);
    require!(obs.prev_publish_time < boundary, DuelError::NotFirstPrice);
    require!(obs.price > 0, DuelError::BadPrice);
    Ok(())
}

/// Read the price for `boundary` from an account the Pyth receiver owns.
pub fn read_boundary_price(
    account: &AccountInfo,
    feed_id: &[u8; 32],
    boundary: i64,
) -> Result<Observation> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER, DuelError::NotPythAccount);
    let data = account.try_borrow_data()?;
    let obs = parse_price_update(&data)?;
    check_boundary(&obs, feed_id, boundary)?;
    Ok(obs)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn encode(level: u8, obs: &Observation) -> Vec<u8> {
        let mut d = Vec::with_capacity(134);
        d.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        d.extend_from_slice(&[7u8; 32]);
        d.push(level);
        if level == VERIFICATION_PARTIAL {
            d.push(5);
        }
        d.extend_from_slice(&obs.feed_id);
        d.extend_from_slice(&obs.price.to_le_bytes());
        d.extend_from_slice(&obs.conf.to_le_bytes());
        d.extend_from_slice(&obs.expo.to_le_bytes());
        d.extend_from_slice(&obs.publish_time.to_le_bytes());
        d.extend_from_slice(&obs.prev_publish_time.to_le_bytes());
        d.extend_from_slice(&obs.price.to_le_bytes());
        d.extend_from_slice(&obs.conf.to_le_bytes());
        d.extend_from_slice(&42u64.to_le_bytes());
        d.resize(134, 0);
        d
    }

    fn code<T: std::fmt::Debug>(r: Result<T>) -> u32 {
        match r.unwrap_err() {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn err(e: DuelError) -> u32 {
        e as u32 + anchor_lang::error::ERROR_CODE_OFFSET
    }

    fn sample() -> Observation {
        Observation {
            feed_id: [9u8; 32],
            price: 18_231_000_000,
            conf: 4_000_000,
            expo: -8,
            publish_time: 1_000,
            prev_publish_time: 999,
        }
    }

    #[test]
    fn parses_a_fully_verified_update() {
        let obs = sample();
        assert_eq!(parse_price_update(&encode(VERIFICATION_FULL, &obs)).unwrap(), obs);
    }

    #[test]
    fn refuses_partial_verification() {
        let data = encode(VERIFICATION_PARTIAL, &sample());
        assert_eq!(code(parse_price_update(&data)), err(DuelError::PartiallyVerified));
    }

    #[test]
    fn refuses_another_account_type() {
        let mut data = encode(VERIFICATION_FULL, &sample());
        data[0] ^= 1;
        assert_eq!(code(parse_price_update(&data)), err(DuelError::NotPriceUpdate));
        assert_eq!(code(parse_price_update(&data[..20])), err(DuelError::NotPriceUpdate));
    }

    #[test]
    fn the_first_price_at_the_boundary_is_the_only_one_accepted() {
        let feed = [9u8; 32];
        let mut obs = sample();

        // Published exactly on the boundary, previous one before it: accepted.
        obs.publish_time = 1_000;
        obs.prev_publish_time = 999;
        check_boundary(&obs, &feed, 1_000).unwrap();

        // A later update in the same second: its predecessor is already at the
        // boundary, so it is not the first.
        obs.prev_publish_time = 1_000;
        assert_eq!(code(check_boundary(&obs, &feed, 1_000)), err(DuelError::NotFirstPrice));

        // The first update after a gap (the market was shut): accepted.
        obs.publish_time = 1_500;
        obs.prev_publish_time = 400;
        check_boundary(&obs, &feed, 1_000).unwrap();

        // Too early.
        obs.publish_time = 999;
        obs.prev_publish_time = 998;
        assert_eq!(code(check_boundary(&obs, &feed, 1_000)), err(DuelError::PriceTooEarly));
    }

    #[test]
    fn checks_the_feed_and_the_sign() {
        let obs = sample();
        assert_eq!(code(check_boundary(&obs, &[1u8; 32], 1_000)), err(DuelError::WrongFeed));
        let mut neg = obs;
        neg.price = 0;
        assert_eq!(code(check_boundary(&neg, &[9u8; 32], 1_000)), err(DuelError::BadPrice));
    }
}
