# Stonk Wars 24/7 pricing: lead engineer decision (Mon 14 Sep 2026)

I re-counted coverage from the raw files the lenses saved, which they fetched 14 Sep between 19:27 and 20:30 UTC. I did not make any new venue requests. All weekend figures cover Sat 12 Sep 00:00 UTC to Mon 14 Sep 00:00 UTC. I left out every claim that verification refuted: the KuCoin TSLA list, Binance's "0 at 92 days", Hermes "48 days" and Coinbase fixed windows.

## 1. The answer in ten lines

1. **Real, free, public and reproducible weekend 1m history** exists at nine venues:
   - **Real volume ("anchors"):** Hyperliquid xyz (history about 3.47 days), OKX stock perps (at least 185 days), Bitget RWA perps (at least 60 days), Binance bStocks via data-api.binance.vision (back to the 11 Jun listing), Lighter (at least 120 days), Backpack .US perps (thin).
   - **Possibly synthetic flow:** Gate (about 6.9 days), MEXC (about 30 days), BingX (at least 185 days). These print a trade nearly every minute on very little volume, even on BRK.B.
2. **Not usable for weekend minutes:**
   - Pyth Core: dark Fri 20:00 to Sun 20:00 ET.
   - Pyth Indices: gated (403).
   - Chainlink: 24/5 and paid.
   - Stork (needs a token) and RedStone (about 24 h of history).
   - Solana pools: 15-minute noise of 0.265% against a real move of 0.030%.
   - Ondo, Kraken, Coinbase INTX, Crypto.com, Aster, Paradex, Orderly: too thin, or model prices.
3. **Pricing rule when the exchange is shut:** the median of fresh 1m closes. It needs at least 3 fresh markets, at least 2 of them anchors, with a 50 bps outlier band. On last weekend's minute data it met quorum in 100% of the 2,880 minutes for 11 of 12 test tickers, and in 2,879 for MSFT.
4. **Count: 48 of 1,033 roster stocks** fight around the clock under that rule (today 37).
   - 30 of today's 37 keep it.
   - 7 lose it: GLD, GME, KO, MCD and STRC (pool-priced today) and MRNA and USAR (thin single perp).
   - 18 gain it: 16 signed names plus TSLA and QQQ.
5. **How sensitive that count is:**
   - Requiring 3 anchors: 36.
   - Dropping Binance (a terms question): 43.
   - Letting MEXC, BingX and Gate count fully: 102. That is not defensible until their flow is understood.
6. **TSLA:** `set_asset` it to SOURCE_SIGNED on the composite. It has 5 qualifying anchors (HL, OKX, Bitget, Binance, Lighter) plus Gate, MEXC and BingX.
7. **QQQ:** `set_asset` it to SOURCE_SIGNED. Anchors are OKX (26/46 traded minutes in the two probe hours) and Binance QQQB (53/48). Lighter QQQ is at 89.6% freshness, just under the bar, so it is the backup.
8. **VOO:** stays on Pyth. No weekend market qualifies anywhere (Gate 0 and 47 traded minutes, Bitget 5 and 6).
9. **Pyth hours bug:** the app models Pyth as 9:30 to 16:00 only, but Pyth now prints 24/5. The real bug is on weekends: any Pyth boundary between Fri 20:00 and Sun 20:00 ET can never settle.
   - Fix the hours model and refuse such fights.
   - The stuck Fri 22:21 ET TSLA fight can only be refunded, from Fri 18 Sep 22:21 ET (`STALL_REFUND_SECS` = 7 days). I read that from constants.rs and did not run it.
10. **Honest limits:**
    - One weekend of evidence.
    - A perp is not the share.
    - The composite sits 5.4 bps (Friday 20:00 ET) to 13.8 bps (Monday 04:00 ET) from the exchange at the handoff, so short rounds that cross those edges get refused.
    - About 15% of weekend 15-minute fights fall inside the disagreement between honest venues.

## 2. Coverage matrix

