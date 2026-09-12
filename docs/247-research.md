# 24/7 trading and pricing of tokenized stocks

Research for Stonk Wars. Everything below was checked on **2026-09-12**, a Saturday,
between 05:30 and 06:10 UTC, with every US and European exchange shut. Dates in
brackets are when the source was published; where I hit an API myself I say so and
give the time.

## The short version

1. **Backed/xStocks, the biggest issuer, is still 24/5**, and I confirmed it from
   their own API this morning: 632 of 732 assets report
   `tradingHoursMode: TwentyFourFive`, all 732 report `currentPeriod: closed`, and
   they reopen Sunday 20:00 New York. Ondo is the one issuer change: since
   2026-06-25 it mints and redeems 24/7 for **six** tokens (SPYon, QQQon, CRCLon,
   NVDAon, TSLAon, GOOGLon), but that is a primary market, not an order book.
2. **Saturday order books do exist, and they are thin.** Kraken Pro put ten xStocks
   on 24/7 trading on 2025-12-03; as of 05:59 UTC today exactly **12 of 177** pairs
   were `online` and 165 were `post_only`. TSLAx and QQQx are in the 12; VOOx is not.
   Backpack runs a Solana-native weekend book on four tickers, quoting SPCX at 0.7
   basis points and then trading **nothing for three straight hours** this morning.
   Bitget runs a weekend session on 90 rTokens with an explicit ±20% band and
   internally provided, self-described "indicative" prices. Real venues, real quotes,
   almost no flow. None of them are open to US persons.
3. **Nothing regulated trades US equities overnight on an exchange, and nothing at all
   trades weekends.** Every venue is converging on one date: **Sunday 2026-12-06**,
   when the SIPs extend to 21:00 Sunday through 20:00 Friday ET. Nasdaq, Cboe EDGX,
   NYSE Arca and 24X all have approvals conditioned on that. Weekends are not on
   anyone's roadmap.
4. **Every oracle that publishes equities around the clock wants real money.** Pyth
   moved extended-hours equity data behind Pyth Pro at $5,000/month on 2026-06-15 and
   killed free Core access on 2026-07-31. Chainlink Data Streams is $150/month per
   feed with no free tier. Stork and RedStone are contact-sales. There is no cheap
   oracle answer.
5. **But there is a free answer, and it is better than what the app uses now.**
   Hyperliquid's HIP-3 equity perps trade genuinely 24/7 with real size, and the
   public API is unauthenticated and free. This morning `xyz:NVDA` had done
   **$30.1M** in 24 hours and printed a candle in **60 of 60** minutes of the
   04:00 UTC hour. The pinned Solana pools the app reads managed a **median of 3
   traded minutes per hour** in the deep weekend.
6. **The current off-hours price is mostly noise.** Over the same fifteen weekend
   minutes, the app's pool rule moved a median of **0.129%** while the actual market
   moved **0.018%**. Across eight stocks that is **6 of 21 pairwise fights decided
   differently** depending on which source you read. That is the finding that matters
   most, and it is a bigger problem than the fact that only 23 stocks qualify.

---

## 1. Issuer venues and their real hours

"24/7" is used by issuers to mean three different things. Keep them apart:

- **(a) primary market**: hours you can mint or redeem with the issuer.
- **(b) issuer venue**: hours the issuer's own book or app matches orders.
- **(c) transferability**: the token moves on chain at any hour. This is true of
  every SPL token ever minted and means nothing about price discovery.

Most "24/7 tokenized stocks" headlines are describing (c).

