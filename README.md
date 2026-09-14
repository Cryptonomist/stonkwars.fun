<div align="center">

# STONK WARS

**Your stock vs theirs. Loser gets cooked.**

Stake real tokenized shares on your stock. Your friend stakes theirs.
At the bell, whichever moved more takes both stakes. The market decides, not us.

[stonkwars.fun](https://stonkwars.fun) · Built on Solana · Every tokenized stock on Solana: 1,033 of them · Entry for [Stocklana](https://hackathons.solana.com/hackathons/stocklana)

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
| xStocks (Backed / Kraken) | 833 |
| Ondo Global Markets | 412 |
| Backpack Securities (via Sunrise) | 43 |

That is **1,033 stocks and ETFs**, 80 of them listed outside the US (Hong Kong, London). `scripts/build-roster.ts` leaves out, and says why:

- tokens that only an issuer's allowlist may hold (Superstate, SECZ, BLSH): their new accounts start frozen, so a fight's escrow would be frozen from birth;
- tokens with no supply, winding down (Remora) or halted;
- lookalikes: anyone can mint a token called `ORCLx`; only the issuer's own mints are registered, and a pump.fun "Orclx" and a classic-SPL "BLKx" found by search are not.

Two issuers' tokens of one stock (TSLAx and TSLAon) share one feed id, and the program refuses to pit them against each other.

`scripts/xstocks-probe.ts` reads all 1,288 mints on mainnet and applies the program's escrow screen (`mint_check.rs`): **1,288 pass**. All are Token-2022; their transfer hooks have no program set; new accounts start Initialized, not Frozen; none charges a transfer fee.

## A fight, start to finish

1. **Call it.** Pick your fighter, theirs, a stake ($25 each, sized in integers from the live price), and a round: 5 minutes, an hour, the next closing bell, or Friday's. Add a taunt; it is written on chain with the fight.
2. **They answer.** The link unfurls on X as a VS card, and every fight is also a standard Solana Action any Actions client can take. Whoever takes it stakes exactly the terms offered. A fight can be open to anyone or addressed to one wallet.
3. **The round runs** from each stock's first price at least two seconds after the accept. The fight page is a fighting-game HUD: live moves, health bars that drain with the gap between the two stocks, a clock to the bell.
4. **The bell.** Each stock's first price at or after the end. Bigger percentage move wins both stakes; an exact tie refunds each side. The settler posts it within a minute, and anyone can post it from the fight page.

## Where the prices come from

Each stock is priced by one of two sources, fixed when it is registered and copied onto every fight that uses it:

**Pyth, trusting nobody** (TSLA, QQQ and VOO on this deployment). A `PriceUpdateV2` account written by the Pyth receiver after it checks Wormhole guardian signatures. Pyth prints several times a second, but every update records the publish time of the one before it, and the program accepts only `prev_publish_time < boundary <= publish_time`: the unique first price at or after the bell, the rule Pyth's own EVM contract enforces as `parsePriceFeedUpdatesUnique`.

**The Stonk Wars oracle, for every other stock.** Pyth's free plan grants three US equity feeds; the other 1,030 stocks would otherwise be locked. The oracle answers the same question, the first price at or after the boundary, from completed one-minute bars of the stock's regular session: the close of the bar the boundary falls in, or of the first bar after it when the market was shut, converted to dollars at the same minute for a foreign listing. It signs a fixed 78-byte message (feed, boundary, price, exponent, time); the settler puts the signature in an Ed25519 program instruction in the same transaction, and the program finds it through the instructions sysvar (`quote.rs`).

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
| Take the stakes | Stakes sit in token accounts owned by the fight's own PDA. They leave by exactly three paths, each naming its recipient: back to the challenger (`cancel_duel`), to the winner (`settle_duel`), or home to both (`refund_duel`). There is no admin withdrawal. |
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
  src/lib.rs          12 instructions, 3 ways out
tests/duel.ts         29 LiteSVM tests against the built binary, real Ed25519 signatures included
tests-web/            the quote layout (pinned against the Rust side), bar selection, market clock, stake sizing
src/                  the Next.js app
  app/f/[duel]/       the fight page and its share card
  app/api/prices      live prices for the stocks a page shows (keys stay on the server)
  app/api/pyth        a boundary's Pyth update, for settling from the browser
  app/api/quote       the oracle's signed quotes for a fight's boundaries
  app/api/crank       the settler, for an external cron
  app/api/faucet      test clusters only: test shares and SOL
  lib/duel.ts         the client half of the program: PDAs, instructions
  lib/oracle.ts       the price for a moment: the exchange's bars, or the pool's, and its signature
  lib/crankTx.ts      a fight's transactions: post, quote + start/settle, close
  data/roster.json    the 1,033 stocks
scripts/
  data/tokens.json    every issuer's tokens, with on-chain mint facts
  build-roster.ts     tokens -> the roster: what a fight can hold and a market can price
  watch-listings.ts   what the issuers publish today that the snapshot does not have
  build-perps.ts      the perpetual market that prices each stock while its exchange is shut
  build-pools.ts      the Solana pool that prices it when there is no perp
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
| `init_config`, `set_paused`, `set_oracle`, `register_asset`, `set_asset` | admin | the stock registry and its sources; pause blocks new fights, never a payout |

**Why the Pyth account is parsed by hand.** `pyth-solana-receiver-sdk` supports Anchor up to 0.31, and this program is on 1.1. The one account type needed is 134 bytes with a fixed layout, so `pyth.rs` reads it directly and checks every field. `scripts/pyth-layout-probe.ts` parses live mainnet and devnet accounts with the same layout, and did so after Pyth's August 2026 Core upgrade.

**Token-2022.** Tokenized stocks are Token-2022 mints. The program uses the token interface throughout, so a fight can pair a classic SPL mint with a Token-2022 one, and refuses the extensions that would stop an escrow paying out: a live transfer hook and non-transferable. A fee-on-transfer mint fails at the stake, because the program checks the escrow received the full amount.

### The app

Next.js 15 on the Stonk Wars look: a fighting-game ring, P1 in cyan, P2 in pink, green and red strictly for price moves, and an orange COOKED stamp for exactly one thing. The picker searches all 1,033 stocks and fetches prices only for what is on screen. On test clusters a **guest wallet** (a keypair in localStorage) and a **faucet** that tops up the two stocks in your fight let someone play within a minute of landing, with no extension and no devnet SOL required.

## Run it

Everything below runs in WSL/Linux with the Solana toolchain (Anchor 1.1.2, Agave 3.1) and Node 24.

```bash
npm install
anchor build                       # programs/duel -> target/deploy/duel.so
cargo test -p duel --lib           # 26 unit tests: parsing, the one-price rule, quotes, the outcome
npm test                           # 29 LiteSVM tests against the binary
npm run test:web                   # 17 tests: quote layout, bar selection, market clock, stake sizing
```

**Real prices at any hour** (surfpool forks devnet; BTC by Pyth, ETH and SOL by the oracle, because crypto never closes):

```bash
surfpool start --network devnet --no-tui --no-deploy
solana program deploy --url localhost --program-id target/deploy/duel-keypair.json target/deploy/duel.so
RPC=http://127.0.0.1:8899 npx tsx scripts/setup-devnet.ts        # 1,033 stocks, oracle, faucet
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
- **Out of hours, the price is not the share's.** While a US stock's own market is open, 4am to 8pm New York time, the oracle reads that market. Outside it, the price comes from the stock's perpetual future on Hyperliquid, which trades every minute of every day, on the same rule the exchange gets: the close of the first one-minute bar at or after the boundary. A perp is not a share, and that is the honest cost of settling at a weekend. It is also the better of the two options we measured: the Solana pools these stocks trade in managed a median of three traded minutes an hour at a weekend, and a fifteen-minute reading of them moved five times as much as the market actually had. A stock with no perpetual market falls back to its pool, read as a trimmed average; one with neither keeps exchange hours, as do all 80 listings outside the US. Each perp market is checked against the stock's own last price before it is used, which is how we caught that the venue's `CL` is crude oil while ours is Colgate-Palmolive. Pyth's equity feeds stop with the market, so the three Pyth-priced stocks keep exchange hours whatever else is open.
- **Thin stocks.** "The first price at or after the boundary" is the first minute with a trade. A stock that does not trade in the bell's minute settles on its next trade, which for a thin ETF can be the next morning.
- **Foreign listings** trade in their own hours. A Hong Kong stock against a US one at the US bell settles on Hong Kong's next trade after it.
- **Scaled amounts and dividends.** Issuers pass on dividends and splits through a `ScaledUiAmount` multiplier, which today runs from 0.07 to 10 across the roster's mints. Prices are the underlying share's, so a stock that goes ex-dividend mid-fight drops by the dividend while its token compensates holders; a mainnet build must also apply the multiplier when it values and sizes stakes. The test shares have none.
- **Issuer powers.** Every issuer can freeze an account; all but Ondo can move tokens out of any account (a permanent delegate) and pause transfers. A fight inherits those powers over the tokens it holds, and nothing on top can remove them.
- **Who can hold tokenized stocks.** Issuers generally offer them to non-US persons only. The live demo runs on devnet with test shares that stand in for them, and real market prices. Know the rules where you live.

## Disclaimer

Stonk Wars is a demonstration of peer-to-peer escrow on Solana. Nothing here is financial, investment, gambling or legal advice.