**How to read it**
- Anchor cells show traded minutes in Sat 16:00-17:00 / Sun 08:00-09:00 UTC. For HL, LT and BP the % is weekend 15-minute freshness: the share of the 2,880 minutes with a trade in the prior 15.
- **Anchors:** HL = Hyperliquid `xyz:` perp, OKX = OKX stock swap, BG = Bitget RWA perp, BN = Binance bStock spot, LT = Lighter perp, BP = Backpack .US perp.
- **Other inputs:** GT = Gate perp, MX = MEXC perp, BX = BingX perp.
- **Bps to Fri:** the median absolute gap between the qualifying venues' last Friday print and Yahoo's Friday 19:59 ET close.

**How a venue qualifies**
- The instrument is within 5% of Yahoo's Friday close.
- A CEX needs at least 10 traded minutes in each probe hour and trades in at least 44 of 48 weekend hours.
- Calibration against full minute data for 12 tickers: the lowest freshness of any CEX pair that cleared the 10-minute bar was 87.3% (Binance AMZN).
- HL, LT and BP need at least 90% freshness.

**How a ticker gets the badge:** at least 2 anchors and at least 3 venues in total. HTX and KuCoin were not counted because there is no hourly weekend sweep for them.

### Keeps 24/7 (30), now on the composite

| Ticker | Qualifying anchors | Other inputs | HL freshness (traded min of 2,880) | Bps to Fri |
|---|---|---|---|---|
| AAPL | HL 43/44, OKX 37/54, BG 34/43, BN 31/36, LT 95%, BP 100% | GT MX BX | 100% (1,758) | 4.2 |
| AMD | HL 27/55, OKX 21/57, BG 11/31, BN 24/39 | GT MX | 99.9% (1,783) | 3.7 |
| AMZN | HL 34/44, OKX 18/33, BN 12/10 | GT MX BX | 100% (1,809) | 6.4 |
| AVGO | OKX 17/52, BG 28/44, BN 12/37 | GT MX BX | 89.2%, input only (914) | 3.6 |
| COIN | HL 12/32, OKX 36/43, BG 20/37, BN 14/20 | GT MX BX | 94.5% (1,196) | 16.6 |
| CRCL | HL 42/49, OKX 37/54, BG 17/45, BN 33/56 | GT MX BX | 100% (2,324) | 7.7 |
| CRWV | HL 41/57, OKX 17/50, BG 19/33 | GT MX BX | 96.9% (1,643) | 4.5 |
| DELL | HL 12/44, OKX 20/53, BG 21/47 | GT MX BX | 99.1% (1,607) | 15.8 |
| DRAM | HL 21/55, OKX 53/56, BG 20/56 | GT MX BX | 99.9% (2,132) | 12.7 |
| EWY | HL 10/56, OKX 16/53, BG 14/51 | GT MX | 95.4% (1,596) | 1.6 |
| GOOGL | HL 43/51, OKX 28/50, BG 19/35, BN 31/31 | GT MX BX | 100% (2,334) | 2.9 |
| HOOD | HL 40/45, OKX 12/31, BG 13/31, BN 22/14 | GT MX BX | 100% (2,210) | 8.0 |
| INTC | HL 30/57, OKX 32/60, BN 12/50 | GT MX BX | 99.9% (2,006) | 2.9 |
| KORU | HL 15/57, OKX 26/59, BG 50/60, BN 19/27 | GT MX BX | 97.4% (1,513) | 9.9 |
| LITE | OKX 53/60, BG 10/38, BN 15/33 | GT MX BX | 82.8%, input only (913) | 12.8 |
| META | HL 22/38, OKX 24/32, BG 14/12 | GT MX BX | 99.8% (1,667) | 4.6 |
| MRVL | HL 19/55, OKX 30/59, BG 16/44, BN 11/23 | GT MX BX | 98.1% (1,613) | 4.2 |
| MSFT | HL 18/29, OKX 21/23 (only 2 anchors) | GT MX BX | 100% (1,205) | 4.0 |
| MSTR | HL 31/48, OKX 38/58, BG 49/57, BN 43/53, LT 97% | GT MX BX | 99.8% (1,587) | 10.7 |
| MU | HL 51/58, OKX 49/60, BG 42/60, BN 42/60, LT 97% | GT MX BX | 100% (2,591) | 4.3 |
| NBIS | HL 43/57, OKX 31/60, BG 11/46, LT 97% | GT MX BX | 100% (2,539) | 5.3 |
| NVDA | HL 60/58, OKX 32/54, BG 21/53, BN 60/60, LT 99% | GT MX BX | 100% (2,878) | 10.3 |
| ORCL | HL 60/57, OKX 59/59, BG 50/45, BN 50/33 | GT MX BX | 100% (2,632) | 8.1 |
| PLTR | HL 29/40, OKX 14/36, BG 19/38 | GT MX BX | 98.3% (1,237) | 9.1 |
| RKLB | OKX 15/43, BG 11/25, BN 15/17 | GT MX BX | 81.4%, input only (541) | 11.1 |
| SKHY | HL 30/58, OKX 37/60, BG 33/60, BN 56/59, LT 92% | GT MX BX | 100% (2,390) | 5.8 |
| SNDK | HL 36/57, OKX 60/60, BG 60/60, BN 52/60, BP 96% | GT MX BX | 100% (2,601) | 12.8 |
| SOXL | HL 20/51, OKX 51/60, BG 43/60, BN 19/59 | GT MX BX | 99.6% (2,076) | 1.4 |
| SPCX | HL 44/49, OKX 43/55, BG 55/44, BN 60/60, LT 95% | GT MX BX | 100% (2,131) | 6.3 |
| SPY | OKX 18/47, BN 34/34, LT 99% | GT MX BX | no HL market | 10.0 |

