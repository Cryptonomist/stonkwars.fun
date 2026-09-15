use anchor_lang::prelude::*;

use crate::constants::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Blocks new duels and new accepts. Never blocks a cancel, a settlement
    /// or a refund: an admin who could freeze payouts would be a custodian.
    pub paused: bool,
    pub bump: u8,
    /// The key whose Ed25519-signed quotes price the stocks registered with
    /// SOURCE_SIGNED. Default (all zeros) means no signed source is usable.
    pub oracle: Pubkey,
}

/* THE PLATFORM FEE.
 *
 * Its own account rather than fields on Config, so adding it changed no
 * existing account's layout. A deployment that never calls `set_fee` has no
 * such account and charges nothing. See `fee.rs` for how a rate is chosen. */
#[account]
#[derive(InitSpace)]
pub struct FeeConfig {
    /// Who owns the token accounts fees are paid into.
    pub treasury: Pubkey,
    /// The rate for duels created at or after `from_ts`, in basis points.
    pub fee_bps: u16,
    /// The most a duel created before `from_ts` pays.
    pub prior_bps: u16,
    pub from_ts: i64,
    pub bump: u8,
}

/* A NAME ON THE LEADERBOARD.
 *
 * Wins are a wallet's, and a wallet is a string of characters nobody brags
 * about. A profile puts an X handle beside it, written only when the wallet
 * and the oracle both sign: the wallet proves who is claiming, and the oracle
 * signs only after X's own OAuth says the handle belongs to whoever asked.
 *
 * It is a label and nothing more. No fight, payout or ranking reads it, and a
 * wallet with no profile is ranked exactly the same. */
#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub wallet: Pubkey,
    /// X's numeric id for the account, which survives a change of handle.
    pub x_id: u64,
    #[max_len(MAX_HANDLE_LEN)]
    pub handle: String,
    pub linked_ts: i64,
    pub bump: u8,
}

/* WHICH WALLET AN X ACCOUNT POINTS AT.
 *
 * One per X account, so the same account cannot wear two wallets' records at
 * once. Linking again from a second wallet re-points this, which is what
 * somebody moving wallets wants; the old profile is left behind, and a reader
 * shows a handle only when the claim points back at the profile's wallet. So a
 * stale profile is invisible without anyone having to clean it up. */
#[account]
#[derive(InitSpace)]
pub struct XClaim {
    pub x_id: u64,
    pub wallet: Pubkey,
    pub bump: u8,
}

/* A STOCK THAT MAY BE DUELLED.
 *
 * The registry is what stops a duel in a worthless lookalike: anyone can mint
 * a token called NVDAx, but only a mint the admin registered, next to the
 * source that prices it, can be staked. The source and feed are copied onto
 * each duel at creation, so re-pointing an asset later cannot change a duel in
 * flight. */
#[account]
#[derive(InitSpace)]
pub struct Asset {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    /// Which stock this token is a share of, as a 32-byte id: the Pyth feed
    /// id for the stock where Pyth lists one, whichever source prices it. Two
    /// issuers' tokens of the same stock share an id, which is how a duel
    /// between them is refused.
    pub feed_id: [u8; 32],
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    pub decimals: u8,
    pub enabled: bool,
    pub bump: u8,
    pub source: u8,
}

/* WHERE A PRICE COMES FROM.
 *
 * PYTH is the trustless path: a PriceUpdateV2 account the Pyth receiver wrote
 * after checking Wormhole signatures, accepted only as the unique first price
 * at or after the boundary. SIGNED is for stocks no Pyth feed on this
 * deployment prices: a quote signed by Config::oracle, checked by Solana's
 * Ed25519 program in the same transaction. The second is only as honest as
 * the oracle key, and the app says so on every fight that uses it. */
pub const SOURCE_PYTH: u8 = 0;
pub const SOURCE_SIGNED: u8 = 1;

pub const STATUS_OPEN: u8 = 0;
/// Both stakes are in; waiting for the start prices to be posted.
pub const STATUS_ACCEPTED: u8 = 1;
pub const STATUS_LIVE: u8 = 2;
pub const STATUS_SETTLED: u8 = 3;
/// Could not be run fairly; both stakes are owed back by `refund_duel`.
pub const STATUS_VOID: u8 = 4;
pub const STATUS_REFUNDED: u8 = 5;

pub const OUTCOME_NONE: u8 = 0;
pub const OUTCOME_CREATOR: u8 = 1;
pub const OUTCOME_OPPONENT: u8 = 2;
pub const OUTCOME_TIE: u8 = 3;
pub const OUTCOME_VOID: u8 = 4;

pub const VOID_START_TOO_LATE: u8 = 1;
pub const VOID_TOO_SHORT: u8 = 2;

/// One observation, as recorded on a duel.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default, Debug)]
pub struct PricePoint {
    pub price: i64,
    pub expo: i32,
    pub publish_time: i64,
}

/* THE DUEL.
 *
 * FIELD ORDER IS AN INTERFACE. `creator`, `opponent` and `status` come first
 * and at fixed offsets (8, 40, 72) so the app can list a wallet's duels, or the
 * ones waiting on a crank, with a memcmp filter. `taunt` is the only variable
 * length field and goes last, where it cannot shift anything. */
#[account]
#[derive(InitSpace)]
pub struct Duel {
    pub creator: Pubkey,
    /// Default until someone accepts.
    pub opponent: Pubkey,
    pub status: u8,
    pub outcome: u8,
    pub seed: u64,
    /// Default means anyone holding the link may accept.
    pub invitee: Pubkey,
    pub winner: Pubkey,
    pub creator_mint: Pubkey,
    pub opponent_mint: Pubkey,
    pub creator_token_program: Pubkey,
    pub opponent_token_program: Pubkey,
    pub creator_feed: [u8; 32],
    pub opponent_feed: [u8; 32],
    pub creator_source: u8,
    pub opponent_source: u8,
    /// The oracle key a signed side's prices must come from, copied from the
    /// config at creation so rotating the key cannot reach a duel in flight.
    /// Default when both sides are Pyth.
    pub oracle: Pubkey,
    pub creator_amount: u64,
    pub opponent_amount: u64,
    /// Non-zero: the duel runs this long from its start price. Zero: it ends
    /// at the fixed `end_ts` chosen at creation.
    pub duration_secs: i64,
    pub end_ts: i64,
    pub expires_ts: i64,
    pub created_ts: i64,
    pub accepted_ts: i64,
    pub start_ts: i64,
    pub creator_start: PricePoint,
    pub opponent_start: PricePoint,
    pub creator_end: PricePoint,
    pub opponent_end: PricePoint,
    pub bump: u8,
    #[max_len(MAX_TAUNT_LEN)]
    pub taunt: String,
}

impl Duel {
    pub fn seed_bytes(&self) -> [u8; 8] {
        self.seed.to_le_bytes()
    }
}
