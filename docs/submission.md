# Stocklana: submission package

Everything the form asks for, in one place. Hackathon: Stocklana, "something
innovative with stocks on Solana". Submissions close **Friday 18 September 2026,
4:00pm ET**. Judging runs through 2 October.

The published rules ask one question: **could this be a real app that people
will actually use?** Judges look for a real user and problem, a working end to
end demo, a reason it belongs on Solana, and quality of execution. The rules
also say to pick one wedge and make it excellent. Ours is two of the listed
ones, and the entry should lead with the first: **24/7 trading venues**, and
**social trading**.

## Names and links

| Field | Value |
|---|---|
| Project | **Stonk Wars** (`stonkwars.fun`) |
| One-liner | Your stock vs theirs. Winner takes both. |
| Live demo | https://stonkwars.fun (Solana devnet, real market prices) |
| Program (devnet) | `Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D` |
| Oracle (devnet) | `EoFpiFFsSodkwam5bx2zugSgioxmK5CCcxyc3bZCpAzy` |
| Settler (devnet) | `7UoQ9CBJTomyTBHpYVivjKrTghWe8N4vCSj7gE7yHVyY` (the crank wallet; every unattended settlement pays from it) |
| Repository | https://github.com/Cryptonomist/stonkwars.fun (private; see Decisions) |
| Wedge | Trading: 24/7 venues · Consumer: social trading |
| Author | @crypt0nomist, solo |

## Short description (280 characters, hard cap)

1v1 stock fights on Solana, on any of 1,033 tokenized stocks. Stake shares of
the stock you back; somebody stakes theirs. The bigger percentage move by the
bell takes both stakes, paid in shares. 45 fight 24/7/365 on real markets, with
a public receipt anyone can check.

## Long description

> **Budget: 4,563 characters.** The form's Full Description field is reported to
> be a 5,000 character hard cap that truncates silently. That cap is a research
> finding rather than something confirmed against the live form, so check it
> before pasting. There are 437 characters of headroom.
> `python3 scripts/description-budget.py` counts this section and the short one.

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
off chain. 45 tokenized stocks fight 24/7/365 on real markets, with a public
receipt anyone can check. Every other stock fights the moment its market opens.
We never invent a price. In market hours the price is the stock's own market,
4am to 8pm New York time. Outside them it is the median of the one-minute
closes of up to nine public venues that trade the stock around the clock,
perpetual futures and tokenized shares, from Hyperliquid and OKX to Binance and
Lighter.

A median is only as honest as its inputs, so we measured before trusting any.
A stock gets the badge only if three venues with real volume traded it within
15 minutes through 90% of last weekend's minutes, each checked against the
share itself. That caught one venue's CL, crude oil where ours is
Colgate-Palmolive. Then we attacked the rule with those minutes. Each venue is
corrected for its premium to the others and the price is the median of three
minutes, yet one venue could still change over a third of some stock's
15-minute rounds, and never more than 2.6% of 12-hour ones. So a round priced
this way runs at least 12 hours, and a shorter one queues for the open. Every
price's proof, venue by venue with a sha256, is on the fight's own receipt.

**Every tokenized stock.** We pulled every issuer's token list, read each mint's
Token-2022 extensions on chain, and kept what a program can escrow: 1,345 issuer
tokens down to 1,033 stocks and ETFs, including 80 listed in Hong Kong and
London. Allowlist-only tokens, whose accounts start frozen, are left out and the
page says why. `scripts/watch-listings.ts` asks the issuers what they publish
today and screens anything new the same way, because a stock listing on Solana
every week is the normal state now.

