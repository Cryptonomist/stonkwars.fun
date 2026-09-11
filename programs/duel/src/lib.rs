#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

//! # Duel
//!
//! Two people, two stocks, one bell. Each side stakes tokenized shares of the
//! stock they back; whichever stock moves more, in percent, between the start
//! price and the end price wins its backer both stakes.
//!
//! ## The one idea
//!
//! Nobody decides who won. The start and end prices are Pyth prices, posted by
//! anyone and accepted only if they are the unique first price at or after the
//! boundary (see `pyth.rs`). The comparison is exact integer arithmetic (see
//! `outcome.rs`). A settler can choose when to settle, never how.
//!
//! ## Where the shares can go
//!
//! Stakes sit in associated token accounts owned by the duel PDA. They leave by
//! exactly three paths, each of which names its own recipient:
//!
//! * `cancel_duel`: the creator's stake back to the creator, before anyone
//!   accepts;
//! * `settle_duel`: both stakes to the winner, or each back to its owner on an
//!   exact tie;
//! * `refund_duel`: each stake back to its owner, when a duel is void or has
//!   stalled for a week.
//!
//! There is no admin withdrawal and no sweep. The admin can register stocks,
//! switch one off for new duels and pause new duels. Nothing it can do touches
//! a stake in escrow.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

pub mod constants;
pub mod errors;
pub mod events;
pub mod mint_check;
pub mod outcome;
pub mod pyth;
pub mod state;

use constants::*;
use errors::DuelError;
use events::*;
use outcome::{Px, Winner};
use state::*;

declare_id!("Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D");

#[program]
pub mod duel {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn register_asset(
        ctx: Context<RegisterAsset>,
        feed_id: [u8; 32],
        symbol: String,
    ) -> Result<()> {
        require!(symbol.len() <= MAX_SYMBOL_LEN, DuelError::SymbolTooLong);
        mint_check::assert_escrowable(&ctx.accounts.mint.to_account_info())?;

        let a = &mut ctx.accounts.asset;
        a.mint = ctx.accounts.mint.key();
        a.token_program = ctx.accounts.token_program.key();
        a.feed_id = feed_id;
        a.symbol = symbol.clone();
        a.decimals = ctx.accounts.mint.decimals;
        a.enabled = true;
        a.bump = ctx.bumps.asset;

        emit!(AssetRegistered {
            mint: a.mint,
            feed_id,
            symbol,
        });
        Ok(())
    }