### Gains 24/7 (18)

| Ticker | Qualifying anchors | Other inputs | HL freshness (traded min) | Bps to Fri |
|---|---|---|---|---|
| TSLA (Pyth today) | HL 27/54, OKX 30/54, BG 22/29, BN 58/59, LT 94% | GT MX BX | 100% (2,246) | 2.5 |
| QQQ (Pyth today) | OKX 26/46, BN 53/48 (LT 89.6%, backup) | GT MX BX | no HL market | 5.6 |
| AAOI | OKX 33/60, BG 19/48 | GT MX BX | 86.1% (882) | 5.7 |
| ARM | OKX 22/44, BG 11/20, BN 10/24 | GT MX BX | 82.8% (670) | 11.5 |
| AXTI | OKX 34/58, BG 16/50, BN 14/22 | GT MX BX | none | 8.5 |
| BE | OKX 15/52, BN 13/17 | GT MX BX | 89.3% (1,503) | 8.7 |
| COHR | OKX 14/43, BN 10/23 | GT MX BX | none | 10.8 |
| CRDO | OKX 17/46, BG 12/43 | GT MX BX | none | 0.9 |
| GPRO | OKX 22/30, BG 12/24 | MX BX | none | 9.2 |
| HPE | OKX 12/22, BG 15/17 | MX BX | none | 4.8 |
| INTW (INTC 2x) | OKX 11/45, BN 14/21 | GT MX BX | none | 8.2 |
| IREN | OKX 14/34, BG 15/44 | GT MX BX | 84.9% (1,240) | 4.6 |
| MUU (MU 2x) | OKX 26/60, BG 32/59, BN 12/41 | GT MX BX | none | 6.4 |
| MVLL (MRVL 2x) | OKX 21/51, BG 12/56 | GT MX BX | none | 10.2 |
| SNXX (SNDK 2x) | OKX 35/59, BG 39/57, BN 12/43 | GT MX BX | xyz:SNXX delisted | 4.5 |
| SOXS | OKX 25/57, BG 42/60, BN 13/39 | GT MX BX | none | 6.4 |
| TQQQ | OKX 18/41, BN 14/23 | MX BX | none | 2.6 |
| WDC | OKX 38/55, BG 15/43, BN 11/26 | GT MX BX | 83.7% (798) | 15.1 |

### Loses 24/7 (7)

| Ticker | Today | Why it fails |
|---|---|---|
| GLD | pool | No venue qualifies (Gate 0/1). No pool passes the noise test. |
| GME | pool | No anchor. HL is 66.7% fresh (287 traded minutes). Only MX and BX qualify. |
| KO | pool | No anchor (OKX 5/8, BG 9/7). Only MX qualifies. |
| MCD | pool | One anchor (BG 11/12), plus MX and BX. |
| STRC | pool | HL is 41.3% fresh (145 traded minutes). Only MX and BX qualify. |
| MRNA | xyz perp | HL is 69.5% fresh (374 traded minutes). One anchor (BG 11/27). |
| USAR | xyz perp | HL is 79.2% fresh (671 traded minutes). No anchor. |

