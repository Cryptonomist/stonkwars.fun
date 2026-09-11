# Stocklana: submission package

Everything the form asks for, in one place. Hackathon: Stocklana, "something
innovative with stocks on Solana", Sept 11–18, 2026, submissions close at the
closing bell on the 18th. Main track only; judges score 1–10.

## Names and links

| Field | Value |
|---|---|
| Project | **Stonk Wars** (`stonkwars.fun`) |
| One-liner | Your stock vs theirs. Loser gets cooked. |
| Live demo | https://stonkwars.fun (Solana devnet, real Pyth prices) |
| Program (devnet) | `Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D` |
| Repository | https://github.com/Cryptonomist/stonkwars.fun (private today; see Decisions) |
| Category | Consumer · social · tokenized equities |

## Short description (about 280 characters)

Stonk Wars is 1v1 stock fights on Solana. Stake tokenized shares of the stock
you back; a friend stakes theirs. At the bell, the bigger percentage move takes
both stakes, paid in shares. The unique first Pyth price after each boundary
decides it. No oracle key, no referee, no house.

## Long description

**The problem.** Every group chat has the argument: *NVDA eats TSLA this week.*
There has never been a way to settle it. A brokerage cannot hold a bet between
two friends, a sportsbook will not take one on a stock, and a prediction market
needs a market maker and an order book for a two-person grudge.

**What Stonk Wars does.** Tokenized stocks make it one transaction. The
challenger stakes shares of the stock they back and names the stock it beats;
whoever takes the fight stakes the same dollar value of that one. The round
runs from the first Pyth price after the accept to the first Pyth price after
the bell. The stock with the bigger percentage move takes both stakes, paid out
as shares. Only tokenized stocks make that possible: nobody hands a friend
"my Tesla shares" at a brokerage.

**Why nobody can rig it.** Prices are Pyth updates verified on Solana against
Wormhole guardian signatures. Pyth prints several times a second, so the
program accepts only the unique first price at or after each boundary, using
the previous-publish-time field every Pyth update carries; the same rule as
Pyth's own `parsePriceFeedUpdatesUnique`. The winner is decided by
cross-multiplying integer prices, so nothing rounds. Starting and settling are
permissionless. Stakes sit in token accounts owned by the fight's PDA and leave
by exactly three named paths. There is no admin withdrawal.

**Built for the trenches.** A fight link unfurls on X as a VS card and, for
wallet users, as a Blink they can take the fight from without leaving their
feed. Results post themselves: the loser's card says COOKED. On devnet a guest
wallet and a faucet put a stranger in a fight within a minute, with no
extension and no SOL.

## What was built in the window (Sept 11–18)

All of it. The duel program, its unit tests and LiteSVM suite, the Next.js app
and brand, the settler, the Blink, the share cards, the devnet deployment.
Wallet plumbing (the React 19 connect button, phone wallet hand-off, honest
transaction confirmation) is carried over from the same author's Commish.

## Numbers

- 10 program instructions, 3 ways for a stake to leave escrow
- 20 Rust unit tests · 22 LiteSVM tests against the built binary · 10 web tests
- 14 stocks and ETFs, each registered next to its Pyth feed
- 1 transaction to open a fight, 1 to take it, 0 to settle it yourself if you
  would rather wait for the settler

## Pitch video: 3 minutes

1. **0:00–0:15.** A group chat screenshot: "NVDA eats TSLA this week." "Bet."
   Cut to the landing page. "There has never been a way to actually settle that."
2. **0:15–0:45.** Pick a fight: NVDA vs TSLA, $25 each, 15 minutes, the taunt.
   One signature. The share panel. Post on X: show the card unfurl.
3. **0:45–1:15.** Second phone: open the link, guest wallet, get test stocks,
   take it. The page flips to ROUND LIVE: health bars, the clock, real moves.
4. **1:15–1:45.** "Who decides who won? Nobody." The proof table: the first Pyth
   price at or after each boundary, the program refusing any other.
5. **1:45–2:30.** The bell. Settled. The winner's shares arrive, both stakes.
   The loser's card: COOKED. Post the result.
6. **2:30–3:00.** The Blink: take a fight from inside X. Close on the line:
   "Your stock vs theirs. Loser gets cooked. stonkwars.fun"

Record a 5-minute round live during market hours, so the moves are real.

## Technical video: 5 minutes

1. **The one price** (`programs/duel/src/pyth.rs`): the PriceUpdateV2 layout,
   the owner and Full-verification checks, `prev_publish_time < boundary <=
   publish_time`, and why it makes settlement unambiguous.
2. **The outcome** (`outcome.rs`): cross-multiplication, exponent alignment, the
   dollar-vs-percent test.
3. **The escrow** (`lib.rs`): the three exits, init_if_needed against ATA
   griefing, the balance-delta check that turns a fee-on-transfer mint into a
   failed stake, the Token-2022 extension screen.
4. **The tests**: `cargo test -p duel`, then `npm test` against the binary.
5. **The app**: stake sizing in integers, the settler and `/api/crank`, the
   Blink's POST built from the same client code, the guest wallet.

## Decisions the owner has to make before submitting

1. **Repository visibility.** Public, or reviewer access for the judges. The
   code carries no secrets (`.env*`, `keys/` and program keypairs are ignored).
2. **Team line.** Solo founder; the X handle to list.
3. **How AI was used.** Say it plainly: built with Claude Code as the pair, the
   owner directing, testing and holding every key.