| Issuer / venue | Primary market (mint/redeem) | Own trading venue | Weekend? | Chain | Source and date |
|---|---|---|---|---|---|
| **Backed / xStocks** | 24/5, closed Fri 20:00 to Sun 20:00 ET | none of its own | **No** at the issuer | Solana + many | `api.backed.fi/api/v2/public/assets`, read 2026-09-12 05:35 UTC |
| **Kraken Pro** (xStocks distributor) | n/a | **24/7 spot book, 10 names phase one** | **Yes** | Solana | [Kraken blog, 2025-12-03](https://blog.kraken.com/product/xstocks/24-7-on-kraken-pro); pair status read from `api.kraken.com` 2026-09-12 05:59 UTC |
| **Kraken xStocks perps** | n/a | 24/7 perpetual futures, up to 20x | **Yes** | n/a | [Kraken blog, 2026-02-24](https://blog.kraken.com/product/xstocks/tokenized-equity-perpetual-futures) |
| **Ondo Global Markets** | **24/7 instant mint and redeem for six tokens** (SPYon, QQQon, NVDAon, TSLAon, GOOGLon, CRCLon); **24/5 for the rest** | primary only, no book | **Yes**, for those six | Solana, Ethereum, BNB | [Ondo, 2026-06-25](https://ondo.finance/blog/real-24-7-trading-for-tokenized-stocks) |
| **Backpack Securities** | RFQ sessions Sun 20:00 to Fri 20:00 ET | **weekend order book Fri 20:00 to Sun 20:00 ET**, market makers quoting | **Yes**, 4 tickers | **Solana** (via Sunrise) | [Backpack weekend trading docs](https://support.backpack.exchange/backpack-securities/weekend-stock-trading.md); books read live 2026-09-12 |
| **Bitget rTokens** | n/a | **weekend session opens Sat 08:00 UTC+8**, runs to the Monday US open | **Yes**, 90 rTokens | exchange book, off chain | [Bitget rToken FAQ, 2026-08-26](https://www.bitget.com/asia/amp/academy/bitget-rtoken-faq) |
| **Binance bStocks** | n/a | 24/7 spot book | **Yes** | BNB Chain | [Binance announcement, 2026-06-11](https://www.binance.com/en/support/announcement/detail/2c0c92ed15ac42d1b14bb1eac00d22bb) |
| **Dinari** | Regular, Extended, Overnight, plus **"Open (24/7)" Fri 20:00 to Sun 20:00 ET, limit only, blockchain only** | broker-dealer order acceptance | **Yes**, 9 tickers | 7 EVM chains, **no Solana** | [Dinari trading hours](https://docs.dinari.com/docs/trading-hours), updated 2026-08-19 |
| **Coinbase tokenized equities** | AP only, window not published | **none**, Coinbase is the issuer; every listed venue is a DEX | category (c) only | Base | [base.org/stocks](https://www.base.org/stocks), read 2026-09-12 |
| **Robinhood EU stock tokens** | Mon 02:00 to Sat 02:00 CET | own venue, 24/5 | **No** | Arbitrum / Robinhood Chain | [Robinhood EU support](https://robinhood.com/eu/en/support/articles/about-stock-tokens/), read 2026-09-12 |
| **Gemini** | n/a | "24 hours a day, 5 days a week" | **No** | Arbitrum, minted by Dinari | [Gemini blog, 2025-07-31](https://www.gemini.com/blog/geminis-next-batch-of-tokenized-stocks-includes-amd-reddit-and-gamestop) |
| **Superstate Opening Bell** | **no venue at all**: "investors cannot trade directly on Superstate" | none | category (c) only | Solana, Ethereum, Linea | [Superstate docs](https://docs.superstate.com/investors/tokenized-equities) |
| **Securitize** | daily NAV subscription; ACRED exit is a **quarterly 5% repurchase offer** | ATS hours **not published** | not verified | Solana, Avalanche + 4 | [SEC Form N-23C3A, 2025-03-27](https://www.sec.gov/Archives/edgar/data/1676197/000119312525067188/d924108dn23c3a.htm) |
| **Gate gStocks** | n/a | "24/7 round-the-clock" (marketing level only) | claimed yes | multiple | [Gate listing, 2026-07-03](https://www.gate.com/announcements/article/100484) |
| **Swarm** | acquired by Inveniam, deal closed 2026-02-24; still operating | hours not verified | not verified | Polygon, Base, Hedera | [PRNewswire](https://www.prnewswire.com/news-releases/swarm-to-be-acquired-by-inveniam-to-launch-full-stack-platform-for-agentic-asset-management-302636030.html) |
| **Remora Markets** | **dead** | none | no | Solana | wind-down; domain DNS timed out 2026-09-12 |

**None of the weekend venues above are open to US persons.** Backed, Backpack,
Bitget, Kraken, Binance and Coinbase are all Reg S or equivalent. Dinari serves US
customers but its US tokens are non-transferable, and its weekend session is
"blockchain only", which appears to exclude them; Dinari does not state the
intersection anywhere, so that is an inference.

Three corrections to assumptions worth carrying into the repo:

- **Issuer hours are not distributor hours.** Backed issues 24/5 but Kraken Pro
  trades ten xStocks 24/7. The repo's note about `TwentyFourFive` is right about
  Backed and incomplete about the ecosystem.
- **Ondo's 24/7 is six tokens, not all of them.** The launch named SPYon, QQQon,
  CRCLon, NVDAon, TSLAon and GOOGLon. Everything else remains Sunday 20:00 to Friday
  20:00 ET.
- **Coinbase's "B20" is a token standard, not twenty tokens.** Ten Coinbase
  tokenized stocks are live (NVDAc, METAc, AAPLc, GOOGLc, AMZNc, MSFTc, MSTRc, SNDKc,
  SPCXc, TSLAc), and Coinbase runs no venue for them at all.

### Backed / xStocks, verified against their own API

I paged the whole public asset list this morning (8 pages, 732 assets, read
2026-09-12 05:35 UTC). The `tradingHoursMode` field the app already reads is still
there and still says what it said:

| `tradingHoursMode` | count |
|---|---|
| `TwentyFourFive` | 632 |
| `Regular` | 87 |
| `MarketHours` | 10 |
| `Always` | 1 |
| absent | 2 |

Three things worth knowing beyond the headline value:

- **Every single asset reported `currentPeriod: "closed"`** at the time of reading.
  651 of them carry `nextChangeAt: 2026-09-14T00:00:00.000Z`, which is Sunday 20:00
  New York: the classic 24/5 week. The 79 Hong Kong listings carry
  `2026-09-14T01:00:00.000Z`, which is the HKEX Monday open.
- **There are two modes the app may not know about.** `MarketHours` (10 assets, for
  example MDLNx) is stricter than `TwentyFourFive`: its `overnight` order cap is 0
  while `extended` is still $10M. So some xStocks trade pre and post market but not
  overnight.
- **The single `Always` asset is a red herring.** BTBTx reports
  `tradingHoursMode: "Always"` and `openNow: true`, but its `currentPeriod` is
  `closed` and its `closed.maxOrderFiatValue` is `0`, same as everything else. So it
  is not actually tradeable at the issuer right now either. I would not treat
  `Always` as a seven-day flag without asking Backed what it means.

Also note the size caps differ by session, which is a decent proxy for how much
liquidity the issuer expects: `market` and `extended` allow up to $10,000,000 per
order, `overnight` allows $1,000,000, and `closed` allows $0.

**Verdict: the note in the repo is still accurate. Backed has not moved to seven-day
trading.**

### Kraken, the actual weekend venue

Kraken Pro announced 24/7 xStocks trading on **2025-12-03**, "including on weekends
and public holidays", starting with ten names: TSLAx, QQQx, SPYx, NVDAx, CRCLx,
AAPLx, HOODx, MSTRx, GLDx and GOOGLx. Not available to US persons.

Kraken's **public** REST API exposes tokenized assets under an asset class the docs
barely mention. `GET /0/public/AssetPairs?aclass=tokenized_asset` returns 177 unique
USD pairs, no key needed. Read at **2026-09-12 05:59 UTC** the `status` field said:

- **`online` (12):** AAPLx, CRCLx, GLDx, GOOGLx, HOODx, MSTRx, NVDAx, QQQx, SKHYx,
  SPCXx, SPYx, TSLAx
- **`post_only` (165):** everything else, including VOOx, AMZNx, METAx, MSFTx, AMDx

That is a free, live, weekend-accurate answer to "which tokenized stocks are really
tradeable right now", and it is a much better liquidity gate than a 24-hour volume
snapshot taken once. It is also a striking coincidence that Kraken's weekend list
is twelve names and the app's pool list is twenty-three.

**The catch:** Kraken's market data endpoints refused every request for those pairs
from this machine. `OHLC`, `Depth` and `Trades` returned `EGeneral:Invalid
arguments` and `Ticker` returned `EQuery:Unknown asset pair`, for both the altname
(`TSLAxUSD`) and the internal key (`TSLASPVUSD`), with and without `aclass`. The
reference data is public; the prices are not, at least not from here. I could not
determine whether that is geo-blocking (xStocks are barred to US persons) or a
permanent restriction. See "what I could not verify".

---

## 2. Weekend trading: who actually trades on a Saturday

**Yes. Several venues genuinely match orders on a Saturday.** But the sizes are very
different, and the biggest by far is not a tokenized-stock venue at all.

Ranked by how much real size changes hands, measured this morning.

| Venue | What it is | Weekend? | Measured activity, Sat 2026-09-12 |
|---|---|---|---|
| **Hyperliquid HIP-3 `xyz`** | equity perps deployed by trade[XYZ] | Yes | **$1.99bn** 24h notional across 104 live markets: SP500 $171.9M, CRCL $34.0M, NVDA $30.1M, TSLA $16.9M |
| **Bitget rTokens** | exchange book, 90 rTokens | Yes | rAAPL quoting ~8.7bps; hourly turnover rAAPL $29 to $231, rNVDA $2,350 to $10,467 |
| **Backpack Securities** | **Solana-native** weekend spot book | Yes, 4 tickers | SPCX.US 0.7bps spread, $25.7k 24h, 20 trades; MU.US $15.4k; SNDK.US $4.8k; SKHY.US $225 |
| **Backpack `.US` perps** | perps beside the spot books | Yes | MU $613k, AAPL $492k, SPCX $451k, HOOD $386k, SPY $366k, NVDA $288k |
| **Kraken Pro xStocks** | spot book on the actual tokens | Yes | 12 of 177 pairs `online`; **size not measurable from here** |
| **Binance bStocks** | 24/7 spot book | Yes | not measured |
| **Ondo, Dinari** | primary market only | Yes, partly | mint and redeem, no book |
| **Solana DEX pools** | AMM pools on the tokens | Yes, technically | **median 3 traded minutes per hour** in the deep weekend; 3 of 8 sampled pools traded nothing at all in a full hour |
| **Any regulated US exchange** | | **No** | zero, and not approved |

Two things stand out.

**Weekend quotes are tight and weekend flow is not there.** Backpack's SPCX book was
quoting a 0.7 basis point spread, which is better than most crypto pairs, and then
traded **nothing for three consecutive hours** on Saturday morning
(`$23,178 / $2,115 / $0 / $0 / $0 / $420` across six hourly buckets). Market makers
will quote you a price; almost nobody is hitting it. That is the whole character of
the tokenized-stock weekend.

**Perps are where the weekend volume is, by one to two orders of magnitude.**
Backpack's own `.US` perps did 10x to 100x their matching spot books. Hyperliquid's
`xyz` did 50x Backpack's perps. For market-wide scale, one secondary estimate
([Gokhshtein, 2026-09-10](https://gokhshtein.com/news/2026-09-10-tokenized-stocks-trade-141b-during-895-hour-traditional),
sourced to CoinGecko and DefiLlama) puts Labor Day weekend tokenized-stock volume at
**$1.01bn across Saturday and Sunday**: Robinhood Chain $572.8M, Binance bStocks
$303.5M, xStocks $87.1M, Ondo GM $43.8M. That is overwhelmingly DEX volume, not venue
order books, and it is a fraction of what one HIP-3 dex does in equity perps alone.

**How the professionals price a weekend.** Worth noting, because it validates the
recommendation below. Bitget says weekend liquidity is "provided internally by
Bitget" and its prices are explicitly "indicative", informed by Friday's close,
market-maker quotes and Bitget's own supply and demand, with a **±20% limit-order
band**. Kraken says market makers use "ATS platforms, index futures, and internal
models". Coinbase's INTX is the most explicit: during regular hours its index uses
"direct equity feeds from Pyth and Blue Ocean ATS", and over the weekend it "relies
on an internal index built from a 1-hour exponential moving average (EMA) of the
contract's mark price, combined with tokenized equity feeds when available (e.g.
AAPLx xStock)". In other words, **the serious venues price the weekend off the perp
mark and treat the tokenized spot price as a secondary input.** That is the opposite
of what Stonk Wars does today.

One more design detail worth stealing or avoiding: Coinbase's Base tokenized stocks
sit on DEXes with a Chainlink feed that is **24/5 and holds the last close through
the weekend**, so the AMM price floats freely against a frozen oracle all weekend
with no circuit breaker. That is the failure mode of pricing a token pool against a
stale reference, and it is the same shape as the gap measured in section 5c.

Backpack also exposes `/api/v1/market-sessions` and `/api/v1/market-holidays`
publicly, which is a clean way to gate a UI on real session state instead of
hardcoding a clock.

---

## 3. Regulated 24-hour equity markets

**Nothing regulated trades US equities overnight on an exchange today, and nothing
regulated trades weekends at all.** The whole industry is queued behind one date.

### The date to build around: Sunday 2026-12-06

The gate is the consolidated tape. Every overnight approval is conditioned on the
SIPs being able to disseminate quotes and trades outside 04:00 to 20:00 ET, and the
SIPs are not there yet.

- SIP Operating Committees filed the plan amendment **2025-12-19**.
- SEC approved it **2026-06-26** (CTA/CQ Release 34-105779, UTP Release 34-105780),
  published in the Federal Register **2026-07-01**.
- Announced operating window from **2026-12-06**: **21:00 ET Sunday through 20:00 ET
  Friday**, with a one-hour maintenance window 20:00 to 21:00 ET each evening. That
  is 23x5. **No weekend SIP operation is approved or scheduled.**
- Still on track as of **UTP Vendor Alert #2026-24, dated 2026-08-12**.
- Plumbing already live: NSCC extended clearing to 24x5 on **2026-06-29**. FINRA TRF
  hours extend on **2026-12-06**.

### Venue by venue

| Venue | Status today | Hours today | Overnight plan | Go-live |
|---|---|---|---|---|
| **24X National Exchange** | **LIVE**, day session only | 04:00 to 20:00 ET weekdays | 21:00 to 04:00 ET, Sun to Fri | **2026-12-06** target |
| **Nasdaq** | approved, not live | 04:00 to 20:00 ET | Night Session 21:00 to 04:00 ET, Sun to Thu | **2026-12-06** target |
| **Cboe EDGX** | approved, not live | 04:00 to 20:00 ET | 21:00 to 04:00 ET | **2026-12-06**, 21:00 ET |
| **NYSE Arca** | approved, not live | 04:00 to 20:00 ET | 21:00 to 04:00 ET | **2026-12-06** |
| **MEMX** | filed 2026-09-09 | 04:00 to 20:00 ET | 23x5 | not set |
| **Blue Ocean ATS** | **LIVE** | 20:00 to 04:00 ET, **Sun to Thu** | already running | **no weekends**, not filed |
| **Bruce ATS, MOON ATS** | **LIVE** | 20:00 to 04:00 ET, Sun to Thu | already running | no weekends |
| **Texas Stock Exchange** | live, no overnight | 08:00 to 17:00 ET | none | n/a |
| **NYSE tokenized 24/7 venue** | **announced only** | n/a | "24/7", "subject to regulatory approvals" | **no date, no SEC filing found** |

Details worth carrying:

- **24X** launched **2025-10-14** as the first SEC-approved 23/5 exchange, but only
  its day session is running. Its own FAQ page still shows a stale September 2025
  go-live date, so do not trust it. On **2026-08-07** the SEC granted 24X conditional
  exemptive relief (Release 34-106061) to start overnight without the SIP, but only
  as a backstop: the relief becomes effective **2027-01-24** and only if the SIPs miss
  **2026-12-06** and stay missed past **2027-01-24**. In practice 24X gets no early
  start. If that relief ever does bite, it obliges 24X to publish a proprietary feed
  **free of charge**, which would be the first free overnight feed in existence.
- **Nasdaq's tokenized-securities pilot is real and approved** (SR-NASDAQ-2025-072,
  approved **2026-03-18**, Release 34-105047), riding a DTC no-action letter dated
  **2025-12-11**. But it is a *settlement* option, not a new market: tokens must be
  fully fungible with ordinary shares, same ticker, same CUSIP, and trade on the
  **same order book with the same priority**. It does not add an hour of trading.
  DTCC ran production tokenized trades on **2026-07-15**; commercial launch targeted
  October 2026.
- **The NYSE 24/7 tokenized venue is announced only.** ICE's release of
  **2026-01-19** describes 24/7 operation and instant settlement, but says the
  platform is in development and "subject to regulatory approvals". No Form 1, no
  Form ATS-N, no 19b-4 was found. Do not plan around it.
- **The SEC roundtable on 24-hour trading is confirmed for 2026-09-17**, five days
  from now (Press Release 2026-69, dated 2026-07-23; agenda 2026-83, dated
  2026-09-01). The Division of Trading and Markets staff memo dated **2026-09-10**
  reports that in August 2026 the overnight session was **0.9% of total NMS share
  volume**, averaging 144.6 million shares a day, up 359% year over year. It also
  notes that Sunday-evening trades are **never publicly disseminated at all**.

### Can any of them feed a hobby project?

Not overnight, not today. Per-user non-professional exchange fees are trivially
cheap ($0.10 to $3 a month), but the distributor licence is $500 to $2,500 a month,
which is the actual barrier. No US exchange offers a free public real-time API.

Cheapest routes found:

| Source | Cost | Covers overnight? |
|---|---|---|
| IEX delayed feeds | free | no, IEX has no overnight |
| Alpaca free tier | $0, IEX-only | no |
| **Blue Ocean via Tiingo** | ~$39/month all in | **yes**, cheapest real overnight feed |
| Alpaca Algo Trader Plus | $99/month, full SIP | will, once the SIP extends |
| Chainlink Data Streams | $150/month **per feed**, no free tier | yes, 24/5 |
| Pyth Pro US Equities | $5,000/month | yes, plus 24/7 indices |
| CTA consolidated tape | $1/month non-pro cap | **yes, from 2026-12-06** |

**None of these cover a weekend, because no regulated venue trades on a weekend.**

---

## 4. Oracles with out-of-hours equity prices

| Oracle | Equities? | Hours | On Solana? | Cost | Verified |
|---|---|---|---|---|---|
| **Pyth Core** | yes | **stops with the market**: weekdays 04:00 to 20:00 ET plus overnight 20:00 to 04:00 Sun-Thu. **No Friday 20:00 to Sunday 20:00.** | yes, sponsored push feeds on mainnet and devnet | Free tier is **view-only, no API rights**; Starter $500/mo is **crypto only**; Pro from $2,500/mo | docs.pyth.network market hours; pricing page read 2026-09-12 |
| **Pyth Pro (US Equities)** | yes | extended hours and overnight | via Pro API | **$5,000/month** | [Pyth, 2026-06-12](https://www.pyth.network/blog/extended-hours-us-equity-data-moves-to-pyth-pro) |
| **Pyth Indices** | **yes, genuinely 24/7 including weekends** | continuous | not confirmed | not published; appears to be Pro | [Pyth, announced 2026-06-10](https://www.pyth.network/blog/24-7-finance-needs-24-7-price-infrastructure-introducing-pyth-indices) |
| **Chainlink Data Streams (24/5 US Equities)** | yes, all major US single names and ETFs | **24/5**. Pre, regular, post and overnight. Chainlink's own docs: weekends are not covered because "there is currently no trading activity in traditional markets over the weekend on any venue" | Solana verifier exists; Streams Trade lists EVM chains only | **$150/month per feed**, no free tier, self-serve | [Chainlink, 2026-01-20](https://chain.link/blog/chainlink-24-5-us-equities-streams); docs.chain.link |
| **Switchboard** | no prebuilt equity feeds found | n/a | **yes, Solana-native** | ~20,000 to 100,000 lamports per update; **permissionless custom feeds** | docs.switchboard.xyz |
| **RedStone** | tokenized funds and RWAs; equity coverage not documented publicly | not documented | yes, live on Solana since 2025-05-28 | **contact sales**, no public pricing | docs.redstone.finance |
| **Stork** | yes: TSLA, CRCL, NVDA, MSTR plus gold, silver, WTI, Brent | **24/7**, switching to a perpetual-swap feed on nights, weekends and holidays | yes, listed among 70+ chains | **contact sales only**; REST API returned `401 user not authenticated` | [The Block, 2026-05-13](https://www.theblock.co/post/401053/stork-24-7-price-discovery); docs.stork.network |
| **Chaos Labs Edge** | not found; crypto and perps focus | n/a | yes, powers Jupiter perps | not published | chaoslabs.xyz |

### Three things this table says

**One: Pyth's equity feeds stopping at the weekend is not a bug you can pay around
cheaply.** The exact schedule from Pyth's own docs is regular 09:30 to 16:00 ET,
pre-market 04:00 to 09:30, after-hours 16:00 to 20:00, and overnight **Sunday to
Thursday** 20:00 to 04:00. So TSLA, QQQ and VOO could in principle fight on a
Tuesday night today, if the app let them, but never on a Saturday. The Friday 20:00
to Sunday 20:00 hole is real and permanent on Core.

**Two: Pyth Indices are the product that would fix this, and I could not price
them.** Announced **2026-06-10**, they are "proprietary 24/7 products", explicitly
including single-asset indices for NVDA, TSLA, AAPL, MSFT, GOOGL, INTC, HOOD, MSTR
and CRCL, running continuously including weekends. Neither the launch post nor the
pricing page says which plan they need or whether they land on Solana as
`PriceUpdateV2` accounts. Given the $5,000/month equities tier, assume they are not
free until someone at Pyth says otherwise.

**Three: there is a free path, but it does not go through an oracle network.**
It goes through Switchboard, which is Solana-native, permissionless, and lets you
define a custom feed whose job fetches an arbitrary endpoint, runs it in a TEE, and
produces a signature verified on chain, for lamports per update. Switchboard does
not have an equity feed to sell you. What it has is a way to turn any public price
source into an attested on-chain price without a trusted key. Which raises the
question of what source to point it at, and that is section 5.

### A flag on the app's current Pyth setup

The README says "Pyth's free plan grants three US equity feeds". The pricing page
today (read 2026-09-12) describes the Free plan as **"View-only access through Pyth
Terminal (no API permissions)"** with **"No display, non-display, or redistribution
rights"**, and the Core upgrade post of **2026-05-26** says "accessing any Pyth Price
Feeds API will require a Pyth data plan, which start at $500 per month". Those two
statements cannot both be true of a working deployment. Either the account is on a
grandfathered or grant arrangement, or the terms have moved underneath it. Worth
checking before mainnet, because it is a licensing question as much as a technical
one. I did not test the deployment's key and cannot say which it is.

---

## 5. What actually trades overnight and at weekends, measured

This is the section that should change the design.

### 5a. The pinned Solana pools

Sampled from the free GeckoTerminal API against the pools in `src/data/pools.json`,
one request every 3.5 seconds, 48 requests, 8 pools, five windows. All UTC. Counts
are distinct traded minutes, verified against the raw `/trades` endpoint (the
returned candle count really does equal traded minutes: zero zero-volume candles,
and for BRK.B 12 trades collapsed to exactly 9 distinct minutes matching 9 candles).

| Ticker | liquidity $ | Sat 02-03 | **Sat 11-12 (prev week)** | Sat 04-05 | Fri 02-03 | Fri 16-17 (in hours) |
|---|---:|---:|---:|---:|---:|---:|
| SPY | 2,873,690 | 60 | **3** | 60 | 60 | 60 |
| CRCL | 2,190,525 | 12 | 13 | 10 | 41 | 54 |
| NVDA | 2,140,473 | 60 | **5** | 55 | 41 | 60 |
| TSLA | 2,117,967 | 43 | **7** | 37 | 33 | 50 |
| COIN | 939,172 | 9 | **0** | 4 | 10 | 13 |
| MSTR | 715,949 | 13 | **3** | 54 | 43 | 25 |
| BRK.B | 119,945 | 9 | **0** | 13 | 46 | 32 |
| KO | 115,466 | 33 | **0** | 45 | 48 | 60 |
| **median** | | **23** | **3** | **41** | **42** | **52** |

The middle column is the one that matters. Saturday 02:00 to 03:00 UTC is really
Friday night, six hours after the close, and it still looks healthy. Six hours later,
in the actual weekend trough, the median pool trades **three minutes an hour** and
three of eight pools trade **nothing at all in a full hour**. Even SPY, the deepest
pool in the file at $2.87M, managed three minutes.

And the prints that do arrive are not tight. Price range across the hour, min low to
max high:

| Ticker | Sat 02-03 | Sat 04-05 | Fri 02-03 | **Fri 16-17 (in hours)** |
|---|---:|---:|---:|---:|
| SPY | 1.50% | 1.71% | 2.42% | **1.77%** |
| MSTR | 0.78% | 1.37% | 1.61% | **1.64%** |
| KO | 2.20% | 2.23% | 2.68% | **2.56%** |
| BRK.B | 0.55% | 0.81% | **2.85%** | **1.65%** |

**Overnight pool ranges are as wide as or wider than in-hours ranges, on a fraction
of the trades.** That is the definition of noise. SPY printed a 2.42% range across
one overnight hour against 1.77% during the cash session.

### 5b. Hyperliquid HIP-3 equity perps

HIP-3 launched on **2025-10-13** and lets builders deploy their own perp markets on
Hyperliquid's shared book. trade[XYZ] is the dominant deployer. I enumerated every
HIP-3 dex through the public API at **05:49 UTC** today.

There are 11 perp dexes. Only `xyz` has meaningful equity volume: `flx`, `km`,
`mkts` and `cash` list equity tickers with **zero** 24-hour volume and zero open
interest, so their marks are stale and must not be used. `xyz` had **104 markets
with nonzero volume** and **$1.99bn** of 24-hour notional, on a Saturday.

| Market | 24h notional $ | Mark | Open interest (base) |
|---|---:|---:|---:|
| xyz:SP500 | 171,881,332 | 7,658.4 | 51,699 |
| xyz:CRCL | 34,000,196 | 90.922 | 1,267,944 |
| xyz:NVDA | 29,667,333 | 219.07 | 512,987 |
| xyz:META | 28,329,324 | 648.27 | 73,962 |
| xyz:INTC | 27,323,118 | 103.10 | 581,405 |
| xyz:HOOD | 26,815,951 | 112.14 | 477,854 |
| xyz:AAPL | 21,683,011 | 332.84 | 252,524 |
| xyz:GOOGL | 20,609,388 | 339.04 | 300,927 |
| xyz:TSLA | 16,945,292 | 365.02 | 113,606 |
| xyz:MSTR | 15,445,902 | 130.99 | 294,408 |
| xyz:MSFT | 8,708,499 | 494.56 | 48,871 |
| xyz:AMD | 8,336,973 | 517.42 | 28,560 |
| xyz:COIN | 6,205,740 | 175.35 | 70,785 |
| xyz:AMZN | 4,020,804 | 256.66 | 88,200 |
| xyz:PLTR | 3,986,691 | 167.43 | 65,392 |
| xyz:GME | 922,771 | 21.10 | 121,589 |
| xyz:NFLX | 431,890 | 77.09 | 60,333 |

For scale: the deepest Solana pool in `pools.json` shows $11.8M of 24-hour volume
(SPY) and most show $0.3M to $3M. `xyz:NVDA` alone did $30M, and it did it on a
Saturday.

**These marks track the real share price.** Against the last real print from the
app's own market data source (Friday 23:59 UTC, which is 19:59 New York):

| Ticker | HL mark | last real print | difference |
|---|---:|---:|---:|
| AMZN | 256.66 | 256.70 | -0.02% |
| CRCL | 90.922 | 90.90 | +0.02% |
| GME | 21.10 | 21.10 | 0.00% |
| PLTR | 167.42 | 167.39 | +0.02% |
| TSLA | 364.99 | 365.25 | -0.07% |
| MSFT | 494.56 | 494.89 | -0.07% |
| AAPL | 332.86 | 332.55 | +0.09% |
| HOOD | 112.15 | 112.25 | -0.09% |
| NVDA | 219.07 | 218.26 | +0.37% |
| MSTR | 130.99 | 130.50 | +0.38% |

Worst case 0.38%, median about 0.09%, and some of that is real Friday-night news
rather than error.

**And the candles never have a hole.** Hyperliquid emits a one-minute candle for
every minute whether or not anything traded. I checked the thinnest equity market I
could find, `xyz:NFLX`, over the 03:00 to 04:00 UTC Saturday hour: **61 candles, 0
timestamp gaps, 20 trades total, 51 minutes with `n: 0`**. A zero-trade minute
repeats the last traded price with `v: 0.0`, so it is honest about itself but always
present. Across NVDA, TSLA, MSFT, SP500, GME and NFLX, in the weekend hour, the US
open hour and the weekday overnight hour, the count was **60 candles out of 60 in
every single case**. A fight can never be stranded by a missing minute.

| Market | window | candles | trades | hour range | median abs 15-min move |
|---|---|---:|---:|---:|---:|
| xyz:NVDA | Sat 03-04 (weekend) | 60 | 567 | 0.041% | 0.0183% |
| xyz:NVDA | Fri 17-18 (US open) | 60 | 930 | 0.201% | 0.0548% |
| xyz:TSLA | Sat 03-04 | 60 | 110 | 0.019% | 0.0055% |
| xyz:TSLA | Fri 17-18 | 60 | 693 | 0.447% | 0.1530% |
| xyz:MSFT | Sat 03-04 | 60 | 73 | 0.049% | 0.0061% |
| xyz:SP500 | Sat 03-04 | 60 | 245 | 0.022% | 0.0078% |
| xyz:GME | Sat 03-04 | 60 | 40 | 0.176% | 0.0617% |
| xyz:NFLX | Sat 03-04 | 60 | 12 | 0.086% | 0.0143% |

### 5c. The comparison that should decide this

Same eight stocks, same two boundaries, 04:45 and 05:00 UTC on Saturday
2026-09-12, fifteen minutes apart. Left: the app's rule today, a trimmed mean of up
to fifteen one-minute pool closes from the preceding hour. Right: the Hyperliquid
perp's one-minute close.

| Stock | pool start | pool end | **pool move** | bars | perp start | perp end | **perp move** |
|---|---:|---:|---:|:--:|---:|---:|---:|
| NVDA | 219.6800 | 220.1755 | **+0.226%** | 15/15 | 219.03 | 219.03 | **+0.000%** |
| TSLA | 365.1129 | 365.0610 | **-0.014%** | 15/15 | 365.08 | 365.07 | **-0.003%** |
| MSFT | 496.9134 | 496.4818 | **-0.087%** | 15/15 | 494.60 | 494.44 | **-0.032%** |
| CRCL | 90.8137 | 91.0080 | **+0.214%** | 13/10 | 90.956 | 90.948 | **-0.009%** |
| MSTR | 131.4157 | 131.2465 | **-0.129%** | 15/15 | 131.13 | 131.07 | **-0.046%** |
| COIN | 174.3406 | **none** | **n/a** | 5/**4** | 175.39 | 175.37 | **-0.011%** |
| HOOD | 113.5725 | 114.0543 | **+0.424%** | 7/6 | 112.25 | 112.23 | **-0.018%** |
| GME | 21.1306 | 21.1350 | **+0.021%** | 13/13 | 21.062 | 21.055 | **-0.033%** |

- Median absolute 15-minute move: **pool 0.129%, perp 0.018%.** The pool shows seven
  times more movement than the market had.
- Median disagreement between the two: **0.083%**, which is **4.6 times larger than
  the real median move**. The error is bigger than the signal.
- **6 of the 21 pairwise fights (29%) would be won by a different stock** depending
  on which source you read.
- **COIN could not be priced at all** at the second boundary: 4 traded minutes in the
  hour, below the `OFFHOURS_MIN_BARS` floor of 5, so it falls through to the exchange
  and the fight strands until Monday. This is the deepest-but-one thinnest pool in
  the sample at $939k of liquidity, comfortably above the $100k floor.
- Levels drift too, not just moves. Median absolute gap between the pool price and
  the perp price at the same instant: **0.311%**, worst **1.178%** (HOOD). A fight
  that starts in market hours on the exchange and ends off hours on the pool eats
  that gap as a fake move.

**Read plainly: the trimmed mean is doing its job (it is hard to push) and still
producing the wrong answer, because the underlying pool prints are too sparse and
too wide for the thing being measured.** Fifteen minutes of weekend price action is
about two basis points. The pool cannot see two basis points.

### 5d. What it would cost to read Hyperliquid

The public info endpoint at `https://api.hyperliquid.xyz/info` is unauthenticated,
free, and documented. Rate limit is **1,200 weight per minute per IP**. A generic
info request is weight 20, and `candleSnapshot` adds 1 per 60 items returned, so a
60-candle pull is about 21 weight: roughly **57 pulls a minute** from one IP. That
is far more headroom than GeckoTerminal's roughly 30 calls a minute, and the app
already caches by boundary.

One real limit: **one-minute history is short**. Measured today, a one-minute
`candleSnapshot` returned data 1 and 3 days back and **empty at 7, 14 and 30 days**.
Coarser intervals reach further: 5m at 14 days, 15m at 30 days, 1h at 60 days, 1d
back to February 2026. The app's `MAX_LOOKBACK_SECS` is 29 days, so a settler more
than about three days late could not reconstruct a minute price from Hyperliquid.
Given that a fight refunds after a week and a start more than five days late is void,
this is a narrow but real gap.

---

## 6. What changed recently

Chronologically, the things that did not exist when this design was chosen.

| Date | What |
|---|---|
| 2025-10-13 | **HIP-3 goes live** on Hyperliquid, letting builders deploy perp markets. trade[XYZ] launches 24/7 US equity perps shortly after. By 2026 HIP-3 is roughly half of Hyperliquid's daily perp volume. |
| 2025-12-03 | **Kraken Pro puts xStocks on 24/7 trading**, phase one of ten names including TSLAx and QQQx. |
| 2025-12-11 | SEC no-action letter enables the **DTC tokenization pilot**. |
| 2026-01-19 | ICE announces an **NYSE tokenized securities platform** with 24/7 operation. Announced only, no filing. |
| 2026-01-20 | **Chainlink launches 24/5 US equities Data Streams**, pre, regular, post and overnight, across 40+ chains. |
| 2026-02-24 | **Kraken launches xStocks perpetual futures**, 24/7, up to 20x, non-US. |
| 2026-03-18 | SEC approves **Nasdaq's tokenized-securities rule** (same book, same CUSIP, not a new venue). |
| 2026-05-13 | **Stork publishes a 24/7 methodology** for equities and commodities, using perp markets on nights and weekends. |
| 2026-06-10 | **Pyth launches Indices**: proprietary 24/7 single-asset equity indices including NVDA, TSLA, AAPL, MSFT, GOOGL, INTC, HOOD, MSTR, CRCL. |
| 2026-06-15 | **Pyth Core deprecates extended-hours equity feeds** (`.PRE`, `.POST`, `.ON`) and moves them to Pyth Pro at $5,000/month. |
| 2026-06-11 | **Binance launches bStocks** with 24/7 spot trading on BNB Chain. |
| 2026-06-25 | **Ondo launches 24/7 mint and redeem** for six tokenized stocks and ETFs, the first issuer to do so, on Ethereum, BNB Chain and Solana. |
| 2026-07-17 | **Bitget expands rTokens to 61**, later **90** by 2026-08-26, with a real weekend session and a ±20% price band. |
| 2026-08-21 | **Arbital opens publicly on Solana**, a terminal over xStocks plus 14 Solana perp DEXes. Its "24/7" is DEX routing, not a new venue. |
| 2026-06-26 | **SEC approves the SIP extended-hours amendments.** This is the unlock for everything regulated. |
| 2026-06-29 | NSCC extends clearing to 24x5. |
| 2026-07-31 | **Pyth Core's free API access ends.** All Core data now needs a plan. |
| 2026-08-07 | SEC grants 24X conditional overnight relief, effective only as a backstop from 2027-01-24. |
| 2026-09-17 | **SEC roundtable on 24-hour trading.** Five days from now. |
| **2026-12-06** | **The SIPs extend to 21:00 Sunday through 20:00 Friday ET.** Nasdaq, Cboe EDGX, NYSE Arca and 24X overnight sessions all go live. |

**Does any of it let more than 23 stocks fight around the clock?** Yes, but not from
the sources the app reads today. Hyperliquid alone offers around 60 single-name US
equities with real weekend volume, and the count that clears a sensible floor is
larger than 23 and rising. Nothing on the regulated side helps before 2026-12-06,
and nothing on the regulated side will ever help on a Saturday.

**Does any of it make the off-hours price better than a trimmed mean of pool
candles?** Yes, decisively, per section 5c.

---

## 7. Recommendations for Stonk Wars

Ranked by value against effort. Effort is in hours of the author's time.

### 1. Add Hyperliquid HIP-3 as the primary off-hours source, with the pool as fallback

**Value: very high. Effort: low, roughly one afternoon.**

`src/lib/oracle.ts` already has the right shape. `sourceAt()` picks a source per
boundary, `fetchPoolBars()` fetches and caches candles by `(pool, before)`, and
`priceAtBoundary()` already knows how to take the close of the bar that contains a
boundary. Hyperliquid slots in as a third source with a near-identical fetch:

- `POST https://api.hyperliquid.xyz/info` with
  `{"type":"candleSnapshot","req":{"coin":"xyz:NVDA","interval":"1m","startTime":…,"endTime":…}}`
- Candles come back as `{t, T, o, h, l, c, v, n}`, oldest first, one per minute with
  no gaps.
- Because there are no gaps, **use `priceAtBoundary()`, not `trimmedMeanAtBoundary()`**.
  You get back the honest "first price at or after the boundary" rule that the
  program is built around, rather than a smoothed window. That also fixes the
  documented wart that "a round shorter than the off-hours sample settles on the move
  across the sample, not across the round".

What this buys, from the measurements above: the median weekend 15-minute reading
goes from 0.129% of noise to 0.018% of signal, roughly 29% of weekend fights stop
being decided by the wrong stock, and the level gap against the real share drops from
a 0.311% median to under 0.1%.

It is also what the professionals do. Coinbase's INTX weekend index is built from an
EMA of its own perp mark "combined with tokenized equity feeds when available (e.g.
AAPLx xStock)", which is exactly this ordering: perp first, token pool second. Bitget
tells its users outright that weekend tokenized prices are "indicative". Stonk Wars
is currently using the input those venues treat as the weaker one.

**Trade-offs, honestly:**

- **It is a perpetual future, not the share.** Over a weekend the basis is tiny
  (0.02% to 0.38% against Friday's print, measured above) because arbitrage against
  Monday's open is cheap and obvious. Over a long fight spanning a session it could
  drift more. Mitigate by using Hyperliquid only when the exchange is shut, exactly
  as the pool is used now, so basis exposure is limited to the off-hours leg and both
  fighters get the same treatment.
- **It is not the token the fight holds.** Neither is a Yahoo bar. The app already
  prices NVDA from NVDA's market rather than NVDAx's pool during the day; this is the
  same choice extended to the night, and it is more consistent, not less.
- **The market is deployed by a third party.** trade[XYZ] deployed `xyz` under HIP-3
  and sets its oracle and parameters. It can delist a market: sixteen `xyz` markets
  are already flagged delisted with zero volume. Pin the dex name and ticker in the
  roster the way pools are pinned, and screen for nonzero 24-hour volume the way
  `build-pools.ts` screens liquidity.
- **Do not read the other HIP-3 dexes.** `flx:TSLA` marked 395.5 and `cash:TSLA`
  marked 400.21 this morning against a real 365.25, on zero volume. Stale marks on
  dead markets. Only `xyz` passes.
- **Short one-minute history**, about three days. Cache the candle at settle time, or
  fall back to the exchange for anything older, which is what happens today anyway.

### 2. Widen the 24/7 roster using Hyperliquid volume instead of pool liquidity

**Value: high. Effort: low, a variant of `build-pools.ts`.**

The 23-stock limit exists because pool liquidity is the gate. Swap the gate. Roughly
60 single-name US equities on `xyz` had nonzero weekend volume this morning, 27
markets did over $10M in 24 hours and 34 more did $1M to $10M. A floor of, say, $1M
of 24-hour notional would comfortably clear more names than the pool floor does, and
those names would have 60 traded minutes an hour rather than three.

**Trade-off:** the two lists overlap but are not the same. Hyperliquid has no VOO and
no QQQ as such; it has `SP500` and `XYZ100`, which are index products, not the ETF.
Do not silently substitute an index for an ETF. Either leave VOO and QQQ on exchange
hours, or label them clearly.

### 3. Let TSLA and QQQ fight overnight on weeknights, and say why they cannot at weekends

**Value: medium. Effort: very low, a documentation and UI change.**

Pyth Core's US equity schedule includes an **overnight session, Sunday to Thursday
20:00 to 04:00 ET**. So the three Pyth-priced stocks are not actually limited to
04:00-to-20:00; they are limited to weekdays. If the app's market clock treats
20:00 to 04:00 as closed for Pyth-priced stocks, it is turning off fights that would
work. Worth checking `src/lib/market.ts` against Pyth's published schedule.

The Friday 20:00 to Sunday 20:00 hole is real and cannot be paid around at this
budget. The honest fix is either to move TSLA and QQQ to the signed oracle at
weekends (both are `online` on Kraken and both have deep `xyz` perps), or to keep
saying plainly that they keep exchange hours. Moving them means giving up the
trustless Pyth path for those two, which is a genuine loss and should be a deliberate
choice, not a drift.

VOO has neither a Kraken weekend book nor an `xyz` market. It should stay on exchange
hours.

### 4. Use venue session APIs as a free, live tradeability gate

**Value: medium. Effort: very low, one or two API calls.**

Two free, unauthenticated endpoints tell you what a real venue thinks is tradeable
**right now**, which is a much better signal than a 24-hour volume number frozen at
build time:

- `GET https://api.kraken.com/0/public/AssetPairs?aclass=tokenized_asset` returns 177
  xStocks pairs with a live `status`: 12 `online` against 165 `post_only` this
  Saturday morning.
- Backpack exposes `/api/v1/market-sessions` and `/api/v1/market-holidays`, which
  return the actual session windows with weekday bounds rather than a hardcoded
  clock. Useful for the app's own market clock, and it handles holidays for free.

Both are display-quality signals, not price sources. Kraken's market data endpoints
refused every request for xStocks pairs from here.

### 5. Consider Switchboard to remove the trusted key, later

**Value: high for credibility, low for gameplay. Effort: high, days not hours.**

The one real weakness the README already admits is that "the oracle is a trusted key"
for 1,030 of the 1,033 stocks. Switchboard is Solana-native, permissionless, runs
jobs in a TEE, and costs lamports per update rather than dollars per month. A custom
feed pointed at Hyperliquid or Yahoo would turn the signed quote from "trust this
key" into "trust this attested computation", without paying anybody $5,000 a month.

This does not change what a player sees. It changes what a judge or an auditor sees.
Do not attempt it before the hackathon deadline.

### 6. Things not worth doing

- **Pyth Pro at $5,000/month, Chainlink Data Streams at $150/month per feed.** Both
  are correct products and both are out of budget. Chainlink is also 24/5, so even
  at full price it would not deliver a Saturday.
- **Stork and RedStone.** Both are contact-sales with no public pricing. Stork's REST
  API returned `401` unauthenticated. Stork's 24/7 methodology is exactly right in
  principle, sourcing from perp venues out of hours, but you cannot buy it self-serve
  and its perp sources are the same venues you can read for free.
- **Waiting for a regulated venue.** 2026-12-06 brings 23x5, which the app already
  has via Yahoo pre and post market plus overnight. It does not bring a weekend, and
  no weekend is on any roadmap.
- **Waiting for issuers to go seven-day.** Backed's own API says otherwise this
  morning, and nothing suggests a change.

### Is the current approach already the best available?

**No, and the gap is larger than it looks.** The trimmed mean was the right answer to
the right question: it is genuinely hard to push, and the reasoning in `oracle.ts`
about why a median was worse is sound. But it is solving a manipulation problem on a
data source that cannot answer the underlying question. Fifteen minutes of weekend
price action is about two basis points, and a pool that trades three minutes an hour
with a 1% to 2% hourly range cannot measure two basis points. Twenty-nine percent of
weekend fights in my sample would be decided by a different stock depending on which
source you read, and that is not a manipulation risk, it is just being wrong.

The good news is that the fix is small. Everything the app needs is already the right
shape: a per-boundary source choice, a pinned venue per stock, a cached fetch, and a
"first price at or after the boundary" rule the program enforces. Pointing that
machinery at a free, unauthenticated, gap-free, $2bn-a-day market instead of a $2M
AMM pool is an afternoon of work and it makes the headline claim in the submission
("23 of them fight around the clock") both truer and bigger.

---

## 8. What I could not verify

Stated plainly, with no guessing.

1. **Kraken's xStocks prices.** `AssetPairs` and `Assets` are public for
   `aclass=tokenized_asset`, but `OHLC`, `Ticker`, `Depth` and `Trades` all refused
   every form of the pair name from this network on 2026-09-12. I could not
   determine whether that is geo-blocking (xStocks are barred to US persons), a
   separate regional API host, or a permanent restriction. **Do not assume Kraken
   weekend prices are readable until someone tests from a permitted jurisdiction.**
   Kraken's weekend volume is therefore also unmeasured.
2. **Pyth Indices: cost, plan, and Solana availability.** Confirmed to exist, to be
   24/7 including weekends, and to cover named single stocks. Nothing I found says
   which plan they need, whether they are published as Solana `PriceUpdateV2`
   accounts, or what they cost. Given the $5,000/month equities tier, treat as
   expensive until proven otherwise.
3. **The full list of Pyth sponsored equity feeds on Solana.** The docs page renders
   the list from a JSON file I could not fetch (404 at every path I tried). The
   rendered page named `Equity.US.BULL`, `Equity.US.CLOV`, `Equity.US.KSS` and
   `Equity.US.RCAT`. Whether TSLA, QQQ and VOO are sponsored on Solana mainnet, as
   opposed to pushed by the project itself, I did not confirm.
4. **The app's Pyth entitlement.** The README says the free plan grants three US
   equity feeds; the pricing page today says the free plan is view-only with no API
   permissions. I did not test the deployment's key and cannot say which is right.
5. **Hyperliquid `xyz` market hours as documented.** trade[XYZ]'s docs say only
   "trade anything, anytime". I found no page stating operating hours, halt policy,
   or the oracle source behind their marks. Everything in section 5b is measured, not
   quoted. The markets were demonstrably trading at 05:49 UTC on a Saturday, which is
   stronger evidence than a docs page, but it is not a commitment by anyone.
6. **Whether `xyz` equity markets ever halt.** Sixteen markets are flagged delisted.
   I did not find a policy describing when a HIP-3 deployer halts or delists, nor any
   notice period. This is a real dependency risk and it is not documented.
7. **Backed's `Always` trading-hours mode.** Exactly one asset (BTBTx) reports it,
   with `openNow: true` but `currentPeriod: "closed"` and a closed-period order cap of
   zero. I do not know what Backed means by it.
8. **Cboe BZX's 23x5 platform change** rests on Cboe's FAQ; I did not find the SEC
   filing number.
9. **Blue Ocean's fee schedule** is portal-gated. The ~$39/month via Tiingo figure
   comes from a vendor blog post dated 2026-07-23, not from Blue Ocean.
10. **A tokenized-equities "innovation exemption".** Widely reported in crypto media,
    no SEC primary source found. What the SEC actually proposed on 2026-08-18
    ("Regulation Crypto Assets") is a crypto-asset offering exemption and does not
    address tokenized equities or 24/7 trading. Treat the claim as unsupported.
11. **NYSE's 24/7 tokenized venue.** Announced 2026-01-19 with no SEC filing found
    (no Form 1, no Form ATS-N, no 19b-4) and no launch date. A TD Securities note
    mentions a Q2 2026 target, which has passed. Announced only.
12. **Kraken contradicts itself.** The Pro page says ten xStocks trade 24/7. Kraken's
    retail getting-started article (updated 2026-07-29) says "xStocks can be traded
    24/5" and "weekend trading availability is in development". Best reading is that
    24/7 is Pro only, but this is unresolved and worth a support ticket before
    relying on it.
13. **Backpack and Coinbase mint/redeem hours.** Backpack documents withdrawal fees
    but never says whether Solana deposit and withdrawal work at weekends. Coinbase
    publishes no authorised-participant window. Both are genuine documentation gaps,
    queried several ways.
14. **Securitize ATS hours** are not published anywhere reachable (help centre
    returned 403 twice). Secondary sources claim 24/7; treat that as unverified and
    probably wrong.
15. **Whether Dinari's US customers can use its weekend session.** The session is
    "blockchain only" and US customers' tokens are non-transferable, which implies
    exclusion, but Dinari never states the intersection. Inference, not fact.
16. **Bitget's `turnover24h` API field is not trustworthy.** It reported roughly $11bn
    for rNVDA, which is not credible. Only the hourly candle figures quoted above are
    internally consistent.
17. **Gemini's current hours, Gate's weekend session times, bands and caps, and
    Swarm's hours** could not be established beyond marketing copy. Treat Gemini as
    24/5 until shown otherwise.
18. **Name collision worth knowing:** Remora's "rTokens" (dead) are unrelated to
    Bitget's "rTokens" (live).

### A methodology note for anyone re-running section 5a

GeckoTerminal's `before_timestamp` **fails silently on a future timestamp**: it
returns HTTP 200 with the most recent candles rather than an error, so filtering to
the requested window yields a very convincing zero. Also, 9 of 48 responses contained
a duplicated timestamp, so count distinct timestamps, not rows. Both traps were hit
and worked around during this research; neither affects the numbers reported.

---

## Sources

Issuers and venues:
[Backed public API](https://api.backed.fi/api/v2/public/assets?page=1) (read 2026-09-12) ·
[Ondo 24/7 mint and redeem, 2026-06-25](https://ondo.finance/blog/real-24-7-trading-for-tokenized-stocks) ·
[Kraken Pro 24/7 xStocks, 2025-12-03](https://blog.kraken.com/product/xstocks/24-7-on-kraken-pro) ·
[Kraken xStocks perps, 2026-02-24](https://blog.kraken.com/product/xstocks/tokenized-equity-perpetual-futures) ·
[Kraken AssetPairs API](https://api.kraken.com/0/public/AssetPairs?aclass=tokenized_asset) (read 2026-09-12)

Oracles:
[Pyth market hours](https://docs.pyth.network/price-feeds/market-hours) ·
[Pyth Core upgrade, 2026-05-26](https://www.pyth.network/blog/the-pyth-core-upgrade) ·
[Pyth extended hours moves to Pro, 2026-06-12](https://www.pyth.network/blog/extended-hours-us-equity-data-moves-to-pyth-pro) ·
[Pyth Indices, 2026-06-10](https://www.pyth.network/blog/24-7-finance-needs-24-7-price-infrastructure-introducing-pyth-indices) ·
[Pyth pricing](https://www.pyth.network/pricing) ·
[Pyth Solana push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana) ·
[Chainlink 24/5 US equities, 2026-01-20](https://chain.link/blog/chainlink-24-5-us-equities-streams) ·
[Chainlink 24/5 user guide](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide) ·
[Chainlink Data Streams sign-up and pricing](https://docs.chain.link/data-streams/sign-up) ·
[Switchboard docs](https://docs.switchboard.xyz/) ·
[Stork docs](https://docs.stork.network/) ·
[Stork 24/7 price discovery, The Block, 2026-05-13](https://www.theblock.co/post/401053/stork-24-7-price-discovery) ·
[RedStone docs](https://docs.redstone.finance/docs/introduction/)

Regulated venues:
[SEC roundtable on 24-hour trading, 2026-07-23](https://www.sec.gov/newsroom/press-releases/2026-69-sec-announces-roundtable-preparations-24-hour-trading) ·
[SEC roundtable agenda, 2026-09-01](https://www.sec.gov/newsroom/press-releases/2026-83-sec-announces-agenda-panelists-roundtable-preparations-24-hour-trading) ·
[SEC Trading and Markets overnight memo, 2026-09-10](https://www.sec.gov/files/2026_TM_Overnight_Trading_Roundtable_Memo_090926.pdf) ·
[SIP extended hours approval, 34-105779](https://www.sec.gov/files/rules/sro/nms/2026/34-105779.pdf) ·
[SIPs receive SEC approval, 2026-07-07](https://www.prnewswire.com/news-releases/sips-receive-sec-approval-for-extended-trading-hours-initiative-302820006.html) ·
[UTP Vendor Alert 2026-24, 2026-08-12](https://www.nasdaqtrader.com/TraderNews.aspx?id=UTP2026-24) ·
[24X overnight FAQ](https://equities.24exchange.com/overnight-trading-faqs) ·
[24X opens for trading, 2025-10-15](https://www.prnewswire.com/news-releases/24x-national-exchange-opens-for-trading-as-first-sec-approved-235-stock-exchange-302581303.html) ·
[SEC 24X conditional exemption, 2026-08-07](https://www.govinfo.gov/content/pkg/FR-2026-08-14/html/2026-16572.htm) ·
[Nasdaq 23/5 approval, 34-105199](https://www.govinfo.gov/content/pkg/FR-2026-04-15/html/2026-07259.htm) ·
[Nasdaq tokenized securities approval, 34-105047, 2026-03-18](https://www.sec.gov/files/rules/sro/nasdaq/2026/34-105047.pdf) ·
[DTC no-action letter, 2025-12-11](https://www.sec.gov/files/tm/no-action/dtc-nal-121125.pdf) ·
[Cboe overnight trading FAQ](https://www.cboe.com/document/tech-spec/content/technical-specifications/cboe-u.s.-equities-overnight-trading-faq) ·
[NYSE Arca overnight rules, 34-105532, 2026-05-27](https://www.govinfo.gov/content/pkg/FR-2026-05-27/html/2026-10450.htm) ·
[NYSE extended hours](https://www.nyse.com/extended-hours-trading) ·
[ICE/NYSE tokenized securities platform, 2026-01-19](https://ir.theice.com/press/news-details/2026/The-New-York-Stock-Exchange-Develops-Tokenized-Securities-Platform/default.aspx) ·
[Blue Ocean ATS FAQ](https://blueocean-tech.io/faq/) ·
[NSCC 24x5 clearing live, 2026-06-29](https://www.dtcc.com/news/2026/june/29/nscc-now-live-with-clearing-hours-extended)

On-chain venues:
[Hyperliquid info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals) ·
[Hyperliquid rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) ·
[trade[XYZ] docs](https://docs.trade.xyz/) ·
[GeckoTerminal API](https://api.geckoterminal.com/api/v2)
