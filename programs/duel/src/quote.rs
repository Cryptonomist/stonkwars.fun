//! Signed prices, for the stocks no Pyth feed on this deployment covers.
//!
//! Pyth's free tier prices a handful of US equities. Every other tokenized
//! stock is priced by an oracle key the admin names in `Config`, which signs
//! one fixed message per stock per boundary. The settler carries that
//! signature in an instruction to Solana's Ed25519 program, in the same
//! transaction as the start or the settle, and this module finds it there
//! through the instructions sysvar. Had the signature been bad, the Ed25519
//! program would have failed the whole transaction, so any quote found here
//! was signed.
//!
//! ```text
//! Quote (78 bytes, little-endian)
//!   prefix        b"STONKWARS:PRICE:v1"  18
//!   feed          [u8;32]                32   Asset::feed_id
//!   boundary      i64                     8   the moment it is the price for
//!   price         i64                     8
//!   expo          i32                     4
//!   publish_time  i64                     8   the market time it is as of
//! ```
//!
//! A quote is a statement about the market, not about a duel: "the first
//! price of this stock at or after this moment was this". It names no duel,
//! program or cluster, and needs to name none, because a true statement stays
//! true wherever it is replayed. The oracle derives it from completed
//! one-minute bars, so it signs the same quote however often it is asked and
//! a settler has nothing to choose between.

use anchor_lang::prelude::*;

use crate::constants::{ED25519_PROGRAM, INSTRUCTIONS_SYSVAR, QUOTE_PREFIX};
use crate::errors::DuelError;
use crate::state::PricePoint;

pub const QUOTE_LEN: usize = 18 + 32 + 8 + 8 + 4 + 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub feed: [u8; 32],
    pub boundary: i64,
    pub price: i64,
    pub expo: i32,
    pub publish_time: i64,
}

