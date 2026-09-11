//! Which Token-2022 mints can sit in escrow.
//!
//! Tokenized stocks are Token-2022 mints with extensions (metadata, a scaled UI
//! amount for corporate actions, a pause switch and a permanent delegate for
//! the issuer's compliance). Most of that is harmless to an escrow. Two
//! extensions are not, because they would stop the escrow ever paying out, and
//! a stake that cannot come back out is worse than one never taken:
//!
//! * a transfer hook with a program set: every transfer needs that program's
//!   extra accounts, which this program does not pass, so settlement and the
//!   refund would both fail forever;
//! * non-transferable: self-explanatory.
//!
//! A transfer fee is not refused here. It would short the escrow, and
//! `create_duel` and `accept_duel` check the escrow received the full stake,
//! so such a duel fails to open rather than opening wrong.
//!
//! The TLV walk is done by hand, for the same reason as `pyth.rs`: it is a few
//! lines, and it keeps the dependency tree to what Anchor already pulls in.

use anchor_lang::prelude::*;

use crate::constants::TOKEN_2022;
use crate::errors::DuelError;

const BASE_MINT_LEN: usize = 82;
/// Token-2022 pads every extended account to a token account's length before
/// the account-type byte, so mints and accounts can share one layout.
const ACCOUNT_TYPE_OFFSET: usize = 165;
const ACCOUNT_TYPE_MINT: u8 = 1;

// ExtensionType discriminants, from spl-token-2022.
const EXT_UNINITIALIZED: u16 = 0;
const EXT_NON_TRANSFERABLE: u16 = 9;
const EXT_TRANSFER_HOOK: u16 = 14;

pub fn assert_escrowable(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != TOKEN_2022 {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    check_extensions(&data)
}

pub fn check_extensions(data: &[u8]) -> Result<()> {
    if data.len() <= BASE_MINT_LEN {
        return Ok(());
    }
    require!(
        data.len() > ACCOUNT_TYPE_OFFSET && data[ACCOUNT_TYPE_OFFSET] == ACCOUNT_TYPE_MINT,
        DuelError::UnsupportedMint
    );

    let mut at = ACCOUNT_TYPE_OFFSET + 1;
    while at + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = u16::from_le_bytes([data[at + 2], data[at + 3]]) as usize;
        if kind == EXT_UNINITIALIZED {
            break;
        }
        let start = at + 4;
        let end = start.checked_add(len).ok_or(DuelError::UnsupportedMint)?;
        require!(end <= data.len(), DuelError::UnsupportedMint);
        let value = &data[start..end];

        match kind {
            EXT_NON_TRANSFERABLE => return err!(DuelError::UnsupportedMint),
            // TransferHook { authority: OptionalNonZeroPubkey, program_id: OptionalNonZeroPubkey }
            EXT_TRANSFER_HOOK => {
                require!(value.len() >= 64, DuelError::UnsupportedMint);
                require!(
                    value[32..64].iter().all(|b| *b == 0),
                    DuelError::UnsupportedMint
                );
            }
            _ => {}
        }
        at = end;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mint_with(exts: &[(u16, Vec<u8>)]) -> Vec<u8> {
        let mut d = vec![0u8; ACCOUNT_TYPE_OFFSET];
        d.push(ACCOUNT_TYPE_MINT);
        for (kind, value) in exts {
            d.extend_from_slice(&kind.to_le_bytes());
            d.extend_from_slice(&(value.len() as u16).to_le_bytes());
            d.extend_from_slice(value);
        }
        d
    }

    #[test]
    fn a_plain_mint_is_fine() {
        assert!(check_extensions(&[0u8; 82]).is_ok());
    }

    #[test]
    fn metadata_pause_and_scaled_amount_are_fine() {
        let data = mint_with(&[(18, vec![1; 64]), (26, vec![2; 33]), (25, vec![3; 56])]);
        assert!(check_extensions(&data).is_ok());
    }

    #[test]
    fn a_live_transfer_hook_is_refused() {
        let mut hook = vec![0u8; 64];
        hook[40] = 1;
        assert!(check_extensions(&mint_with(&[(18, vec![1; 64]), (14, hook)])).is_err());
    }

    #[test]
    fn a_transfer_hook_with_no_program_is_fine() {
        let mut hook = vec![0u8; 64];
        hook[0] = 1; // an authority, but no program
        assert!(check_extensions(&mint_with(&[(14, hook)])).is_ok());
    }

    #[test]
    fn non_transferable_is_refused() {
        assert!(check_extensions(&mint_with(&[(9, vec![])])).is_err());
    }

    #[test]
    fn a_truncated_extension_is_refused() {
        let mut data = mint_with(&[]);
        data.extend_from_slice(&18u16.to_le_bytes());
        data.extend_from_slice(&64u16.to_le_bytes());
        data.extend_from_slice(&[0u8; 10]);
        assert!(check_extensions(&data).is_err());
    }
}