### Notable ones that do not qualify
- **VOO:** only Gate (0/47, trades in 29 of 48 hours) and Bitget (5/6).
- **NFLX:** one anchor (BN 10/11). HL is 74.4% fresh; OKX 7/8.
- **PURR:** `xyz:PURRDAT` is the stock (1,516 traded weekend minutes), but there is no second anchor: OKX 7/40, BG 3/23.
- **BRK.B:** only MEXC and BingX, which print every minute. OKX 5/5, BG 6/5.
- **CL (Colgate):** every CL perp found (HL, Gate, Bitget) is WTI crude.
- **One anchor but at least 3 inputs (21):** ADBE, APLD, ASTS, BABA, BMNR, CBRS, COST, DDOG, DKNG, IBM, IONQ, MCD, MRNA, NFLX, OUST, PANW, QCOM, SMCI, SQQQ, TSM, USO.
- **Only Gate, MEXC or BingX qualify (33):** AAL, ALAB, AMAT, APP, ASML, BSP, BX, FLEX, FLNC, GILD, GLW, GS, HIMS, IWM, JPM, LLY, LRCX, LUNR, MRK, NOW, NVO, ONDS, RDW, RIVN, SHOP, SOXX, TER, TSEM, TXN, USAR, WMT, XOM, ZM.

## 3. The composite price rule ("composite-v1")

**When it applies**
- A US, USD roster stock listed in `src/data/venues247.json`.
- Boundary `b >= COMPOSITE_FROM`.
- `session(b) === "closed"`: 20:00 to 04:00 ET, weekends and holidays (17:00 on early-close days, as in market.ts).
- Otherwise the exchange path is unchanged.

**Inputs, pinned per ticker in venues247.json.** Each entry has `from`/`until` expressed as boundary times. The answer is a function of (feed, boundary) only, because the quote route is public and quotes name no duel.

| Venue | Anchor | 1m request (fixed window, m = floor(b/60)*60) | Traded flag | Retention used |
|---|---|---|---|---|
| HL xyz | yes | POST api.hyperliquid.xyz/info candleSnapshot coin `xyz:T`, startTime (m-3600)*1000, endTime (m+59)*1000 | n > 0 | 3 d |
| OKX | yes | GET www.okx.com/api/v5/market/history-candles?instId=T-USDT-SWAP&bar=1m&after=(m+60)*1000&limit=100 | vol > 0 | 29 d |
| Bitget | yes | GET api.bitget.com/api/v2/mix/market/history-candles?symbol=TUSDT&productType=USDT-FUTURES&granularity=1m&startTime&endTime&limit=200 | vol > 0 | 29 d |
| Binance bStock | yes | GET data-api.binance.vision/api/v3/klines?symbol=TBUSDT&interval=1m&startTime&endTime&limit=1000 | trades > 0 | 29 d |
| Lighter | yes | GET mainnet.zklighter.elliot.ai/api/v1/candles?market_id=N&resolution=1m&start_timestamp&end_timestamp&count_back=61, filter rows by t | v > 0 | 29 d |
| Backpack | yes | GET api.backpack.exchange/api/v1/klines?symbol=T.US_USDC_PERP&interval=1m&startTime=m-3600&endTime=m+60 | trades > 0 | 29 d |
| Gate | no | GET api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=T_USDT&interval=1m&from=m-3600&to=m | vol > 0 | 6 d |
| MEXC | no | GET contract.mexc.com/api/v1/contract/kline/SYM?interval=Min1&start=m-3600&end=m | vol > 0 | 25 d |
| BingX | no | GET open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=NCSK...&interval=1m&startTime&endTime (end pinned) | vol > 0 | 29 d |