impl Quote {
    pub fn parse(msg: &[u8]) -> Option<Quote> {
        if msg.len() != QUOTE_LEN || msg[..18] != QUOTE_PREFIX[..] {
            return None;
        }
        Some(Quote {
            feed: msg[18..50].try_into().unwrap(),
            boundary: i64::from_le_bytes(msg[50..58].try_into().unwrap()),
            price: i64::from_le_bytes(msg[58..66].try_into().unwrap()),
            expo: i32::from_le_bytes(msg[66..70].try_into().unwrap()),
            publish_time: i64::from_le_bytes(msg[70..78].try_into().unwrap()),
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut m = Vec::with_capacity(QUOTE_LEN);
        m.extend_from_slice(QUOTE_PREFIX);
        m.extend_from_slice(&self.feed);
        m.extend_from_slice(&self.boundary.to_le_bytes());
        m.extend_from_slice(&self.price.to_le_bytes());
        m.extend_from_slice(&self.expo.to_le_bytes());
        m.extend_from_slice(&self.publish_time.to_le_bytes());
        m
    }
}

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    data.get(at..at.checked_add(2)?)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn slice(data: &[u8], at: usize, len: usize) -> Option<&[u8]> {
    data.get(at..at.checked_add(len)?)
}

/// The program id and data of instruction `i`, read from the instructions
/// sysvar in place. Laid out as `num_instructions: u16`, a u16 offset per
/// instruction, then each instruction as `num_accounts: u16`, 33 bytes per
/// account, `program_id`, `data_len: u16`, `data`.
fn instruction_at(sysvar: &[u8], i: usize) -> Option<(&[u8], &[u8])> {
    let start = u16_at(sysvar, 2 + i * 2)? as usize;
    let accounts = u16_at(sysvar, start)? as usize;
    let at = start + 2 + accounts * 33;
    let program_id = slice(sysvar, at, 32)?;
    let len = u16_at(sysvar, at + 32)? as usize;
    Some((program_id, slice(sysvar, at + 34, len)?))
}

/// Ed25519 program data: `num_signatures: u8`, a padding byte, then per
/// signature seven u16s: signature offset and instruction, public key offset
/// and instruction, message offset, size and instruction.
const OFFSETS_START: usize = 2;
const OFFSETS_LEN: usize = 14;
/// An instruction index meaning "this instruction".
const HERE: u16 = u16::MAX;

/// The quote `oracle` signed for `feed` at `boundary`, if this Ed25519
/// instruction carries one.
pub fn find_in_ed25519_data(
    data: &[u8],
    oracle: &Pubkey,
    feed: &[u8; 32],
    boundary: i64,
) -> Option<Quote> {
    let count = *data.first()? as usize;
    for i in 0..count {
        let at = OFFSETS_START + i * OFFSETS_LEN;
        /* An entry may point at bytes inside another instruction. Then the
         * Ed25519 program checked those bytes, not whatever sits at the same
         * offsets here, so only entries that point into this instruction are
         * read at all. */
        let here = [2, 6, 12]
            .iter()
            .all(|&field| u16_at(data, at + field) == Some(HERE));
        if !here {
            continue;
        }
        let key_at = u16_at(data, at + 4)? as usize;
        let msg_at = u16_at(data, at + 8)? as usize;
        let msg_len = u16_at(data, at + 10)? as usize;
        if slice(data, key_at, 32)? != oracle.as_ref() {
            continue;
        }
        match Quote::parse(slice(data, msg_at, msg_len)?) {
            Some(q) if q.feed == *feed && q.boundary == boundary => return Some(q),
            _ => continue,
        }
    }
    None
}

/// The oracle's price for `feed` at `boundary`, from an Ed25519 program
/// instruction anywhere in this transaction.
pub fn read_signed_price(
    instructions: &AccountInfo,
    oracle: &Pubkey,
    feed: &[u8; 32],
    boundary: i64,
) -> Result<PricePoint> {
    require_keys_eq!(
        *instructions.key,
        INSTRUCTIONS_SYSVAR,
        DuelError::NotInstructionsSysvar
    );
    require!(*oracle != Pubkey::default(), DuelError::NoOracle);

    let sysvar = instructions.try_borrow_data()?;
    let count = u16_at(&sysvar, 0).ok_or(DuelError::NotInstructionsSysvar)? as usize;
    for i in 0..count {
        let Some((program_id, data)) = instruction_at(&sysvar, i) else {
            continue;
        };
        if program_id != ED25519_PROGRAM.as_ref() {
            continue;
        }
        if let Some(q) = find_in_ed25519_data(data, oracle, feed, boundary) {
            require!(q.publish_time >= boundary, DuelError::PriceTooEarly);
            require!(q.price > 0, DuelError::BadPrice);
            return Ok(PricePoint {
                price: q.price,
                expo: q.expo,
                publish_time: q.publish_time,
            });
        }
    }
    err!(DuelError::NoSignedQuote)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::sysvar::instructions::{
        construct_instructions_data, BorrowedAccountMeta, BorrowedInstruction,
    };

    const ORACLE: Pubkey = Pubkey::new_from_array([5u8; 32]);
    const FEED: [u8; 32] = [9u8; 32];

    fn quote() -> Quote {
        Quote {
            feed: FEED,
            boundary: 1_000,
            price: 21_896,
            expo: -2,
            publish_time: 1_020,
        }
    }

    /// Ed25519 program data for one signature, the way the SDKs lay it out:
    /// offsets, then key, signature and message, all in this instruction.
    fn ed25519_data(key: &Pubkey, msg: &[u8], index: u16) -> Vec<u8> {
        let key_at = (OFFSETS_START + OFFSETS_LEN) as u16;
        let sig_at = key_at + 32;
        let msg_at = sig_at + 64;
        let mut d = vec![1u8, 0];
        for v in [sig_at, index, key_at, index, msg_at, msg.len() as u16, index] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(key.as_ref());
        d.extend_from_slice(&[0u8; 64]);
        d.extend_from_slice(msg);
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

    /// The instructions sysvar for a transaction of `ixs`, as an account.
    fn with_sysvar<R>(ixs: &[(Pubkey, Vec<u8>)], f: impl FnOnce(&AccountInfo) -> R) -> R {
        let payer = Pubkey::new_unique();
        let borrowed: Vec<BorrowedInstruction> = ixs
            .iter()
            .map(|(program_id, data)| BorrowedInstruction {
                program_id,
                accounts: vec![BorrowedAccountMeta {
                    pubkey: &payer,
                    is_signer: true,
                    is_writable: true,
                }],
                data,
            })
            .collect();
        let mut data = construct_instructions_data(&borrowed);
        let key = INSTRUCTIONS_SYSVAR;
        let owner = Pubkey::default();
        let mut lamports = 0u64;
        let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false);
        f(&info)
    }

    /// The same bytes are asserted by tests-web/oracle.test.ts against the
    /// TypeScript signer, so the two cannot drift apart.
    #[test]
    fn the_message_layout_is_pinned() {
        let golden = format!(
            "{}{}{}{}{}{}",
            "53544f4e4b574152533a50524943453a7631",
            "09".repeat(32),
            "e803000000000000",
            "8855000000000000",
            "feffffff",
            "fc03000000000000"
        );
        let hex: String = quote().encode().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, golden);
    }

    #[test]
    fn a_quote_round_trips() {
        let q = quote();
        assert_eq!(Quote::parse(&q.encode()), Some(q));
        let mut other = q.encode();
        other[0] ^= 1;
        assert_eq!(Quote::parse(&other), None);
        assert_eq!(Quote::parse(&q.encode()[..77]), None);
    }

    #[test]
    fn finds_the_oracle_quote_for_the_feed_and_boundary() {
        let q = quote();
        let data = ed25519_data(&ORACLE, &q.encode(), HERE);
        assert_eq!(find_in_ed25519_data(&data, &ORACLE, &FEED, 1_000), Some(q));
        // Another boundary, another feed, another signer: not this quote.
        assert_eq!(find_in_ed25519_data(&data, &ORACLE, &FEED, 1_001), None);
        assert_eq!(find_in_ed25519_data(&data, &ORACLE, &[1u8; 32], 1_000), None);
        let stranger = Pubkey::new_from_array([6u8; 32]);
        assert_eq!(find_in_ed25519_data(&data, &stranger, &FEED, 1_000), None);
    }

    #[test]
    fn ignores_entries_that_point_into_other_instructions() {
        let q = quote();
        let data = ed25519_data(&ORACLE, &q.encode(), 0);
        assert_eq!(find_in_ed25519_data(&data, &ORACLE, &FEED, 1_000), None);
    }

    #[test]
    fn reads_the_quote_through_the_sysvar() {
        let q = quote();
        let ixs = vec![
            (Pubkey::new_unique(), vec![1, 2, 3]),
            (ED25519_PROGRAM, ed25519_data(&ORACLE, &q.encode(), HERE)),
            (crate::ID, vec![7; 40]),
        ];
        let p = with_sysvar(&ixs, |s| read_signed_price(s, &ORACLE, &FEED, 1_000)).unwrap();
        assert_eq!((p.price, p.expo, p.publish_time), (21_896, -2, 1_020));

        // The same bytes under any other program id are just bytes.
        let fake = vec![(Pubkey::new_unique(), ed25519_data(&ORACLE, &q.encode(), HERE))];
        let r = with_sysvar(&fake, |s| read_signed_price(s, &ORACLE, &FEED, 1_000));
        assert_eq!(code(r), err(DuelError::NoSignedQuote));
    }

    #[test]
    fn refuses_quotes_that_break_the_rules() {
        let mut early = quote();
        early.publish_time = 999;
        let ixs = vec![(ED25519_PROGRAM, ed25519_data(&ORACLE, &early.encode(), HERE))];
        let r = with_sysvar(&ixs, |s| read_signed_price(s, &ORACLE, &FEED, 1_000));
        assert_eq!(code(r), err(DuelError::PriceTooEarly));

        let mut zero = quote();
        zero.price = 0;
        let ixs = vec![(ED25519_PROGRAM, ed25519_data(&ORACLE, &zero.encode(), HERE))];
        let r = with_sysvar(&ixs, |s| read_signed_price(s, &ORACLE, &FEED, 1_000));
        assert_eq!(code(r), err(DuelError::BadPrice));

        let ixs = vec![(ED25519_PROGRAM, ed25519_data(&ORACLE, &quote().encode(), HERE))];
        let r = with_sysvar(&ixs, |s| read_signed_price(s, &Pubkey::default(), &FEED, 1_000));
        assert_eq!(code(r), err(DuelError::NoOracle));
    }
}
