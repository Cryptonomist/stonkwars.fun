# Stocklana: submission package

Everything the form asks for, in one place. Hackathon: Stocklana, "something
innovative with stocks on Solana", Sept 11–18, 2026, submissions close at the
closing bell on the 18th. Main track only; judges score 1–10.

## Names and links

| Field | Value |
|---|---|
| Project | **Stonk Wars** (`stonkwars.fun`) |
| One-liner | Your stock vs theirs. Loser gets cooked. |
| Live demo | https://stonkwars.fun (Solana devnet, real market prices) |
| Program (devnet) | `Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D` |
| Repository | https://github.com/Cryptonomist/stonkwars.fun (private today; see Decisions) |
| Category | Consumer · social · tokenized equities |

## Short description (about 280 characters)

Stonk Wars is 1v1 stock fights on Solana, across every tokenized stock on
Solana (1,033, from xStocks, Ondo and Backpack). Stake shares of the stock you
back; a friend stakes theirs. At the bell, the bigger percentage move takes both
stakes, paid in shares. Signed market prices decide. No referee, no house.

## Long description

**The problem.** Every group chat has the argument: *NVDA eats TSLA this week.*
There has never been a way to settle it. A brokerage cannot hold a bet between
two friends, a sportsbook will not take one on a stock, and a prediction market
needs a market maker and an order book for a two-person grudge.

**What Stonk Wars does.** Tokenized stocks make it one transaction. The
challenger stakes shares of the stock they back and names the stock it beats;
whoever takes the fight stakes the same dollar value of that one. The round
runs from each stock's first price after the accept to its first price after
the bell. The stock with the bigger percentage move takes both stakes, paid out
as shares. Only tokenized stocks make that possible: nobody hands a friend
"my Tesla shares" at a brokerage.

**Every tokenized stock.** We pulled every issuer's token list (xStocks' API,
Ondo's published addresses, Backpack's API, and four more), read each mint's
Token-2022 extensions on chain, and kept what a program can escrow: 1,288
tokens, 1,033 stocks and ETFs, including 80 listed in Hong Kong and London.
Allowlist-only tokens, whose accounts start frozen, are left out and the page
says why.

**Why nobody can rig it.** Each stock is priced by one of two sources, copied
onto every fight. TSLA, QQQ and VOO are Pyth updates verified on Solana against
Wormhole guardian signatures, and the program accepts only the unique first
price at or after each boundary (Pyth's own `parsePriceFeedUpdatesUnique` rule).
Every other stock is priced by the Stonk Wars oracle: the close of the first
one-minute bar at or after the boundary, from completed market data, signed and
checked on chain by Solana's Ed25519 program in the same transaction. The
oracle is trusted about the market for those stocks and says so on every fight;
it cannot touch a stake or reach a fight created before it was named, and every
quote it signs is public. The winner is decided by cross-multiplying integer
prices, so nothing rounds. Starting and settling are permissionless. Stakes sit
in token accounts owned by the fight's PDA and leave by exactly three named
paths. There is no admin withdrawal.

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

- 1,033 stocks and ETFs from 1,288 tokens by 3 issuers; 1,288 of 1,288 pass
  the program's escrow screen, read from mainnet
- 2 price sources per program: Pyth (trustless) and a signed oracle, chosen
  per stock and frozen per fight
- 12 program instructions, 3 ways for a stake to leave escrow
- 26 Rust unit tests · 29 LiteSVM tests against the built binary (real Ed25519
  signatures) · 17 web tests · live end-to-end fights whose every on-chain
  price matched its source
- 1 transaction to open a fight, 1 to take it, 0 to settle it yourself if you
  would rather wait for the settler

## Pitch video: 3 minutes

1. **0:00–0:15.** A group chat screenshot: "NVDA eats TSLA this week." "Bet."
   Cut to the landing page. "There has never been a way to actually settle that."
2. **0:15–0:45.** Pick a fight: NVDA vs TSLA, $25 each, 15 minutes, the taunt.
   One signature. The share panel. Post on X: show the card unfurl.
3. **0:45–1:15.** Second phone: open the link, guest wallet, get test stocks,
   take it. The page flips to ROUND LIVE: health bars, the clock, real moves.
4. **1:15–1:45.** "Who decides who won?" The proof table: each stock's first
   price at or after each boundary, Pyth's or the oracle's signed quote, and
   the program refusing any other. Then the picker: search 1,033 stocks, pick a
   Hong Kong listing against a US one.
5. **1:45–2:30.** The bell. Settled. The winner's shares arrive, both stakes.
   The loser's card: COOKED. Post the result.
6. **2:30–3:00.** The Blink: take a fight from inside X. Close on the line:
   "Your stock vs theirs. Loser gets cooked. stonkwars.fun"

Record a 5-minute round live during market hours, so the moves are real.

## Technical video: 5 minutes

1. **The one price** (`programs/duel/src/pyth.rs`): the PriceUpdateV2 layout,
   the owner and Full-verification checks, `prev_publish_time < boundary <=
   publish_time`, and why it makes settlement unambiguous.
2. **The second source** (`quote.rs`, `src/lib/oracle.ts`): the 78-byte quote,
   Ed25519 introspection through the instructions sysvar and why entries that
   point into other instructions are ignored, prices from completed minute
   bars so asking twice gets the same bytes, the oracle key frozen per fight,
   and why the fight instruction and its quotes must share a transaction.
3. **The outcome** (`outcome.rs`): cross-multiplication, exponent alignment, the
   dollar-vs-percent test.
4. **The escrow** (`lib.rs`): the three exits, init_if_needed against ATA
   griefing, the balance-delta check that turns a fee-on-transfer mint into a
   failed stake, the Token-2022 extension screen, and the 1,288 real mints it
   passes.
5. **The tests**: `cargo test -p duel`, `npm test` against the binary, and
   `scripts/e2e-live.ts`: real BTC (Pyth) and ETH/SOL (oracle) fights on a
   local fork, every price checked against its source.
6. **The app**: the roster build, stake sizing in integers, the settler and
   `/api/crank`, the Blink's POST built from the same client code, the guest
   wallet.

## Decisions the owner has to make before submitting

1. **Repository visibility.** Public, or reviewer access for the judges. The
   code carries no secrets (`.env*`, `keys/` and program keypairs are ignored).
2. **Team line.** Solo founder; the X handle to list.
3. **How AI was used.** Say it plainly: built with Claude Code as the pair, the
   owner directing, testing and holding every key.
