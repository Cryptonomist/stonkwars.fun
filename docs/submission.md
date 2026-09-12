# Stocklana: submission package

Everything the form asks for, in one place. Hackathon: Stocklana, "something
innovative with stocks on Solana", Sept 11–18, 2026, submissions close at the
closing bell on the 18th. Main track only; judges score 1–10.

## Names and links

| Field | Value |
|---|---|
| Project | **Stonk Wars** (`stonkwars.fun`) |
| One-liner | Your stock vs theirs. Winner takes both. |
| Live demo | https://stonkwars.fun (Solana devnet, real market prices) |
| Program (devnet) | `Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D` |
| Oracle (devnet) | `EoFpiFFsSodkwam5bx2zugSgioxmK5CCcxyc3bZCpAzy` |
| Repository | https://github.com/Cryptonomist/stonkwars.fun (private today; see Decisions) |
| Category | Consumer · social · tokenized equities |

## Short description (about 280 characters)

1v1 stock fights on Solana, across all 1,033 tokenized stocks. Stake shares of
the stock you back; somebody stakes theirs. The bigger percentage move by the
bell takes both stakes, paid in shares. 23 of them fight around the clock,
because a share on a chain does not stop when the exchange does.

## Long description

**The problem.** Every group chat has the argument: *NVDA eats TSLA this week.*
There has never been a way to settle it. A brokerage cannot hold a bet between
two friends, a sportsbook will not take one on a stock, and a prediction market
needs a market maker and an order book for a two-person grudge.

**What Stonk Wars does.** Tokenized stocks make it one transaction. The
challenger stakes shares of the stock they back and names the stock it beats;
whoever takes the fight stakes the same dollar value of that one. The stock
with the bigger percentage move takes both stakes, paid out as shares. Only
tokenized stocks make that possible: nobody hands a friend "my Tesla shares" at
a brokerage.

**Fights that do not wait for a bell.** This is the part that could not exist
off chain. A tokenized share keeps trading on Solana when every exchange on
Earth is shut, so for the 23 stocks whose pools are deep enough to read, a
fight runs at midnight on a Sunday. During market hours the price is the
stock's own market, 4am to 8pm New York time, pre-market and after-hours
included. Outside that, it is the token's own recent one-minute closes on a
pinned pool, up to fifteen of them, discarding the highest fifth and the lowest
fifth and averaging the rest.

That trimmed mean is doing real work. A single bought minute lands in the part
that is thrown away and counts for nothing; moving the answer means holding the
price away from fair value across most of the sample while every arbitrageur on
Solana trades against you, which costs far more than any stake in the game. We
tried a median first, which resists a push even harder, and replaced it because
it moves in jumps and declared draws on fights somebody had won. A price that
says nothing happened when something did is the wrong price, however unpushable.

**Every tokenized stock.** We pulled every issuer's token list (xStocks' API,
Ondo's published addresses, Backpack's API, and four more), read each mint's
Token-2022 extensions on chain, and kept what a program can escrow: 1,345
issuer tokens down to 1,033 stocks and ETFs, including 80 listed in Hong Kong
and London. Allowlist-only tokens, whose accounts start frozen, are left out and
the page says why. `scripts/watch-listings.ts` asks the issuers what they
publish today and screens anything new the same way, because a stock listing on
Solana every week is the normal state now.

**Why nobody can rig it.** Each stock is priced by one of two sources, copied
onto every fight at creation. TSLA, QQQ and VOO are Pyth updates verified on
Solana against Wormhole guardian signatures, and the program accepts only the
unique first price at or after each boundary (Pyth's own
`parsePriceFeedUpdatesUnique` rule). Every other stock is priced by the Stonk
Wars oracle: a price signed off chain and checked on chain by Solana's Ed25519
program in the same transaction. The oracle is trusted about the market and the
app says so on every fight that uses it; it cannot touch a stake, cannot reach
a fight created before it was named, and every quote it signs is public in the
transaction that used it. The winner is decided by cross-multiplying integer
prices, so nothing rounds. Starting and settling are permissionless. Stakes sit
in token accounts owned by the fight's own PDA and leave by exactly three named
paths. There is no admin withdrawal, and pausing cannot block a payout.

**Your name on your wins.** Connecting X writes your handle beside your wallet
on chain, and it takes two signatures: yours, proving the wallet, and the
oracle's, which the server adds only after X's own sign-in named the handle.
Neither is worth anything alone, so nobody can hang a stranger's name on their
record or their own name on a stranger's wallet. The leaderboard needs no
database: it reads profiles from the chain like everything else.

**Built for the trenches.** The front page is a board, not a pitch: a live tape,
what is in the ring, what is moving, who is winning. A fight link unfurls on X
as a VS card and, for wallet users, as a Blink they can take the fight from
without leaving their feed. The fight page plays like a fighting game: every
price that arrives lands as a hit, a run of them is a combo, and the bell is a
knockout, all over numbers that are real. A guest wallet and a faucet put a
stranger in a fight within a minute, no extension and no SOL.

## What was built in the window (Sept 11–18)

All of it. The duel program and its tests, the Next.js app and brand, the
oracle and its off-hours pool pricing, the settler, the Blink, the share cards,
X handle linking, the devnet deployment. Wallet plumbing (the React 19 connect
button, phone wallet hand-off, honest transaction confirmation) is carried over
from the same author's Commish.

## Numbers