**Why nobody can rig it.** Each stock has one price authority, copied onto every
fight at creation. VOO is priced by Pyth updates verified on Solana against
Wormhole guardian signatures, and the program accepts only the unique first
price at or after each boundary (Pyth's own `parsePriceFeedUpdatesUnique` rule).
Every other stock is priced by the Stonk Wars oracle: a price signed off chain
and checked on chain by Solana's Ed25519 program in the same transaction. The
oracle is trusted about the market and the app says so on every fight that uses
it; it cannot touch a stake, cannot reach a fight created before it was named,
and every quote it signs is public in the transaction that used it. The winner
is decided by cross-multiplying integer prices, so nothing rounds. Settling is
permissionless. Stakes sit in token accounts owned by the fight's own PDA and
leave by exactly three named paths. No admin withdrawal exists, and pausing
cannot block a payout.

**Your name on your wins.** Connecting X writes your handle beside your wallet
on chain, and it takes two signatures: yours, proving the wallet, and the
oracle's, which the server adds only after X's own sign-in named the handle.
Neither is worth anything alone, so nobody can hang a stranger's name on their
record or their own name on a stranger's wallet. The leaderboard needs no
database: it reads profiles from the chain like everything else.

**Built for the trenches.** The front page is a board, not a pitch: a live tape,
what is in the ring, what is moving, who is winning. A fight link unfurls on X
as a VS card, and every fight is a standard Solana Action any client can take.
The fight page plays like a fighting game, over numbers
that are real: every price lands as a hit, a run of them is a combo, the bell
is a knockout. A guest wallet and a faucet put a stranger in a fight within a
minute, no extension and no SOL.

Built on Anchor, Pyth, Solana's Ed25519 program and LiteSVM, over the issuers'
own token lists, nine venues' public minute bars and Yahoo bars.

## Against the four things judges look for

- **A real user and problem.** The argument in the group chat, and the fact that
  no venue on Earth will take that bet between two named people on a stock.
- **A working end to end demo.** Live on devnet with real market prices. A
  stranger is in a fight inside a minute with no extension and no SOL. The proof
  below is a fight nobody touched.
- **Why it belongs on Solana.** Stakes are held by a program rather than a
  counterparty, paid out in shares rather than cash, settled permissionlessly by
  anyone, and exposed as a standard Solana Action any client can take. The 24/7
  part exists only because the share is a token.
- **Quality of execution.** 624 tests across three suites, every 24/7 price
  published with a proof anyone can recompute, and the limits below stated in
  the app before anybody stakes.

## What was built in the window (Sept 11 to 18)

All of it. The duel program and its tests, the Next.js app and brand, the
oracle and its off-hours pricing (pools, then perps, then the nine-venue median), the settler, the Solana Action,
the share cards, X handle linking, the devnet deployment. Wallet plumbing (the
React 19 connect button, phone wallet hand-off, honest transaction confirmation)
is carried over from the same author's Commish.

## Numbers

- **1,033** stocks and ETFs, screened from 1,345 issuer tokens across 7
  issuers; 122 ETFs, 80 listed outside the US. Every mint checked against the
  program's escrow rules, read from mainnet
- **45** fight 24/7/365, each pinned to **6 to 9** public venues, **3** or
  more of them with real volume, measured minute by minute on the weekend of 12
  September. A round those venues price runs **12** hours or more, where one
  venue could change at most **2.6%** of any measured stock's rounds
- **2** sources of trust, chosen per stock and frozen per fight: Pyth
  (trustless) and a signed oracle (public, checkable, labelled). **2** kinds of
  market read behind the oracle: the stock's exchange, and the median of its
  24/7 venues, with a proof for every price
- **14** program instructions, **3** ways for a stake to leave escrow, **0**
  admin withdrawals
- **26** Rust unit tests · **37** LiteSVM tests against the built binary, with
  real Ed25519 signatures · **561** web tests · live end-to-end fights whose
  every on-chain price matched its source, asked again independently
- **1** transaction to open a fight, **1** to take it, **0** to settle it: the
  deployed settler does that, and anyone else can press the button too

## The proof it works unattended

A fight was created and accepted at 20:21:00 UTC on Saturday 12 September, with
every US exchange shut for the weekend, and then left alone. META against NVDA
on devnet, against the deployed program and the deployed settler, both stocks
priced by their perpetual market.

```
20:27:10  status 1 -> 2   start prices posted
20:30:09  status 2 -> 3   settled, NVDA takes both

start   META 649.5600   source 649.5600   match
start   NVDA 218.6900   source 218.6900   match
settle  META 649.4900   source 649.4900   match
settle  NVDA 218.6800   source 218.6800   match
```

META moved -0.0108%, NVDA -0.0046%, so NVDA won by 0.006 percentage points.

The fight was opened and accepted from a script, and after that nobody touched
it. What makes the rest proof rather than assertion is who paid for it: the fee
payer on the transactions that carried it from accepted to settled was
`7UoQ9CBJTomyTBHpYVivjKrTghWe8N4vCSj7gE7yHVyY`, the deployed settler's crank
wallet, whose key lives on the deployment and not on this machine.
`scripts/devnet-fight.ts` reproduces it: with `HANDS_OFF=1` it creates a fight,
cranks nothing, prints each status change as `(nobody here did that)`, and then
reads back the fee payer of every transaction that touched the duel.

## Pitch video: 3 minutes

Two rounds filmed at two different times, and the video says which is which out
loud. Round one during market hours on Monday, where a real move makes a real
result. Round two is the Saturday night round, where the point is not the size
of the move but that it happened at all. About 420 words of voiceover fits in
three minutes, so cut pictures rather than words. A lower third in beat 2 reads
*Solana devnet. Test mints. Real market prices.* and stays up long enough to
read. Nothing on screen shows a keypair, a seed phrase or a `.env`.

1. **0:00 to 0:10. The argument.** A group chat: "NVDA eats TSLA this week."
   "Bet." Cut to the board: the live tape, what is in the ring, what is moving.
   *"Every group chat has this argument. Nobody has ever been able to settle it."*
2. **0:10 to 0:35. One transaction.** *(Monday, market open)* The create page.
   NVDA against AAPL, $25 a side, fifteen minutes, a taunt typed in. One wallet
   approval, then the share card. *"You stake shares of the stock you back and
   name the stock it beats. Whoever takes the fight stakes the same dollar value
   of theirs. The bigger percentage move by the bell takes both stakes, paid out
   in shares. Tokenized stocks are the only reason that is one transaction
   instead of a brokerage and a lawyer."*
3. **0:35 to 0:55. Somebody takes it.** Second phone. The link opens from X,
   guest wallet in one tap, faucet, take the fight. The page flips to ROUND
   LIVE: health bars, the clock, prices arriving as hits. *"No extension, no
   SOL, a stranger is in a fight inside a minute."*
4. **0:55 to 1:10. The bell.** K.O. Both stakes land in the winner's wallet as
   shares. The loser's card: COOKED. "Run it back" at double the stake. *"That
   round ran while the market was open, so those are the real moves. Hold on to
   that, because the next one is the part that could not exist off chain."*
5. **1:10 to 1:25. Saturday.** The clock at 20:21 UTC, and beside it 4:21pm in
   New York, on a Saturday. The site's own market-closed state. Then META
   against NVDA created and accepted, and the phone put face down. *"Saturday
   afternoon in New York. Every US exchange has been shut since Friday's bell.
   This fight was created and accepted at 20:21 UTC, and after that nobody
   touched it."*
6. **1:25 to 1:50. Nobody did that.** The terminal running
   `HANDS_OFF=1 npx tsx scripts/devnet-fight.ts`, its own line
   `hands off: not cranking`, then `status 1 -> 2  (nobody here did that)` at
   20:27:10, `status 2 -> 3` at 20:30:09, then `settled: NVDA takes both`.
   *"The script that ran this one opens the fight, takes the fight, and then
   only watches. Nine minutes later it had a result it did not produce."*
7. **1:50 to 2:05. Who did it, then.** The `fee payers on this fight:` line,
   with `7UoQ9CBJ...` highlighted. Cut to that same address in the submission's
   links table, named as the settler. *"It prints who paid for the transactions
   that moved it. That wallet is the deployed cron, not this laptop. The thing
   that settled this fight is the thing running on the internet right now."*
8. **2:05 to 2:20. The prices.** The fight page proof table. Four rows, start
   and settle for both stocks, source column reading `Oracle · perp` on every
   one. Split screen with the same four prices asked again from the source
   afterwards. *"Four prices the program accepted, each one asked again
   independently afterwards, each matching to the cent. Both stocks priced off
   their perpetual futures market, which trades every minute of the weekend."*
9. **2:20 to 2:32. What a dead weekend looks like.** The two moves, META
   -0.0108%, NVDA -0.0046%, and the margin. *"Say the unflattering half out
   loud. On a quiet Saturday a short round moves almost nothing. NVDA won by six
   thousandths of a percentage point, and what moved was the perpetual market
   rather than the share. The program cross-multiplies integer prices, so
   nothing rounds and that is a real result rather than a coin flip. It is not a
   dramatic one. The drama was round one. The point of round two is that it ran
   at all."*
10. **2:32 to 2:47. How much of the market this is.** The picker scrolling 1,033
    stocks and ETFs, then the Live 24/7 filter.
    *"One thousand and thirty three tokenized stocks and ETFs. Forty five fight
    around the clock, every day of the year, each priced by the median of up to
    nine public venues, each venue checked against its own share's price. Every
    other stock fights the moment its market opens. We never invent a price."*
11. **2:47 to 3:00. From the feed to the fight.** On a phone: an X post of an
    open fight showing its VS card. Tap it. The fight page opens, a guest wallet
    takes the fight with no extension and no SOL, and the round starts. Cut to
    the wordmark. *"Your stock against theirs. Winner takes both. Stonk Wars."*

    This beat replaced an earlier one that took a fight as a Blink inside X.
    Dialect paused dial.to and the Blinks registry has been frozen since spring
    2026, so wallets will not render an unregistered domain's Blink and there is
    no longer a way to register one. Filming it would have needed a homemade
    extension and an on-screen disclaimer. The replacement runs entirely on the
    live site, and "no extension needed" is the stronger claim anyway. Check the
    VS card renders on a real X post the day you film.

## Technical video: 5 minutes

Screen recording of the code, no talking head. About 700 words at a technical
pace. Beat 4 earns the entry and gets a fifth of the runtime. Let the test
counts print themselves rather than reading them out.

1. **0:00 to 0:15. What is worth checking.** The repo tree, then `pyth.rs`,
   `quote.rs`, `oracle.ts` held for a second each. *"Three claims worth
   checking: that only one price can settle a fight, that a signed price cannot
   be forged or replayed, and that a shut exchange is priced by something real."*
2. **0:15 to 0:50. The one price** (`programs/duel/src/pyth.rs`). The
   PriceUpdateV2 layout comment, the owner check, the Full verification check,
   the boundary condition. *"Pyth prices VOO. The account is
   parsed by hand, because the receiver SDK stops at Anchor 0.31 and this
   program is on 1.1, so every byte is checked in view. Each update carries the
   publish time of the one before it, so the program demands previous below the
   boundary and this one at or after it. Exactly one update in existence
   satisfies that. It is Pyth's own `parsePriceFeedUpdatesUnique` rule enforced
   on chain, and it means a settler has nothing to shop for."*
3. **0:50 to 1:25. The second source** (`programs/duel/src/quote.rs`). The
   78-byte layout, then `find_in_ed25519_data`, holding on the `HERE` check.
   *"Everything else is priced by a key the admin names in config, signing one
   fixed message per stock per boundary: seventy eight bytes, prefix, feed,
   boundary, price, exponent, publish time. The settler puts that signature in
   an Ed25519 instruction in the same transaction, and the program finds it
   through the instructions sysvar. If the signature were bad the Ed25519
   program would have failed the transaction before this code ran. One subtlety:
   an Ed25519 offset entry can point at bytes inside a different instruction, in
   which case the runtime checked those bytes and not the ones sitting here. So
   only entries whose three instruction indexes all say `this one` are read at
   all. The quote names no duel and no cluster, because a true statement about
   the market stays true wherever it is replayed."*
4. **1:25 to 2:55. Pricing a shut market** (`src/lib/oracle.ts`,
   `src/lib/composite.ts`, `scripts/build-247.ts`, `docs/247-hardening.md`). On
   screen in order: `sourceAt`, `venues247.json`, `compositeV2At`, the attack
   table, a fight's receipt with its proof open.
   *"`sourceAt` picks the market in a few lines. A listing outside the US gets
   its own exchange's session. A US stock from four in the morning to eight at
   night gets its own market. Shut, and pinned in `venues247.json`, it gets the
   composite: forty five stocks. Neither, and it waits for the opening.*
   *The composite reads the one-minute candles of up to nine public venues,
   perpetual futures and tokenized shares, by requests fixed in the proof. The
   pins came from a real weekend: three venues with real volume, fresh in ninety
   percent of its minutes, each checked against the share itself. That is how
   `CL`, crude oil on the venues and Colgate-Palmolive here, stayed out.*
   *Then we attacked it. Under a median of one minute, one print on one venue
   changed up to three in five fifteen minute rounds. So a venue counts only if it traded in
   the fifteen minutes before, each is divided by its premium to the others over
   the hour before, and the price is the median of three minutes. Measured on the
   same minutes, one venue can still change over a third of some stock's
   fifteen minute rounds, and never more than two point six percent of twelve
   hour ones. So a round priced this way runs twelve hours, and a shorter one
   queues for the open. Too few venues, and the side takes the exchange's first
   bar. Nothing is ever modelled.*
   *Every price carries its proof: each venue's request, closes, premium, what
   was kept, and a sha256. The receipt draws it, and the route recomputes it for
   anyone."*
5. **2:55 to 3:15. The outcome** (`outcome.rs`). Cross-multiplication, exponent
   alignment. *"No division, no rounding, no basis-point truncation in the
   decision; basis points exist only for the event and the page. This is why a
   margin in the fourth decimal place is a result rather than an artefact. And
   the test that keeps it honest: a nine hundred dollar stock up eighteen
   dollars loses to a hundred dollar stock up three."*
6. **3:15 to 3:45. The escrow** (`lib.rs`). `release`, its three call sites, the
   balance-delta check, `CloseDuel`. *"Stakes sit in token accounts owned by the
   fight's own PDA. Exactly one helper empties one, called from exactly three
   instructions: cancel, settle, refund. Nothing else can move a stake, and no
   admin instruction so much as takes a token account. `close_duel` looks like a
   fourth exit and is not: it holds no token accounts and moves rent.
   `init_if_needed` on the destination handles the griefer who front-runs your
   ATA. A fee-on-transfer mint cannot short the escrow, because create and accept
   both check the balance actually moved by the full stake, so such a fight fails
   to open rather than opening wrong. Two Token-2022 extensions are refused
   outright, a transfer hook with a program set and non-transferable, because
   either would trap a stake forever."*
7. **3:45 to 4:10. Two signatures for a name** (`link_handle`). The instruction,
   both signers, then a profile on the leaderboard. *"Connecting X writes a
   handle beside a wallet on chain, and it takes two signatures. Yours proves
   the wallet. The oracle's is added by the server only after X's own sign-in
   named the handle. Neither is worth anything alone, so nobody can hang a
   stranger's name on their record or their own name on a stranger's wallet."*
8. **4:10 to 5:00. The tests, and the run that matters.** `cargo test -p duel`
   and `npm test` running to completion, letting the counts print themselves.
   Then `npm run test:web`. Then the hands-off devnet log from Saturday, ending
   on the fee payer line. *"LiteSVM tests run against the built binary with real
   Ed25519 signatures, so the introspection is exercised the way the runtime
   does it and not the way a mock does. And the one that is not a test:
   `scripts/devnet-fight.ts` with hands off, which opens a real fight between
   two real stocks against the deployed program, refuses to crank it, and waits.
   On Saturday the twelfth, with every US exchange shut, it reached a settled
   result nine minutes later and printed the fee payer that did it."*

## Honest limits, stated in the app

- The demo runs on devnet: real market prices, test mints standing in for the
  tokenized shares. The mint screen was run against mainnet.
- The oracle is a trusted key for the stocks Pyth does not price here. Its
  quotes are public and checkable after the fact, not preventable.
- Off-hours, the price is not the share's own market. For the 45 it is the
  median of perpetual futures and tokenized shares on up to nine venues,
  instruments with their own basis, and it can differ from where the stock next
  opens. A weekend round measures how those markets moved, read the same way for
  both sides, not how the shares moved.
- One weekend of evidence. The venues were pinned and the rule was attacked on
  the minutes of 12 and 13 September, for 12 of the most liquid names. Gate,
  MEXC and BingX print nearly every minute on little volume, so they count
  toward three venues but can never be the two with real volume a price needs.
- At the handoff the composite sat a median 5.4 bps from Friday's close and 13.8
  bps from Monday's open, and one venue can still tip a short round, which is
  why a round it prices runs 12 hours or more. With fewer than 3 venues counted,
  2 with real volume, a side takes the exchange's first bar, and the proof says
  so.
- The weekend round above came down to 0.006 percentage points. The program
  decides by cross-multiplying integer prices, so nothing rounds anywhere in the
  comparison and that is a real result rather than an artefact of the
  arithmetic, but a five-minute fight on a dead weekend is not a dramatic one.
  It was priced by a perp, before the composite replaced them.
- History expires. Hyperliquid serves about 3 days of one-minute candles and
  Gate about 6, so an older proof cannot be recomputed in full; the other venues
  keep 25 days or more.
- The list of 45 is pinned in `src/data/venues247.json` from those minutes.
  Rebuilding it with `scripts/build-247.ts` on another weekend will move it.
  Whether every venue answers from the deployment's region, and each venue's
  terms, still have to be checked; a venue that does not answer makes a price
  wait, never guess.
- Pyth's equity feeds are dark from Friday 8pm to Sunday 8pm New York, so VOO
  fights only while Pyth prints, and a fight that would start or end in the gap
  is refused before anyone stakes. TSLA and QQQ moved to the oracle for exactly
  that reason; a fight made on Pyth keeps Pyth.
- The prices come from public third-party data: the venues' own APIs and Yahoo
  minute bars for the exchange. Being rate-limited is a wait, not a failure, and
  the crank comes back.
- The program is not audited.
- Every issuer keeps the power to freeze an account, pause transfers, or move
  tokens out of any account. A fight inherits that over what it holds.
- Tokenized stocks are generally offered to non-US persons only.

## Decisions and the run-up to Friday

Settled with the owner on 13 September:

1. **Repository stays private.** No published rule requires a public repo, and
   the rules ask only for *at least one* link among GitHub, live demo or video.
   The live demo and the two videos carry the entry. Judges are unnamed
   Foundation appointees who cannot be granted access in advance, so the GitHub
   link is worth nothing to them while the repo is private. Either accept that
   and lean on the demo, or make it public before Friday. The code carries no
   secrets (`.env*`, `keys/` and program keypairs are ignored).
2. **Author.** Solo, @crypt0nomist. The form invites teammates by platform
   username and has no field for an X handle, so it goes in the description.
3. **How AI was used.** No rule requires disclosure and there is no field for
   it. Stated anyway as voluntary candor: built with Claude Code as the pair,
   the owner directing, testing and holding every key.
4. **DNS. Done, 13 September.** `stonkwars.fun` is live and primary, `www`
   redirects to it, certificates valid on both. Every page, the API, the share
   card, the fight cards and the Action icons check out on the new domain, all
   under 0.4s. The card and icons followed by themselves, because they read
   Vercel's production domain rather than a value anybody has to remember.
   Going five days early rather than on submission day is what left room to
   find that the whole thing had been unfurling broken. `hello@stonkwars.fun`
   routes to the project Gmail through Cloudflare Email Routing.
5. **Blinks on X. Dropped, 13 September.** dial.to returns a paused Vercel
   deployment on every path, Dialect posted and then withdrew a notice in July
   2026 that it was sunsetting Blinks, and its registry has not changed since
   spring. Wallets render only registered domains inside X, so a new domain
   cannot get a Blink to unfurl there, and there is no public previewer left to
   link to. The fight is still a spec-compliant Solana Action at
   `/api/actions/fight/<duel>`, which is the claim the submission now makes and
   the only one that is true. Do not say "registered" anywhere.

Still to do:

- **Register and link a Solana wallet** on the hackathon site. Both are
  prerequisites rather than the submission itself; a Google-only account cannot
  be paid.
- **Submit early and keep editing.** Edits are allowed until submissions close
  and the form saves drafts, so filing a complete entry as soon as the demo link
  is stable removes the deadline risk entirely. Videos can land after.
- **Monday, during market hours:** run a real fight on the Pyth path. It is the
  one price source this build has never exercised, because the whole build
  happened over a weekend, and Monday is the last chance before filming.
- **Film round one Monday** while the market is open, so the pitch video has a
  move worth watching.