    /// Re-point an asset's feed or switch it off. Duels already created keep
    /// the feed they copied; this only changes what new duels get.
    pub fn set_asset(ctx: Context<SetAsset>, feed_id: [u8; 32], enabled: bool) -> Result<()> {
        let a = &mut ctx.accounts.asset;
        a.feed_id = feed_id;
        a.enabled = enabled;
        emit!(AssetUpdated {
            mint: a.mint,
            feed_id,
            enabled,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A duel
    // ─────────────────────────────────────────────────────────────────────────

    /// Open a challenge and escrow the creator's stake.
    ///
    /// The terms are all fixed here, both stakes included: the page sizes them
    /// to equal dollars, and whoever accepts takes exactly these terms or
    /// leaves them. `duration_secs` and `end_ts` are the two ways to end a
    /// duel; exactly one must be set.
    pub fn create_duel(
        ctx: Context<CreateDuel>,
        seed: u64,
        creator_amount: u64,
        opponent_amount: u64,
        duration_secs: i64,
        end_ts: i64,
        expires_ts: i64,
        invitee: Pubkey,
        taunt: String,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, DuelError::Paused);
        require!(creator_amount > 0 && opponent_amount > 0, DuelError::ZeroStake);
        require!(taunt.len() <= MAX_TAUNT_LEN, DuelError::TauntTooLong);
        require!((duration_secs > 0) != (end_ts > 0), DuelError::BadEndRule);
        require!(
            expires_ts > now && expires_ts - now <= MAX_OPEN_SECS,
            DuelError::BadExpiry
        );
        if duration_secs > 0 {
            require!(
                (MIN_DUEL_SECS..=MAX_DUEL_SECS).contains(&duration_secs),
                DuelError::BadDuration
            );
        } else {
            require!(
                (MIN_DUEL_SECS..=MAX_DUEL_SECS).contains(&(end_ts - now)),
                DuelError::BadDuration
            );
            // Whoever accepts last must still get a real duel.
            require!(expires_ts <= end_ts - MIN_DUEL_SECS, DuelError::BadExpiry);
        }

        stake(
            &ctx.accounts.creator_token_program,
            &ctx.accounts.creator_mint,
            &ctx.accounts.creator_source,
            &mut ctx.accounts.creator_escrow,
            ctx.accounts.creator.to_account_info(),
            creator_amount,
        )?;

        let d = &mut ctx.accounts.duel;
        d.creator = ctx.accounts.creator.key();
        d.opponent = Pubkey::default();
        d.status = STATUS_OPEN;
        d.outcome = OUTCOME_NONE;
        d.seed = seed;
        d.invitee = invitee;
        d.winner = Pubkey::default();
        d.creator_mint = ctx.accounts.creator_mint.key();
        d.opponent_mint = ctx.accounts.opponent_mint.key();
        d.creator_token_program = ctx.accounts.creator_token_program.key();
        d.opponent_token_program = ctx.accounts.opponent_token_program.key();
        d.creator_feed = ctx.accounts.creator_asset.feed_id;
        d.opponent_feed = ctx.accounts.opponent_asset.feed_id;
        d.creator_amount = creator_amount;
        d.opponent_amount = opponent_amount;
        d.duration_secs = duration_secs;
        d.end_ts = end_ts;
        d.expires_ts = expires_ts;
        d.created_ts = now;
        d.accepted_ts = 0;
        d.start_ts = 0;
        d.bump = ctx.bumps.duel;
        d.taunt = taunt;

        emit!(DuelCreated {
            duel: d.key(),
            creator: d.creator,
            creator_mint: d.creator_mint,
            opponent_mint: d.opponent_mint,
            creator_amount,
            opponent_amount,
            duration_secs,
            end_ts,
            expires_ts,
            invitee,
        });
        Ok(())
    }

    /// Take a challenge back. The creator can do it any time before someone
    /// accepts; after the challenge expires anyone can, and the stake still
    /// goes to the creator.
    pub fn cancel_duel(ctx: Context<CancelDuel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let d = &ctx.accounts.duel;
        require_eq!(d.status, STATUS_OPEN, DuelError::NotOpen);
        if ctx.accounts.caller.key() != d.creator {
            require!(now >= d.expires_ts, DuelError::NotCreator);
        }

        let creator = d.creator;
        let seed = d.seed_bytes();
        let bump = [d.bump];
        let seeds: &[&[u8]] = &[SEED_DUEL, creator.as_ref(), &seed, &bump];

        release(
            &ctx.accounts.creator_token_program,
            &ctx.accounts.creator_mint,
            &ctx.accounts.creator_escrow,
            ctx.accounts.creator_refund.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.duel.to_account_info(),
            &[seeds],
        )?;

        emit!(DuelCancelled {
            duel: ctx.accounts.duel.key(),
            by: ctx.accounts.caller.key(),
        });
        // The duel account itself is closed to the creator by `close = creator`.
        Ok(())
    }

    /// Take the other side: escrow the opponent's stake on the creator's terms.
    pub fn accept_duel(ctx: Context<AcceptDuel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, DuelError::Paused);
        let d = &ctx.accounts.duel;
        require_eq!(d.status, STATUS_OPEN, DuelError::NotOpen);
        require!(now < d.expires_ts, DuelError::Expired);
        let opponent = ctx.accounts.opponent.key();
        require_keys_neq!(opponent, d.creator, DuelError::SelfDuel);
        if d.invitee != Pubkey::default() {
            require_keys_eq!(opponent, d.invitee, DuelError::NotInvitee);
        }
        let amount = d.opponent_amount;

        stake(
            &ctx.accounts.opponent_token_program,
            &ctx.accounts.opponent_mint,
            &ctx.accounts.opponent_source,
            &mut ctx.accounts.opponent_escrow,
            ctx.accounts.opponent.to_account_info(),
            amount,
        )?;

        let d = &mut ctx.accounts.duel;
        d.opponent = opponent;
        d.accepted_ts = now;
        d.status = STATUS_ACCEPTED;

        emit!(DuelAccepted {
            duel: d.key(),
            opponent,
            accepted_ts: now,
        });
        Ok(())
    }

    /// Lock the start prices. Permissionless: the prices prove themselves.
    pub fn start_duel(ctx: Context<StartDuel>) -> Result<()> {
        let d = &mut ctx.accounts.duel;
        require_eq!(d.status, STATUS_ACCEPTED, DuelError::NotAccepted);

        let boundary = d
            .accepted_ts
            .checked_add(START_DELAY_SECS)
            .ok_or(DuelError::MathOverflow)?;
        let c = pyth::read_boundary_price(&ctx.accounts.creator_price, &d.creator_feed, boundary)?;
        let o =
            pyth::read_boundary_price(&ctx.accounts.opponent_price, &d.opponent_feed, boundary)?;

        let start_ts = c.publish_time.max(o.publish_time);
        if d.duration_secs > 0 {
            d.end_ts = start_ts
                .checked_add(d.duration_secs)
                .ok_or(DuelError::MathOverflow)?;
        }
        d.start_ts = start_ts;
        d.creator_start = PricePoint {
            price: c.price,
            expo: c.expo,
            publish_time: c.publish_time,
        };
        d.opponent_start = PricePoint {
            price: o.price,
            expo: o.expo,
            publish_time: o.publish_time,
        };

        /* A duel can be accepted while the market is shut, and then its first
         * price is whenever the market reopens. That is fine for a duel to
         * Friday's close accepted on Saturday; it is not fine if the reopening
         * is past the end, or so late the stakes sat idle for most of a week.
         * Either way the duel is void, and both stakes go back. */
        let void_reason = if start_ts - boundary > MAX_START_WAIT_SECS {
            Some(VOID_START_TOO_LATE)
        } else if d.end_ts - start_ts < MIN_DUEL_SECS {
            Some(VOID_TOO_SHORT)
        } else {
            None
        };

        match void_reason {
            Some(reason) => {
                d.status = STATUS_VOID;
                d.outcome = OUTCOME_VOID;
                emit!(DuelVoided {
                    duel: d.key(),
                    reason,
                });
            }
            None => {
                d.status = STATUS_LIVE;
                emit!(DuelStarted {
                    duel: d.key(),
                    start_ts,
                    end_ts: d.end_ts,
                    creator_price: c.price,
                    creator_expo: c.expo,
                    opponent_price: o.price,
                    opponent_expo: o.expo,
                });
            }
        }
        Ok(())
    }

    /// Post the end prices and pay the winner. Permissionless.
    pub fn settle_duel(ctx: Context<SettleDuel>) -> Result<()> {
        let d = &ctx.accounts.duel;
        require_eq!(d.status, STATUS_LIVE, DuelError::NotLive);

        let c = pyth::read_boundary_price(&ctx.accounts.creator_price, &d.creator_feed, d.end_ts)?;
        let o = pyth::read_boundary_price(&ctx.accounts.opponent_price, &d.opponent_feed, d.end_ts)?;
        let c_end = Px {
            price: c.price,
            expo: c.expo,
        };
        let o_end = Px {
            price: o.price,
            expo: o.expo,
        };

        let winner = outcome::decide(d.creator_start.into(), c_end, d.opponent_start.into(), o_end)?;
        let creator_return_bps = outcome::return_bps(d.creator_start.into(), c_end)?;
        let opponent_return_bps = outcome::return_bps(d.opponent_start.into(), o_end)?;

        let creator = d.creator;
        let opponent = d.opponent;
        let seed = d.seed_bytes();
        let bump = [d.bump];
        let seeds: &[&[u8]] = &[SEED_DUEL, creator.as_ref(), &seed, &bump];

        let (outcome_code, winner_key, creator_stake_to, opponent_stake_to) = match winner {
            Winner::Creator => (
                OUTCOME_CREATOR,
                creator,
                ctx.accounts.creator_creator_ata.to_account_info(),
                ctx.accounts.creator_opponent_ata.to_account_info(),
            ),
            Winner::Opponent => (
                OUTCOME_OPPONENT,
                opponent,
                ctx.accounts.opponent_creator_ata.to_account_info(),
                ctx.accounts.opponent_opponent_ata.to_account_info(),
            ),
            Winner::Tie => (
                OUTCOME_TIE,
                Pubkey::default(),
                ctx.accounts.creator_creator_ata.to_account_info(),
                ctx.accounts.opponent_opponent_ata.to_account_info(),
            ),
        };

        {
            let d = &mut ctx.accounts.duel;
            d.creator_end = PricePoint {
                price: c.price,
                expo: c.expo,
                publish_time: c.publish_time,
            };
            d.opponent_end = PricePoint {
                price: o.price,
                expo: o.expo,
                publish_time: o.publish_time,
            };
            d.outcome = outcome_code;
            d.winner = winner_key;
            d.status = if winner == Winner::Tie {
                STATUS_REFUNDED
            } else {
                STATUS_SETTLED
            };
        }

        let duel_info = ctx.accounts.duel.to_account_info();
        release(
            &ctx.accounts.creator_token_program,
            &ctx.accounts.creator_mint,
            &ctx.accounts.creator_escrow,
            creator_stake_to,
            ctx.accounts.creator.to_account_info(),
            duel_info.clone(),
            &[seeds],
        )?;
        release(
            &ctx.accounts.opponent_token_program,
            &ctx.accounts.opponent_mint,
            &ctx.accounts.opponent_escrow,
            opponent_stake_to,
            ctx.accounts.opponent.to_account_info(),
            duel_info,
            &[seeds],
        )?;

        emit!(DuelSettled {
            duel: ctx.accounts.duel.key(),
            outcome: outcome_code,
            winner: winner_key,
            creator_return_bps,
            opponent_return_bps,
        });
        Ok(())
    }

    /// Both stakes back to their owners: for a void duel at once, and for a
    /// duel stuck waiting on a price a week after it should have moved.
    pub fn refund_duel(ctx: Context<RefundDuel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let d = &ctx.accounts.duel;
        let refundable = match d.status {
            STATUS_VOID => true,
            STATUS_ACCEPTED => now >= d.accepted_ts.saturating_add(STALL_REFUND_SECS),
            STATUS_LIVE => now >= d.end_ts.saturating_add(STALL_REFUND_SECS),
            _ => false,
        };
        require!(refundable, DuelError::NotRefundable);

        let creator = d.creator;
        let seed = d.seed_bytes();
        let bump = [d.bump];
        let seeds: &[&[u8]] = &[SEED_DUEL, creator.as_ref(), &seed, &bump];

        {
            let d = &mut ctx.accounts.duel;
            d.status = STATUS_REFUNDED;
            if d.outcome == OUTCOME_NONE {
                d.outcome = OUTCOME_VOID;
            }
        }

        let duel_info = ctx.accounts.duel.to_account_info();
        release(
            &ctx.accounts.creator_token_program,
            &ctx.accounts.creator_mint,
            &ctx.accounts.creator_escrow,
            ctx.accounts.creator_creator_ata.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            duel_info.clone(),
            &[seeds],
        )?;
        release(
            &ctx.accounts.opponent_token_program,
            &ctx.accounts.opponent_mint,
            &ctx.accounts.opponent_escrow,
            ctx.accounts.opponent_opponent_ata.to_account_info(),
            ctx.accounts.opponent.to_account_info(),
            duel_info,
            &[seeds],
        )?;

        emit!(DuelRefunded {
            duel: ctx.accounts.duel.key(),
        });
        Ok(())
    }

    /// Reclaim a finished duel's rent. The record goes with it, which is the
    /// creator's call to make.
    pub fn close_duel(ctx: Context<CloseDuel>) -> Result<()> {
        let status = ctx.accounts.duel.status;
        require!(
            status == STATUS_SETTLED || status == STATUS_REFUNDED,
            DuelError::NotFinished
        );
        Ok(())
    }
}

/// Move a stake into escrow and check the escrow received all of it. The check
/// is on the escrow's balance delta, so it holds whether or not somebody sent
/// tokens to the escrow address first, and it is what turns a fee-on-transfer
/// mint into a failed duel rather than a short one.
fn stake<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    escrow: &mut Box<InterfaceAccount<'info, TokenAccount>>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let before = escrow.amount;
    transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: escrow.to_account_info(),
                authority,
            },
        ),
        amount,
        mint.decimals,
    )?;
    escrow.reload()?;
    let received = escrow
        .amount
        .checked_sub(before)
        .ok_or(DuelError::MathOverflow)?;
    require!(received == amount, DuelError::ShortTransfer);
    Ok(())
}