**Steps**
1. **Timing.** `publishTime = m + 60`. This is the same as today's perp rule, so priceClock, `priceTimeAt`, `SAME_PRICE_SECS` and the program are unchanged. Nothing is fetched before `m + 60 + BAR_SETTLE_SECS` (20 s).
2. **Per venue.** `close_v` is the close of the latest candle with `t <= m` inside the window. `fresh_v` is true when the latest traded candle `t <= m` satisfies `t >= m - 840`, which means any trade in candles m-14 through m.
   - **HL and Backpack** always forward-fill. Verified: 0 of 10,754 zero-trade HL minutes changed close, and Backpack only omits leading quiet minutes.
   - **Every other venue** prints each minute. If candle m is missing and no later candle exists yet, return null (wait). If a later candle exists, the missing minute counts as no trade.
   - **No window guesses.** Any HTTP error, timeout, 429, 451 or 403 from a pinned venue means wait, never exclude. Otherwise the answer would depend on when someone asked.
3. **Quorum.** F is the set of fresh venues. Require `|F| >= 3` and at least 2 anchors in F.
4. **Divergence guard.** Convert each close to integer 1e-4 ticks (round half away from zero). Take `m0 = median(F)` and drop any input more than 50 bps from m0. Check quorum again on the survivors S.
5. **Price.** `price = median(S)`. With an even count, use `floor((a + b + 1) / 2)` of the middle two.
6. **Breaker.** If the price is more than 15% from the stock's last Yahoo 1m close before b, treat it as a quorum failure. KORU's real Friday-to-Monday move was -12.25%.
7. **Too late.** Refuse to sign when `now - b` exceeds the shortest retention in that ticker's pinned set: 3 days whenever HL is pinned.
8. **Fallbacks, in order.** Both are pure functions of history.
   - (a) Exactly 2 fresh anchors within 25 bps of each other: price = their mean.
   - (b) Otherwise the side takes the exchange's first bar after b, which is today's `exchangeBarFinal` path. `quoteAt` returns `{ waitUntil }` so the crank parks the fight instead of polling all weekend.

**Proof each quote carries.** The quote route returns it and a new `/api/quote/proof` route recomputes it:
- Rule name and b, m, publishTime.
- For each venue: instrument, the exact request (URL or POST body), candle t, close, last traded minute, fresh, anchor, and kept or dropped with the reason.
- m0, the median, the quorum count, the fallback tier (null, `two-anchor` or `exchange`), and the sha256 of the canonical JSON.

The fight page renders this as the proof table. After about 3 days the HL row says plainly that Hyperliquid no longer serves that minute; the other rows stay fetchable for 29 days or more.

**What the fight page says**
- **Normal:** "Priced 24/7 by the Stonk Wars oracle: the median of the 1-minute closes of 7 markets that traded TSLA in the 15 minutes before Sat 3:15 AM ET. These are perpetual futures and tokenized shares, not the Nasdaq listing; a weekend price is what those markets traded, not Monday's open."
- **Tier (a):** "Only Hyperliquid and OKX had traded TSLA in those 15 minutes (0.08% apart), so the price is their average."
- **Tier (b):** "Fewer than 3 markets (2 of them anchors) had traded TSLA in the 15 minutes before Sat 3:15 AM ET, so this side takes the exchange's first bar after it: Monday 4:00 AM ET. The other side was priced on Saturday, so the weekend move counts in this fight."

**Measured on last weekend** (my simulation of this exact rule on the 12 tickers the method lens archived at minute level, 9 venues)
- **Quorum:** 2,880 of 2,880 minutes for TSLA, NVDA, AAPL, GOOGL, AMZN, META, MSTR, COIN, HOOD, CRCL and MU. MSFT had 2,879 minutes and 191 of 192 15-minute boundaries.
- **Guard:** zero divergence drops.
- **Inputs:** at least 4 kept at every priced minute.
- **Anchors only vs all 9:** median 0.55 to 3.85 bps apart, p95 at most 8.01 bps (MSTR).
- **Resistance to one bad venue (method lens):** replacing one input with a 10x print moved the composite by a median 0.9 to 1.9 bps, at most 8.4 bps.

**Edge rule** (stocks.ts, new): refuse a round shorter than 4 hours whose start and end fall on different sides of an exchange/composite edge (04:00 or 20:00 ET, early close, holidays). The composite sat a median 5.4 bps from the Friday 19:59 ET close and 13.8 bps from the Monday 04:00 ET open. Median 15-minute moves were 1.4 to 5.6 bps. The 4-hour line is my judgment from those numbers.

