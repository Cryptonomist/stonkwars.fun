# Platform fee

A share of the loser's stake, paid to a treasury when a fight settles. Built
in and set to **0**; nothing is charged until an admin raises it.

## What the program guarantees

- **Capped.** `MAX_FEE_BPS = 500` (5%) is a constant in the program. No admin
  key can set more.
- **No surprise raises.** A raise reaches only fights created at least 7 days
  after it is set. A cut reaches every fight at once, live ones included.
- **Only winners pay, only on what they take.** The fee comes out of the
  loser's stake. Ties, refunds and cancels are never charged.
- **A payout can never be held up by the fee.** The fee accounts are optional
  remaining accounts on `settle_duel`. If they are missing, wrong, or the
  treasury's token account is frozen or carries an extension that could refuse
  a credit, the fee is skipped and the winner is paid in full.
- **Its own account.** Settings live in a `FeeConfig` PDA (seed `"fee"`), so no
  existing account changed layout and no migration was needed.

Code: `programs/duel/src/fee.rs` (rules and unit tests), `settle_duel` and
`take_fee` in `programs/duel/src/lib.rs`, LiteSVM tests under
"platform fee" in `tests/duel.ts`.

## How a rate is chosen

`FeeConfig` holds `fee_bps` for fights created at or after `from_ts`, and
`prior_bps` as the most an older fight pays. Folding a change into those can
only lower what an existing fight pays, never raise it:

| Change | Result |
|---|---|
| Cut to X | `fee_bps = X`, `prior_bps = min(prior, X)`, `from_ts` unchanged: everyone pays at most X now |
| Raise to X | `fee_bps = X`, `prior_bps = min(prior, old fee)`, `from_ts = now + 7 days` |

A raise shortly after an earlier raise can undercharge fights created between
the two (they fall back to the older, lower ceiling). That errs toward players.

## Settling with the fee

`src/lib/duel.ts` `feeAccountsFor` returns nothing when a fight's rate is 0, so
at 0 a settle transaction is byte-for-byte what it was. When the rate is above
0 it passes the fee config and the treasury's account for both mints (the
program picks the loser's).

Settle transactions are near Solana's 1,232-byte limit (a signed-signed settle
measured 1,148 bytes). `settleWithFee` in `src/lib/crankTx.ts` measures the
transaction with the fee accounts and rebuilds it without them if it would not
fit, so the fee can cost revenue but never a settlement. **Before switching the
fee on for real, give settle transactions an address lookup table** (token
programs, ATA program, system program, instructions sysvar, fee config and the
treasury accounts) so the fee accounts always fit.

## Turning it on

1. Legal review first (see below).
2. Pick the treasury wallet (a multisig on mainnet).
3. `DEVNET=1 npx tsx scripts/set-fee.ts 250 <TREASURY> --accounts` sets 2.5%
   from a week out and opens the treasury's token account for every stakeable
   stock. `scripts/set-fee.ts show` prints the schedule.
4. The ticket and the take panel say the fee (`src/components/FeeNote.tsx`)
   as soon as a fight's rate is above 0.
5. Fees arrive as stock tokens in the treasury's accounts. Sweep them to USDC
   on a schedule if that is the preferred treasury asset.

On mainnet the script runs only with `MAINNET=1` and `CONFIRM_FEE=<bps>`, and
is run by whoever holds the admin key.

## Before charging real money

A platform that takes a cut of head-to-head stakes on stock moves can be
treated as commercial gambling in many places, or as an unregistered swap or
derivative by US regulators, and tokenized stocks are generally not offered to
US persons. Get counsel, geofence, and publish terms before enabling a fee on
mainnet.
