<div align="center">

# STONK WARS

**Your stock vs theirs. Loser gets cooked.**

Stake real tokenized shares on your stock. Your friend stakes theirs.
At the bell, whichever moved more takes both stakes. The market decides, not us.

45 tokenized stocks fight 24/7/365 on real markets, with a public receipt anyone can check.
Every other stock fights the moment its market opens. We never invent a price.

[stonkwars.fun](https://stonkwars.fun) · Built on Solana · Every tokenized stock a fight can hold: 1,031 of them · Entry for [Stocklana](https://hackathons.solana.com/hackathons/stocklana)

</div>

---

## The idea

Every group chat has the argument. *NVDA is going to eat TSLA this week.* Somebody says bet, and then nothing happens, because there is no way to put the stock where your mouth is. A brokerage cannot hold a bet between two friends, a sportsbook will not take one on a stock, and a prediction market needs a market maker and an order book for a two-person grudge.

Tokenized stocks make it one transaction. You stake shares of the stock you back; whoever takes the fight stakes the same dollar value of theirs. At the bell, Solana checks a signed price for each stock, and the stock with the bigger percentage move takes both stakes, **paid in shares, not cash**. The loser is cooked, and the share card says so.

That last part is only possible because the stocks are tokens. Nobody can hand their friend "my shares of Tesla" at a brokerage when they lose.

## Every tokenized stock

There are more tokenized stocks on Solana than any single list shows. `scripts/data/tokens.json` is every one we found, from each issuer's own API, with the mint facts that matter read on chain: 1,345 tokens from seven issuers. A fight can hold 1,288 of them:

| Issuer | Tokens a fight can hold |
|---|---|
| xStocks (Backed / Kraken) | 831 |
| Ondo Global Markets | 411 |
| Backpack Securities (via Sunrise) | 43 |

That is **1,031 stocks and ETFs**, 80 of them listed outside the US (Hong Kong, London). `scripts/build-roster.ts` leaves out, and says why:

- tokens that only an issuer's allowlist may hold (Superstate, SECZ, BLSH): their new accounts start frozen, so a fight's escrow would be frozen from birth;
- tokens with no supply, winding down (Remora) or halted;
- lookalikes: anyone can mint a token called `ORCLx`; only the issuer's own mints are registered, and a pump.fun "Orclx" and a classic-SPL "BLKx" found by search are not.

Two issuers' tokens of one stock (TSLAx and TSLAon) share one feed id, and the program refuses to pit them against each other.

`scripts/xstocks-probe.ts` reads every mint on mainnet and applies the program's escrow screen (`mint_check.rs`): all **1,285** on the roster pass. All are Token-2022; their transfer hooks have no program set; new accounts start Initialized, not Frozen; none charges a transfer fee.

## A fight, start to finish

1. **Call it.** Pick your fighter, theirs, a stake ($25 each, sized in integers from the live price), and a round: 5 or 15 minutes, an hour, overnight (12 hours), 24 hours, the next closing bell, or Friday's. Add a taunt; it is written on chain with the fight. A pair that cannot start fairly now but can later (a stock that waits for its exchange against one that trades, or a short round while the exchange is shut) is queued, not refused: the challenge says when it can be taken.
2. **They answer.** The link unfurls on X as a VS card, and every fight is also a standard Solana Action any Actions client can take. Whoever takes it stakes exactly the terms offered. A fight can be open to anyone or addressed to one wallet.
3. **The round runs** from each stock's first price at least two seconds after the accept. The fight page is a fighting-game HUD: live moves, health bars that drain with the gap between the two stocks, a clock to the bell.
4. **The bell.** Each stock's first price at or after the end. Bigger percentage move wins both stakes; an exact tie refunds each side. The settler posts it within a minute, and anyone can post it from the fight page.

## Where the prices come from

Each stock is priced by one of two sources, fixed when it is registered and copied onto every fight that uses it:

**Pyth, trusting nobody** (VOO on this deployment). A `PriceUpdateV2` account written by the Pyth receiver after it checks Wormhole guardian signatures. Pyth prints several times a second, but every update records the publish time of the one before it, and the program accepts only `prev_publish_time < boundary <= publish_time`: the unique first price at or after the bell, the rule Pyth's own EVM contract enforces as `parsePriceFeedUpdatesUnique`.

**The Stonk Wars oracle, for every other stock.** Pyth's equity feeds are dark from Friday 8 PM to Sunday 8 PM New York, so a stock priced by Pyth can never fight at a weekend. TSLA and QQQ trade all weekend elsewhere and are priced by the oracle for new fights because of it, and the other 1,028 would otherwise sit locked for two days of every seven. VOO stays on Pyth because it has no weekend market anywhere to be locked out of. The oracle answers the same question, the first price at or after the boundary, from completed one-minute bars of the stock's regular session: the close of the bar the boundary falls in, or of the first bar after it when the market was shut, converted to dollars at the same minute for a foreign listing. It signs a fixed 78-byte message (feed, boundary, price, exponent, time); the settler puts the signature in an Ed25519 program instruction in the same transaction, and the program finds it through the instructions sysvar (`quote.rs`).

**24/7, on real markets.** While a US stock's exchange is shut (8 PM to 4 AM New York, weekends, holidays), the oracle prices the 45 stocks pinned in `src/data/venues247.json` by composite-v2: the median, over the three minutes from the boundary, of the one-minute closes of up to nine public venues that trade the stock around the clock (Hyperliquid, OKX, Bitget, Binance, Lighter, Backpack, Gate, MEXC, BingX), each corrected by its premium to the others over the hour before. A venue counts only if it traded in the 15 minutes before; at least 3 must count, 2 of them with real volume, or the side takes the exchange's first bar. The pins and the rule were measured on a real weekend of minutes (`docs/247-roster.md`, `docs/247-hardening.md`), and because one venue can still tip a short round (on that weekend, over a third of some stock's 15-minute rounds, against at most 2.6% of 12-hour rounds and 5.2% of 24-hour ones), a round the composite prices runs at least 12 hours. Every such price comes with a proof, each venue's request, closes and what was kept, with a sha256, drawn on the fight's receipt and recomputed for a fight's side by `/api/quote/proof`. Every other stock waits for its own market.

Why not the tokens' own DEX prices? Most tokenized stocks barely trade on Solana: Jupiter prices 31 of the first 89 xStocks we checked, and some of those were far from the real share (a VXUS token at $250.85 against an $87.12 share). A thin pool can be pushed with one swap at the bell. Fights settle on the stock's real market price.

## Why nobody can rig it

| Nobody can... | Because... |
|---|---|
| Fake a Pyth price | Only accounts owned by the Pyth receiver, with **Full** verification, for the fight's feed, are read. |
| Fake an oracle price | Only a message signed by the oracle key the fight recorded at creation is read, and the Ed25519 program checks the signature before the fight instruction runs. Entries that point at bytes in another instruction are ignored. |
| Shop for a better print | Pyth: exactly one update satisfies the boundary rule. Oracle: the price comes from completed bars, so it is the same whenever it is asked; Ed25519 signatures are deterministic, so it is the same bytes. |
| Time the start | The start boundary is two seconds after the accept, so the start price did not exist when the taker signed. |
| Round in their favour | The winner is decided by cross-multiplying integer prices, `c_end * o_start` against `o_end * c_start`, with exponents aligned. No division, no floats, no basis points in the decision. |
| Refuse to settle | Starting and settling are permissionless. Any wallet can post the prices; `/api/quote` hands out the oracle's signed quotes for any real fight's boundaries. The result is identical whoever does it. |
| Take the stakes | Stakes sit in token accounts owned by the fight's own PDA. They leave by exactly three paths, each naming its recipient: back to the challenger (`cancel_duel`), to the winner (`settle_duel`), or home to both (`refund_duel`). The one thing that can come off a payout is the platform fee, a share of the loser's stake taken inside `settle_duel`: capped at 5% in the program, **0 today**, and a raise reaches only fights created a week after it is set (`docs/platform-fee.md`). Nothing else can move a stake, and no admin instruction takes a token account. |
| Swap the oracle mid-fight | A fight copies the oracle key and each side's source when it is created. Rotating the key or re-pointing a stock only reaches fights created afterwards. |
| Strand a fight | A fight whose price never arrives (a halted feed, a delisting, an oracle that goes silent) refunds to both sides after a week. A fight that cannot start fairly (the market reopens more than five days later, or inside the last minute of a fixed-end round) is void at once. |

**What the oracle is trusted with.** For a stock it prices, the oracle key is trusted to tell the truth about the market. It cannot move a stake, pick a winner directly, or reach a fight created before it was named; and every quote it signs is public in the transaction that used it, next to the minute bar it claims to come from, so a false one is provable after the fact. The fight page labels each side with its source. When a stock gets a Pyth feed, one `set_asset` call switches it for new fights.

## What is in the repo

```
programs/duel/        the Anchor program (Anchor 1.1.2)
  src/pyth.rs         PriceUpdateV2 parsed by hand, and the one-price rule
  src/quote.rs        signed quotes, found through the instructions sysvar
  src/outcome.rs      the exact, integer winner test
  src/mint_check.rs   which Token-2022 mints can sit in escrow
  src/lib.rs          15 instructions, 3 ways out
  src/fee.rs          the capped platform fee (0 today)
tests/duel.ts         41 LiteSVM tests against the built binary, real Ed25519 signatures included
tests-web/            the quote layout (pinned against the Rust side), bar selection, market clock, stake sizing
src/                  the Next.js app
  app/f/[duel]/       the fight page and its share card
  app/api/prices      live prices for the stocks a page shows (keys stay on the server)
  app/api/pyth        a boundary's Pyth update, for settling from the browser
  app/api/quote       the oracle's signed quotes for a fight's boundaries, with the composite's proof
  app/api/quote/proof the composite's proof for one side of a fight at its start or bell, recomputed and unsigned
  app/api/crank       the settler, for an external cron
  app/api/faucet      test clusters only: test shares and SOL
  lib/duel.ts         the client half of the program: PDAs, instructions
  lib/oracle.ts       the price for a moment: the exchange's bars, or the pool's, and its signature
  lib/composite.ts    composite-v2: the weekend and overnight price, a median of up to nine venues' minutes, with its proof
  lib/venues247.ts    the venues it reads, their fixed requests, and data/venues247.json's pins
  lib/crankTx.ts      a fight's transactions: post, quote + start/settle, close
  data/roster.json    the 1,031 stocks
scripts/
  data/tokens.json    every issuer's tokens, with on-chain mint facts
  build-roster.ts     tokens -> the roster: what a fight can hold and a market can price
  watch-listings.ts   what the issuers publish today that the snapshot does not have
  build-247.ts        the venues that price each 24/7 stock while its exchange is shut, from a measured weekend
  build-perps.ts      before COMPOSITE_FROM: the perpetual market that priced a shut stock
  build-pools.ts      before COMPOSITE_FROM: the Solana pool, where there was no perp
  offhours-audit.ts   which stocks can actually be priced right now, asked of the real oracle
  setup-devnet.ts     config, oracle, a test mint and registration per stock
  settler.ts          the permissionless cranks, on a timer
  e2e-live.ts         whole fights on real prices at any hour, checked against the sources
  dev-crank.ts        local validator only: the settler with prices faked
  dev-fight.ts        local validator only: open and take a fight in one command
```

### The program

| Instruction | Who | What |
|---|---|---|
| `create_duel` | challenger | fixes both stakes and the round, escrows the challenger's shares |
| `cancel_duel` | challenger, or anyone after expiry | stake back to the challenger |
| `accept_duel` | anyone, or the invitee | escrows the other stake on the offered terms |
| `start_duel` | anyone | records the start prices, Pyth or signed, per side |
| `settle_duel` | anyone | records the end prices, pays the winner both stakes |
| `refund_duel` | anyone | void or stalled: each stake home |
| `close_duel` | challenger | reclaim a finished fight's rent |
| `link_handle`, `unlink_handle` | the wallet, with the oracle's co-signature | an X handle beside a wallet, on chain |
| `init_config`, `set_paused`, `set_oracle`, `set_fee`, `register_asset`, `set_asset` | admin | the stock registry and its sources; pause blocks new fights, never a payout |

**Why the Pyth account is parsed by hand.** The one account type needed is 134 bytes with a fixed layout, so `pyth.rs` reads it directly: every byte it trusts is checked in view, and the dependency tree stays at what Anchor already pulls in. (When this was written the receiver SDK stopped at Anchor 0.31; its 2.0 release of June 2026 supports Anchor 1.x, and the hand parser stayed because it is smaller and fully tested.) `scripts/pyth-layout-probe.ts` parses live mainnet and devnet accounts with the same layout, and did so after Pyth's August 2026 Core upgrade.

**Token-2022.** Tokenized stocks are Token-2022 mints. The program uses the token interface throughout, so a fight can pair a classic SPL mint with a Token-2022 one, and refuses the extensions that would stop an escrow paying out: a live transfer hook and non-transferable. A fee-on-transfer mint fails at the stake, because the program checks the escrow received the full amount.

### The app

Next.js 15 on the Stonk Wars look: a fighting-game ring, P1 in cyan, P2 in pink, green and red strictly for price moves, and an orange COOKED stamp for exactly one thing. The picker searches all 1,031 stocks and fetches prices only for what is on screen. On test clusters a **guest wallet** (a keypair in localStorage) and a **faucet** that tops up the two stocks in your fight let someone play within a minute of landing, with no extension and no devnet SOL required.

## Run it

Everything below runs in WSL/Linux with the Solana toolchain (Anchor 1.1.2, Agave 3.1) and Node 24.

```bash
npm install
anchor build                       # programs/duel -> target/deploy/duel.so
cargo test -p duel --lib           # 34 unit tests: parsing, the one-price rule, quotes, the outcome, the fee
npm test                           # 41 LiteSVM tests against the binary
npm run test:web                   # the app's tests: quote layout, hours, the composite, the settler, stake sizing
```

**Real prices at any hour** (surfpool forks devnet; BTC by Pyth, ETH and SOL by the oracle, because crypto never closes):

```bash
surfpool start --network devnet --no-tui --no-deploy
solana program deploy --url localhost --program-id target/deploy/duel-keypair.json target/deploy/duel.so
RPC=http://127.0.0.1:8899 npx tsx scripts/setup-devnet.ts        # 1,031 stocks, oracle, faucet
RPC=http://127.0.0.1:8899 npx tsx scripts/e2e-live.ts            # needs PYTH_API_KEY in .env.local
```

**A whole fight in the app, no API key needed** (prices synthetic):

```bash
RPC=http://127.0.0.1:8899 npx tsx scripts/dev-crank.ts &
NEXT_PUBLIC_CLUSTER=localnet NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 RPC_URL=http://127.0.0.1:8899 DEV_FAKE_PRICES=1 npm run dev
```

**Devnet:** copy `.env.example` to `.env.local`, add a Pyth API key (Hermes has required one since the Core upgrade of 2026-08-26), deploy, run `scripts/setup-devnet.ts` (it writes the faucet and oracle keys to `.env.local`), then `scripts/settler.ts` beside the app.

## Honest limits

- **The oracle is a trusted key** for the stocks it prices, as above. Its market data is a public minute-bar feed; the source is one function in `lib/oracle.ts`, and swapping it (or moving a stock to Pyth) changes nothing on chain.
- **Out of hours, the price is not the share's.** While a US stock's own market is open, 4am to 8pm New York time, the oracle reads that market. Outside it, the 45 stocks marked 24/7 are priced by the median of perpetual futures and tokenized shares on up to nine venues. Those are not the share: a weekend price is what those markets traded, not the next open, and the receipt says so. It is also the better of the options we measured: the Solana pools these stocks trade in managed a median of three traded minutes an hour at a weekend. The evidence is one weekend and 12 of the most liquid names; the composite sat a median 5.4 bps from Friday's close and 13.8 bps from Monday's open at the handoff, and one venue can still tip a short round, so a round it prices runs at least 12 hours. Each venue was checked against the stock's own price before it was pinned, which is how one venue's `CL`, crude oil, stayed away from Colgate-Palmolive. Every other stock keeps exchange hours, as do all 80 listings outside the US. Pyth's equity feeds are dark at weekends, so VOO fights only while Pyth prints. Hyperliquid keeps about 3 days of one-minute history and Gate about 6, so older proofs cannot be recomputed in full.
- **Thin stocks.** "The first price at or after the boundary" is the first minute with a trade. A stock that does not trade in the bell's minute settles on its next trade, which for a thin ETF can be the next morning.
- **Foreign listings** trade in their own hours. A Hong Kong or London side is priced only by its own exchange's bars, and outside that exchange's sessions it waits for the next one. A pair whose two prices would land more than a minute apart is queued for the moment they line up, or refused if none comes before the challenge expires. So a Hong Kong stock fights a US stock only while both exchanges trade, 4:00 to 4:10 AM New York while New York is on summer time and not at all in winter; it fights VOO whenever both Hong Kong and Pyth print.
- **Scaled amounts and dividends.** Issuers pass on dividends and splits through a `ScaledUiAmount` multiplier, which today runs from 0.07 to 10 across the roster's mints. Prices are the underlying share's, so a stock that goes ex-dividend mid-fight drops by the dividend while its token compensates holders; a mainnet build must also apply the multiplier when it values and sizes stakes. The test shares have none.
- **Issuer powers.** Every issuer can freeze an account; all but Ondo can move tokens out of any account (a permanent delegate) and pause transfers. A fight inherits those powers over the tokens it holds, and nothing on top can remove them.
- **Who can hold tokenized stocks.** Issuers generally offer them to non-US persons only. The live demo runs on devnet with test shares that stand in for them, and real market prices. Know the rules where you live.

## Disclaimer

Stonk Wars is a demonstration of peer-to-peer escrow on Solana. Nothing here is financial, investment, gambling or legal advice.

## License

MIT, see [LICENSE](LICENSE). That covers this repository's code. The logos in
`public/integrations` belong to their owners and are shown under each owner's
brand terms (sources in `src/lib/integrations.ts`); the tokenized stocks are
their issuers' products.