## 4. The Pyth decision

**Measured**
- Last Pyth print Fri 19:59:59 ET. Hermes returns 404 in the gap.
- The Sunday 20:00:00 ET reopen print carries a synthetic `prev_publish_time` (pub minus 1 s). VOO's first print is 20:00:01.
- So no boundary strictly inside the gap can ever satisfy `prev < boundary <= publish`.
- Weekdays print continuously at 1-second cadence. The oracles lens accepted boundaries at Thu 03:59:59, 04:00:00, 19:59:59, 20:00:00 and 20:00:01 ET.
- Labor Day was a 72 h gap with no Sunday overnight session.
- The app models Pyth as 9:30 to 16:00 (priceClock.ts, stocks.ts). That wrongly blocks fights at hours Pyth does print, and it treats the weekend gap as "waits" when it actually means "never".

**Option A: everything stays on Pyth.** Add a correct 24/5 model and refuse fights whose boundaries can land in a gap.
- For each trading day D, Pyth prints from 20:00 ET on the calendar day before D to 20:00 ET on D. On early-close days, end at 13:00 ET; that is the conservative choice and it is unverified.
- Refuse any Pyth-side boundary within 60 s of a span edge, or outside all spans. Check the start (accept plus 2 s, across the 90 s take slack) and the end.
- Pros: trustless on-chain verification. Cons: TSLA and QQQ are still dark for 48 hours every weekend and on holidays.

**Option B: `set_asset` TSLA and QQQ to SOURCE_SIGNED** with the composite.
- Pros: both fight around the clock.
- Cons: they trust the app's oracle key, and the weekend price is a perp and token median, not the listing. QQQ rests on two anchors, one of which is Binance's data host, which answers from here while api.binance.com returns 451.

**Recommendation: Option B for TSLA and QQQ, Option A for VOO.**
- The owner's ask is 24/7, and TSLA is the flagship with 5 real anchors. VOO has no weekend market anywhere.
- The Option A hours fix ships regardless, for VOO and for any in-flight TSLA or QQQ Pyth duels. Duels record their source at creation, so `set_asset` changes only new fights.
- Rejected: flipping `set_asset` on a schedule (Pyth on weekdays, signed at weekends). A Friday challenge accepted later would still be Pyth, and it needs admin transactions twice a week.
- Condition: if Binance is removed from the whitelist, QQQ keeps Pyth unless the builder qualifies Lighter QQQ, which was at 89.6%.

## 5. Build plan

**Step 0: preserve the evidence.** Do this before Tue 15 Sep about 11:00 UTC, when HL starts dropping Saturday minutes.
- Copy these into `~/stonkwars-research/weekend-2026-09-12/`, outside both repos: `/tmp/hlr_data/c1m`, `/tmp/sw247/{data,breadth,hl}`, `/tmp/cexr/analysis_rows.json`, `/tmp/cr_data/v`, `/tmp/lead_count2.json`, `/tmp/lead_sim.json`. WSL `/tmp` is not durable.
- Trim fixtures (t, c, v/n only) for the 12 tickers across 9 venues, Fri 23:00 to Mon 01:00 UTC, into `tests-web/fixtures/weekend-2026-09-12/`.
- Accept when: a fixture loader test reads all of them and the fixture size is recorded.

**Step 1: Pyth 24/5 hours model.** Files: `src/lib/market.ts` (a `pythSpanAt` function), `src/lib/stocks.ts` (`firstPriceAt`, `priceTimeAt`, `pricedAt`, `mixedHoursAt` with a new "never settles" sentence), `src/lib/priceClock.ts` (the Pyth branch of `sideReady`), `src/lib/crank.ts` (a Pyth side stuck in a gap shows the refund path, not "shut").
- Accept when `tests-web/market.test.ts`, `stocks.test.ts` and `priceClock.test.ts` pass these cases:
  - TSLA boundary Fri 19:58:59 ET allowed; Fri 19:59:30 refused; Saturday refused.
  - Sun 20:00:30 ET refused; Sun 20:01:00 allowed.
  - Thu 03:59:59 allowed.
  - Sun 6 Sep 21:00 ET refused; Mon 7 Sep 20:01 ET allowed.
  - The existing second-for-second agreement test between stocks.ts and priceClock still holds.

