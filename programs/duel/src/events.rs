use anchor_lang::prelude::*;

#[event]
pub struct OracleSet {
    pub oracle: Pubkey,
}

#[event]
pub struct HandleLinked {
    pub wallet: Pubkey,
    pub x_id: u64,
    pub handle: String,
}

#[event]
pub struct HandleUnlinked {
    pub wallet: Pubkey,
    pub x_id: u64,
}

#[event]
pub struct AssetRegistered {
    pub mint: Pubkey,
    pub feed_id: [u8; 32],
    pub symbol: String,
    pub source: u8,
}

#[event]
pub struct AssetUpdated {
    pub mint: Pubkey,
    pub feed_id: [u8; 32],
    pub enabled: bool,
    pub source: u8,
}

#[event]
pub struct DuelCreated {
    pub duel: Pubkey,
    pub creator: Pubkey,
    pub creator_mint: Pubkey,
    pub opponent_mint: Pubkey,
    pub creator_amount: u64,
    pub opponent_amount: u64,
    pub duration_secs: i64,
    pub end_ts: i64,
    pub expires_ts: i64,
    pub invitee: Pubkey,
}

#[event]
pub struct DuelCancelled {
    pub duel: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct DuelAccepted {
    pub duel: Pubkey,
    pub opponent: Pubkey,
    pub accepted_ts: i64,
}

#[event]
pub struct DuelStarted {
    pub duel: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub creator_price: i64,
    pub creator_expo: i32,
    pub opponent_price: i64,
    pub opponent_expo: i32,
}

#[event]
pub struct DuelVoided {
    pub duel: Pubkey,
    pub reason: u8,
}

#[event]
pub struct DuelSettled {
    pub duel: Pubkey,
    pub outcome: u8,
    pub winner: Pubkey,
    pub creator_return_bps: i64,
    pub opponent_return_bps: i64,
}

#[event]
pub struct DuelRefunded {
    pub duel: Pubkey,
}

#[event]
pub struct FeeSet {
    pub treasury: Pubkey,
    /// The rate for duels created at or after `from_ts`.
    pub fee_bps: u16,
    /// The most a duel created before `from_ts` pays.
    pub prior_bps: u16,
    pub from_ts: i64,
}

#[event]
pub struct FeeTaken {
    pub duel: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub bps: u16,
    pub treasury: Pubkey,
}