- **1,033** stocks and ETFs from 1,345 issuer tokens across 7 issuers; 122 ETFs,
  80 listed outside the US. Every mint screened against the program's escrow
  rules, read from mainnet
- **23** fight around the clock, backed by $18.3M of pool liquidity
- **2** price sources, chosen per stock and frozen per fight: Pyth (trustless)
  and a signed oracle (public, checkable, labelled)
- **14** program instructions, **3** ways for a stake to leave escrow, **0**
  admin withdrawals
- **26** Rust unit tests · **37** LiteSVM tests against the built binary, with
  real Ed25519 signatures · **46** web tests · live end-to-end fights whose
  every on-chain price matched its source, asked again independently
- **1** transaction to open a fight, **1** to take it, **0** to settle it
  yourself if you would rather not wait for the settler

## The proof it works unattended

At 05:25 UTC on Saturday 12 September, with every stock exchange on Earth shut,
NVDA fought MSFT on the deployed site. Start prices came from each token's own
Solana pool; the bell came fifteen minutes later; the settler ran from a cron
against the live deployment with nobody watching.

```
05:24:57  LIVE      start 219.88 v 496.51   end   0.00 v   0.00
05:25:27  SETTLED   start 219.88 v 496.51   end 220.10 v 496.48   NVDA takes both
```

NVDA +0.10%, MSFT −0.01%. Every price checked against the source afterwards,
independently, and matched to the last digit.

## Pitch video: 3 minutes

1. **0:00–0:15.** A group chat screenshot: "NVDA eats TSLA this week." "Bet."
   Cut to the board. "There has never been a way to actually settle that."
2. **0:15–0:45.** Pick a fight: NVDA vs AAPL, $25 each, 15 minutes, the taunt.
   One signature. The share panel. Post on X: show the card unfurl.
3. **0:45–1:15.** Second phone: open the link, connect (guest wallet, one tap),
   get test stocks, take it. The page flips to ROUND LIVE: health bars, the
   clock, real moves landing as hits.
4. **1:15–1:45.** **The hook.** Show the clock: the middle of the night, or a
   Sunday. "Every market on Earth is shut. This fight is still running." The
   24/7 badge, and the proof table naming the pool it settles on.
5. **1:45–2:15.** "Who decides who won?" The proof table: each stock's price at
   each boundary, Pyth's or the oracle's signed quote, and the program refusing
   any other. Then the picker: 1,033 stocks, a Hong Kong listing against a US one.
6. **2:15–2:45.** The bell. K.O. The winner's shares arrive, both stakes. The
   loser's card: COOKED. Post the result. "Run it back" at double the stake.
7. **2:45–3:00.** The Blink: take a fight from inside X. Close on the line.

Record one round live during market hours so the moves are real, and one
off-hours so the 24/7 claim is shown rather than told.

## Technical video: 5 minutes

1. **The one price** (`programs/duel/src/pyth.rs`): the PriceUpdateV2 layout,
   the owner and Full-verification checks, `prev_publish_time < boundary <=
   publish_time`, and why it makes settlement unambiguous.
2. **The second source** (`quote.rs`, `src/lib/oracle.ts`): the 78-byte quote,
   Ed25519 introspection through the instructions sysvar and why entries that
   point into other instructions are ignored, and why the fight instruction and
   its quotes must share a transaction.
3. **Pricing a shut market** (`src/lib/oracle.ts`, `scripts/build-pools.ts`):
   the three markets people confuse (the exchange, the issuer's venue, the
   token's pool), why only the third is 24/7, the trimmed mean and the median it
   replaced, the liquidity floor, and the fallback to the exchange when a pool
   goes quiet. Nothing on chain changed to add any of it.
4. **The outcome** (`outcome.rs`): cross-multiplication, exponent alignment, the
   dollar-vs-percent test.
5. **The escrow** (`lib.rs`): the three exits, `init_if_needed` against ATA
   griefing, the balance-delta check that turns a fee-on-transfer mint into a
   failed stake, the Token-2022 extension screen, and the real mints it passes.
6. **Two signatures for a name** (`link_handle`): why the wallet alone and the
   oracle alone are each worthless, and how a claim that points back makes a
   stale profile invisible without anyone tidying it up.
7. **The tests**: `cargo test -p duel`, `npm test` against the binary, and
   `scripts/devnet-fight.ts`: a real stock fight on devnet with every price
   checked against its source.

## Honest limits, stated in the app

- The oracle is a trusted key for the stocks Pyth does not price here. Its
  quotes are public and checkable after the fact, not preventable.
- Off-hours pool prices are thinner than an exchange print and can differ from
  where the stock next opens.
- Pyth's equity feeds stop when the market does, so TSLA, QQQ and VOO keep
  exchange hours whatever their pools do. The app says so before you stake.
- A round shorter than the off-hours sample settles on the move across the
  sample, not across the round. The app says that too.
- The program is not audited.
- Every issuer keeps the power to freeze an account, pause transfers, or move
  tokens out of any account. A fight inherits that over what it holds.
- Tokenized stocks are generally offered to non-US persons only.

## Decisions the owner has to make before submitting

1. **Repository visibility.** Public, or reviewer access for the judges. The
   code carries no secrets (`.env*`, `keys/` and program keypairs are ignored).
2. **Team line.** Solo founder; the X handle to list.
3. **How AI was used.** Say it plainly: built with Claude Code as the pair, the
   owner directing, testing and holding every key.
4. **DNS.** `stonkwars.fun` goes live on submission day; until then the demo
   runs at the Vercel URL.