**Step 2: composite core.**
- New `src/lib/composite.ts`: a pure function (steps 1 to 8 above) plus the canonical proof JSON.
- New `src/lib/venues247.ts`: 9 fetchers with a 5 s timeout, caching finished windows only, Bitget calls serialized.
- `src/lib/oracle.ts`: `sourceAt` returns "composite" for `b >= COMPOSITE_FROM`. The legacy perp and pool paths stay for earlier boundaries. `quoteAt` returns `{ waitUntil }` on tier (b).
- Accept when `tests-web/composite.test.ts` on the fixtures reproduces the 2,880/2,880 and 2,879/2,880 quorum figures, plus these determinism cases:
  - Shuffling venue order changes nothing.
  - Appending HL flat candles after m changes nothing.
  - An every-minute venue missing candle m with no later candle returns null.
  - A 429 returns null.
  - A 10x print is dropped and moves the median by at most 10 bps.
  - The same inputs give the same sha256.

**Step 3: roster builder.** New `scripts/build-247.ts` replaces running `build-perps.ts` and `build-pools.ts` (keep their JSON for legacy boundaries). It writes `src/data/venues247.json`.
- **Identity:**
  - A same-minute close within 1.5% of Yahoo during a regular-session minute. That catches Gate PG at 0.943x and Gate TFC at 0.78x.
  - A name check against venue metadata (HL `perpAnnotation`, OKX and Bitget contract names).
  - A denylist: CL, BZ, SHEIN, SKHX, and the Lighter, main-dex and Binance crypto collisions (SUI, STX, SNX, W, STRK, AR, MET, LIT, DASH, ARB, DG).
  - Map PURR to `xyz:PURRDAT`.
- **Liveness:** weekend 15-minute freshness of at least 90% from 1m data (a `--cache` directory for last weekend). Pin a venue as an input at 50% or more.
- **Badge:** at least 2 anchors and at least 3 venues at 90%.
- Accept when: with the Step 0 cache, the output contains all 36 three-anchor names, and any difference from the 48 in section 2 is explained per ticker in the log.

**Step 4: hours and UI.**
- `src/lib/stocks.ts`: `tradesAroundTheClock` and `AROUND_THE_CLOCK` read venues247, `pricedAt` returns "composite", and the new edge rule applies to rounds under 4 hours.
- `src/app/new/CreateFight.tsx`: a "24/7: median of N markets" badge and the refusal sentences.
- `src/app/f/[duel]/FightView.tsx`: a per-venue Proof table.
- `src/app/how/page.tsx` and `src/app/page.tsx`: count and copy, including "a perp is not the share".
- Accept when: the stocks and priceClock tests pass; the badge count equals the venues247 badge count; and every URL in a rendered proof table, fetched again, returns the listed close.

**Step 5: quote and proof routes.** `src/app/api/quote/route.ts` returns the proof alongside the quote; new `src/app/api/quote/proof/route.ts`.
- Accept when: two calls 5 minutes apart return byte-identical quotes and the same sha256.

**Step 6: flip TSLA and QQQ.**
- Set the `roster.json` source overrides in `scripts/build-roster.ts`.
- Run the devnet admin `set_asset(feed, enabled, SOURCE_SIGNED)` for TSLA and QQQ.
- Accept when:
  - The registry reads back source signed.
  - A new TSLA challenge shows the 24/7 badge.
  - A VOO challenge at Fri 19:30 ET with a 1-hour round is refused with the Pyth sentence.

**Step 7: cutover and deploy.**
- Set `COMPOSITE_FROM` as a boundary time.
- Before deploying, `scripts/duel-status.ts` must show no live duel whose start is before `COMPOSITE_FROM` and whose unpriced end falls in a closed session after it.
- Run `next build`, not only `tsc`, since tsc has passed while the Vercel deploy died.
- From the deployed function, probe all 9 venue hosts. Any 451 or 403 from the Vercel region means removing that venue from venues247 and rebuilding the counts.
- Accept when: the build is green and 9 of 9 hosts return 200 from Vercel, or the counts are updated.

