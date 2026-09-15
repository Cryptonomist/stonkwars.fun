use anchor_lang::prelude::*;

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_ASSET: &[u8] = b"asset";
pub const SEED_DUEL: &[u8] = b"duel";
pub const SEED_PROFILE: &[u8] = b"profile";
pub const SEED_XCLAIM: &[u8] = b"xclaim";
pub const SEED_FEE: &[u8] = b"fee";

/* THE PLATFORM FEE, AND ITS LIMITS.
 *
 * A share of the loser's stake, taken at settlement (see `fee.rs`). The cap is
 * in the program, not the config: no admin, and no stolen admin key, can set a
 * fee above it. A raise reaches only duels created at least a week after it is
 * announced, so nobody is charged a rate they did not see when they signed. */
pub const MAX_FEE_BPS: u16 = 500;
pub const FEE_NOTICE_SECS: i64 = 7 * 86_400;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// An X handle is at most 15 characters, each of them `[A-Za-z0-9_]`.
pub const MAX_HANDLE_LEN: usize = 15;

/// The Pyth Solana Receiver, at this address on mainnet and devnet alike. It
/// writes a price update only after checking the Wormhole guardian signatures
/// over it, so the owner check on an update account is what makes the price
/// believable. See `pyth.rs`.
pub const PYTH_RECEIVER: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

pub const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Solana's native Ed25519 signature-verification program, and the sysvar
/// through which a program can read the other instructions in its transaction.
pub const ED25519_PROGRAM: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");

/// What a signed quote's message starts with, so a signature over anything
/// else, by the same key, can never be read as a price.
pub const QUOTE_PREFIX: &[u8; 18] = b"STONKWARS:PRICE:v1";

/// How long after a boundary a signed quote may have been observed. The
/// oracle samples the market when the crank runs; a minute-a-minute cron can
/// be up to a minute late, and this leaves room for one retry.
pub const MAX_QUOTE_LAG_SECS: i64 = 120;

/// Shortest duel, measured from the start price to the end boundary. A minute
/// is enough to play a round in a demo and short enough to be a real risk.
pub const MIN_DUEL_SECS: i64 = 60;

/// Longest duel: a month of trading.
pub const MAX_DUEL_SECS: i64 = 31 * 86_400;

/// How long a challenge may wait for someone to take it.
pub const MAX_OPEN_SECS: i64 = 30 * 86_400;

/* THE START IS A FEW SECONDS AFTER THE ACCEPT, NOT AT IT.
 *
 * The accepter chooses the moment to accept, and could otherwise accept the
 * instant after a price they like has printed. The start price is the first
 * Pyth price at or after `accepted_ts + START_DELAY_SECS`: a price that did not
 * exist when they signed. Two seconds covers the gap between the cluster clock
 * and wall time without making anybody wait. */
pub const START_DELAY_SECS: i64 = 2;

/// If the first price after the accept is further off than this, the market
/// was shut for longer than any normal weekend and the duel is void.
pub const MAX_START_WAIT_SECS: i64 = 5 * 86_400;

/* THE DEADMAN, FOR A DUEL NOBODY CAN FINISH.
 *
 * A duel whose start or end price never arrives (a delisted stock, a feed that
 * stops) would otherwise hold both stakes forever. After this long anyone can
 * refund both sides. It is a week so that no real market closure, long weekend
 * included, can race a legitimate settlement. */
pub const STALL_REFUND_SECS: i64 = 7 * 86_400;

pub const MAX_TAUNT_LEN: usize = 80;
pub const MAX_SYMBOL_LEN: usize = 12;