/// Empty an escrow to `to` and close it, rent to `rent_to`. The whole balance
/// moves, not the recorded stake, so an escrow can always be closed.
fn release<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    to: AccountInfo<'info>,
    rent_to: AccountInfo<'info>,
    duel: AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    let amount = escrow.amount;
    if amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                token_program.key(),
                TransferChecked {
                    from: escrow.to_account_info(),
                    mint: mint.to_account_info(),
                    to,
                    authority: duel.clone(),
                },
                signer,
            ),
            amount,
            mint.decimals,
        )?;
    }
    close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: escrow.to_account_info(),
            destination: rent_to,
            authority: duel,
        },
        signer,
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterAsset<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Asset::INIT_SPACE,
        seeds = [SEED_ASSET, mint.key().as_ref()],
        bump
    )]
    pub asset: Account<'info, Asset>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAsset<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_ASSET, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, Asset>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateDuel<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [SEED_ASSET, creator_mint.key().as_ref()],
        bump = creator_asset.bump,
        constraint = creator_asset.enabled @ DuelError::AssetDisabled
    )]
    pub creator_asset: Box<Account<'info, Asset>>,
    #[account(
        seeds = [SEED_ASSET, opponent_mint.key().as_ref()],
        bump = opponent_asset.bump,
        constraint = opponent_asset.enabled @ DuelError::AssetDisabled
    )]
    pub opponent_asset: Box<Account<'info, Asset>>,
    #[account(mint::token_program = creator_token_program)]
    pub creator_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mint::token_program = opponent_token_program,
        constraint = opponent_mint.key() != creator_mint.key() @ DuelError::SameAsset
    )]
    pub opponent_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Duel::INIT_SPACE,
        seeds = [SEED_DUEL, creator.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    /* The escrow IS the duel's associated token account: derived, never passed
     * in. `init_if_needed` rather than `init` because anybody can create an ATA
     * for any owner, and a stranger who created this one first would otherwise
     * make the duel impossible to open. `stake` checks the balance delta, so a
     * pre-funded escrow changes nothing. */
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = creator_mint,
        associated_token::authority = duel,
        associated_token::token_program = creator_token_program
    )]
    pub creator_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = creator_mint,
        token::authority = creator,
        token::token_program = creator_token_program
    )]
    pub creator_source: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Where the creator would receive the other stake. Made now, on the
    /// creator's rent, so a settlement never has to pay for it.
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = opponent_mint,
        associated_token::authority = creator,
        associated_token::token_program = opponent_token_program
    )]
    pub creator_winnings: Box<InterfaceAccount<'info, TokenAccount>>,
    pub creator_token_program: Interface<'info, TokenInterface>,
    pub opponent_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelDuel<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    /// CHECK: pinned to the duel's creator; receives the stake and all rent.
    #[account(mut, address = duel.creator)]
    pub creator: UncheckedAccount<'info>,
    #[account(address = duel.creator_mint)]
    pub creator_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = creator_mint,
        associated_token::authority = duel,
        associated_token::token_program = creator_token_program
    )]
    pub creator_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = creator_mint,
        associated_token::authority = creator,
        associated_token::token_program = creator_token_program
    )]
    pub creator_refund: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = duel.creator_token_program)]
    pub creator_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptDuel<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    #[account(address = duel.creator_mint)]
    pub creator_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = duel.opponent_mint)]
    pub opponent_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = opponent,
        associated_token::mint = opponent_mint,
        associated_token::authority = duel,
        associated_token::token_program = opponent_token_program
    )]
    pub opponent_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = opponent_mint,
        token::authority = opponent,
        token::token_program = opponent_token_program
    )]
    pub opponent_source: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Where the opponent would receive the creator's stake.
    #[account(
        init_if_needed,
        payer = opponent,
        associated_token::mint = creator_mint,
        associated_token::authority = opponent,
        associated_token::token_program = creator_token_program
    )]
    pub opponent_winnings: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = duel.creator_token_program)]
    pub creator_token_program: Interface<'info, TokenInterface>,
    #[account(address = duel.opponent_token_program)]
    pub opponent_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartDuel<'info> {
    #[account(
        mut,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    /// CHECK: verified in `pyth::read_boundary_price`: receiver-owned, a fully
    /// verified PriceUpdateV2, the creator's feed, the first price at or after
    /// the start boundary.
    pub creator_price: UncheckedAccount<'info>,
    /// CHECK: as `creator_price`, for the opponent's feed.
    pub opponent_price: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleDuel<'info> {
    /// Anyone. Pays the transaction, and the rent of any payout account a
    /// player has closed since the duel began.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    /// CHECK: pinned to the duel; receives the creator escrow's rent.
    #[account(mut, address = duel.creator)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: pinned to the duel; receives the opponent escrow's rent.
    #[account(mut, address = duel.opponent)]
    pub opponent: UncheckedAccount<'info>,
    #[account(address = duel.creator_mint)]
    pub creator_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = duel.opponent_mint)]
    pub opponent_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = creator_mint,
        associated_token::authority = duel,
        associated_token::token_program = creator_token_program
    )]
    pub creator_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = opponent_mint,
        associated_token::authority = duel,
        associated_token::token_program = opponent_token_program
    )]
    pub opponent_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /* All four payout accounts are passed, so a settler does not need to know
     * the result before sending, and cannot route a stake anywhere but these
     * four: each is derived from a player the duel names. */
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = creator_mint,
        associated_token::authority = creator,
        associated_token::token_program = creator_token_program
    )]
    pub creator_creator_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = opponent_mint,
        associated_token::authority = creator,
        associated_token::token_program = opponent_token_program
    )]
    pub creator_opponent_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = creator_mint,
        associated_token::authority = opponent,
        associated_token::token_program = creator_token_program
    )]
    pub opponent_creator_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = opponent_mint,
        associated_token::authority = opponent,
        associated_token::token_program = opponent_token_program
    )]
    pub opponent_opponent_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: verified in `pyth::read_boundary_price` against the end boundary.
    pub creator_price: UncheckedAccount<'info>,
    /// CHECK: as `creator_price`, for the opponent's feed.
    pub opponent_price: UncheckedAccount<'info>,
    #[account(address = duel.creator_token_program)]
    pub creator_token_program: Interface<'info, TokenInterface>,
    #[account(address = duel.opponent_token_program)]
    pub opponent_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundDuel<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
    /// CHECK: pinned to the duel; receives the creator escrow's rent.
    #[account(mut, address = duel.creator)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: pinned to the duel; receives the opponent escrow's rent.
    #[account(mut, address = duel.opponent)]
    pub opponent: UncheckedAccount<'info>,
    #[account(address = duel.creator_mint)]
    pub creator_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = duel.opponent_mint)]
    pub opponent_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = creator_mint,
        associated_token::authority = duel,
        associated_token::token_program = creator_token_program
    )]
    pub creator_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = opponent_mint,
        associated_token::authority = duel,
        associated_token::token_program = opponent_token_program
    )]
    pub opponent_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = creator_mint,
        associated_token::authority = creator,
        associated_token::token_program = creator_token_program
    )]
    pub creator_creator_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = opponent_mint,
        associated_token::authority = opponent,
        associated_token::token_program = opponent_token_program
    )]
    pub opponent_opponent_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = duel.creator_token_program)]
    pub creator_token_program: Interface<'info, TokenInterface>,
    #[account(address = duel.opponent_token_program)]
    pub opponent_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseDuel<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        close = creator,
        has_one = creator,
        seeds = [SEED_DUEL, duel.creator.as_ref(), &duel.seed_bytes()],
        bump = duel.bump
    )]
    pub duel: Box<Account<'info, Duel>>,
}