**Step 8: devnet end-to-end on a weekday night** (Tue 15 or Wed 16 Sep after 20:00 ET, when `session()` is closed)
- Fund the test wallet first.
- Keep the fight page visible or run `scripts/settler.ts`, because a hidden Browser pane pauses the nudge.
- Run three 15-minute fights: TSLA (signed) vs NVDA, WDC vs AVGO, SPY vs QQQ.
- Accept when:
  - Every start and settle lands.
  - Each on-chain price equals the proof route's median exactly.
  - Start `publish_time` is m+60 and the crank's first try is at m+80.
  - The proof table shows every venue row.

**Schedule:** steps 0 to 3 on Tuesday, 4 to 7 on Wednesday, 8 on Wednesday night, fixes and freeze on Thursday. No real weekend will occur before the Friday 4pm ET deadline, so the weekend claims rest on the fixtures.

## 6. Risks and what could not be verified

- **Evidence base:** one weekend (12 and 13 Sep). CEX freshness for most tickers is a proxy built from two probe hours and hourly liveness. Exact minute freshness exists only for HL, Lighter, Backpack and the 12 archived tickers.
- **Possibly synthetic flow:** MEXC (zero fees) and BingX print every minute even on BRK.B on a Saturday, and Gate prints trades without close changes. Who trades there is unverified. The rule never lets them make quorum alone.
- **Independence:** OKX's index weights the Hyperliquid oracle at 0.343 (arXiv 2608.09188) and MEXC's index draws on Binance, Bitget, Pyth and Kaiko. Trade prices come from separate books, but market makers may quote off the same references.
- **Perp and ETF risks:** a perp is not the share. Leveraged ETFs on perps can understate big gaps (KORU reached -8.89% against a discovery bound while the real move was -12.25%). HL has delisted 16 xyz markets with no notice policy found.
- **Honest disagreement:** 15-minute weekend fights differed from xyz-alone 14.9% of the time. Two disjoint honest half-composites agreed on the winner 83.1% at 15 minutes, 90.7% at 60 and 95.2% at 4 hours.
- **Reachability and terms:**
  - Venue reachability from Vercel's region is not verified; this machine is a US IP.
  - api.binance.com returns 451, and relying on data-api.binance.vision is an unresolved terms question.
  - Bybit is blocked.
  - No venue terms were reviewed.
- **Retention:** HL 1m is at least about 3.47 days, trimmed periodically at an unknown time; Gate is under 7 days. Proof recompute is partial after those limits.
- **Pyth assumptions:**
  - Weekday overnight continuity rests on the oracles lens's Thursday probes.
  - Early-close hours for Pyth are unverified; the model is conservative.
  - Pyth Indices (`pyth-indices` group, 22 roster tickers) might keep TSLA trustless 24/7 if Pyth grants access, but weekend cadence and price are unverified and not requested.
- **Implementation details to confirm in Step 2 tests:** Lighter timestamp units (the lenses disagree on ms vs s) and the `count_back` override. Backpack's window quirk is known.
- **Program:**
  - `quote.rs` has no upper bound on `publish_time`; a future-dated report was the Ostium exploit.
  - `MAX_QUOTE_LAG_SECS` is defined in constants.rs but never referenced.
  - Both are post-hackathon program changes.
- **Not verified:** HTX and KuCoin hourly liveness (they are excluded from all counts, and KuCoin TSLA perp had 0 Saturday-hour trades), Orderly zero-volume behaviour, GeckoTerminal re-derivation, Binance USD-M perps, Coinbase's methodology page, and HL setOracle ordering relative to a boundary (likely given its 3.011 s cadence).
- **The stuck TSLA fight** (accepted Fri 11 Sep 22:21 ET) cannot be priced. Per `STALL_REFUND_SECS` it is refundable from Fri 18 Sep 22:21 ET, after the deadline.

My analysis scripts and outputs are in WSL: `/tmp/lead_count2.py`, `/tmp/lead_count2.json`, `/tmp/lead_sim.py`, `/tmp/lead_sim.json`, plus `lead_count.py`, `lead_count3.py` and `lead_table.py`. Nothing was written to either repo or committed.