# Stonk Wars 24/7: hardening the composite before it ships

Composite-v1 (docs/247-pricing.md, section 3) was never used for a live fight: `COMPOSITE_FROM` is still a future placeholder. An adversarial study on last weekend's minutes showed that a single print on a single venue decides most short rounds under v1. This document records what replaced it, composite-v2, and the measurements behind its two numbers: the window length W and the shortest round it may price, `MIN_OFFHOURS_ROUND_SECS`.

Every figure here comes from `scripts/attack-247.ts`, run on the fixtures in `tests-web/fixtures/weekend-2026-09-12/`. Those fixtures hold the real one-minute rows for 12 stocks at 9 venues, Fri 11 Sep 23:00 UTC to Mon 14 Sep 01:00 UTC. The harness makes no network requests. Its full output is `scripts/data/attack-247.json`, and `tests-web/compositeV2.test.ts` re-runs it for TSLA and checks the result against that file.

## 1. The answer

- **Rule:** composite-v2, in `src/lib/composite.ts` (`compositeV2At`). v1 stays exported: it is v2's calibration reference, and its tests still pass.
- **Window:** W = 3 minutes. The price is stamped at the end of the window, m + 180 s.
- **Shortest round:** 12 hours (`MIN_OFFHOURS_ROUND_SECS` = 43,200). This applies to any fight with a boundary priced by the composite, except a bell round that ends in session.
- **Knock-out:** one venue can no longer send a priced side to Monday's bar from inside the window. Which venues count is fixed before the window opens.
- **What one venue can still do:** a push of 60 bps held through the window moves a v2 price by a median of 0.34 to 0.90 bps, depending on the stock (p90 0.83 to 2.22). Under v1, a single print in the minute changed 19.7% to 62.8% of 15-minute rounds.

## 2. The rule

Let b be the boundary and m = floor(b / 60) * 60.

1. **Rows.** Each pinned venue is asked for one span, from m - 90 minutes to the window's last minute, m + 120 s (`venueRequestV2`). Venue semantics are the same as v1's. OKX returns at most 100 rows per request, so W can be at most 10.
2. **Reference.** R(j) is v1's median at minute j: at least 3 fresh venues, at least 2 of them anchors, the 50 bps guard, then the median. There is no breaker and no fallback. R(j) is empty where v1 has no quorum.
3. **Premium.** For each venue v and window minute k, the premium is the median of close_v(j) / R(j), in 1e-8.
   - j runs from k - 75 to min(k - 6, m - 1), counting only minutes where v was fresh and R(j) exists.
   - At least 10 such minutes are needed.
   - The calibrated close is close_v(k) / premium, rounded half up in integer ticks.
   - For W up to 6, no calibration minute is ever inside the window.
4. **Who counts.** A venue counts if it is fresh at minute m - 1 (a trade in m - 15 to m - 1) and has a premium at every minute of the window. This is settled before the window opens.
5. **Tier.** At least 3 counted venues with at least 2 anchors: the median tier. Otherwise the side takes the exchange's first bar after b, exactly as v1's tier (b). There is no two-anchor tier: with two venues, either one moves their mean by half of whatever it prints.
6. **Each minute.** Take the median of the counted calibrated closes, then drop any close more than 50 bps from it. If what is left still has 3 venues with 2 anchors, the minute's value is the median of what is left. Otherwise it is the median of all counted closes.
7. **Price.** The median of the W minute values, stamped m + W * 60. The program only requires publishTime >= boundary.
8. **Breaker.** A price more than 15% from the exchange's last close counts as a failed quorum, as in v1.
9. **Proof.** For each venue:
   - the request;
   - its last traded candle before the window, and whether it was fresh and counted (with the reason if not);
   - for every window minute: candle, close, ticks, premium, sample count, calibrated close, and whether it was kept.

   For each minute: the guard centre, the value, how many were kept, and whether the guard held. Then the window, the calibration parameters, the time median, the reference (only when a price was checked against it), the tier, the reason, and the price. The sha256 is taken over the canonical JSON.

**Timing.** Nothing is fetched before m + 180 + 20 s. The price clock (`priceClock.ts`, `why: "composite-window"`), `stocks.ts` `priceTimeAt` and the crank's retry schedule all use `compositePublishTime`. The grid test in `tests-web/stocks.test.ts` holds them together to the second.

## 3. How it was measured

- **Honest prices.** A price for every window start from Sat 12 Sep 00:00 UTC onward, built from the rule's own exported pieces. Every 97th priced window per stock is checked against `compositeV2At` itself; 30 per stock, all equal. Every honest per-minute value is checked against `minuteMedian`.
- **The attack.**
  - One counted venue prints at its own calibrated close times (1 + g), with g from -60 to +60 bps in 1 bp steps. Each minute is searched separately.
  - "Held through the window" pushes every minute. The time median is monotone in each minute, so the largest move is the median of each minute's largest move.
  - "One minute" pushes only the best single minute.
  - The push is applied to the calibrated close. That equals a push on the raw close to within a tick of rounding.
- **Rounds.**
  - Start window at s, end boundary at s + W + D (the program's end_ts), for D of 15 min, 1 h, 4 h, 12 h and 24 h.
  - A round counts when both windows are priced by the median.
  - A round is changeable when the push can change the sign of end minus start. A tie counts as a change. This is the stock against a flat opponent.
- **Attack positions.**
  - "Both ends": the same venue pushes the start one way and the end the other. Rounds where a push at only one end suffices are included.
  - "End only" and "start only" are the one-sided cases.

## 4. Choosing W

The worst stock's share of rounds one venue can change:

| W | Push | 15m | 60m | 4h | 12h | 24h | Shortest round at 5% or less |
|---|---|---|---|---|---|---|---|
| 1 | held, both ends | 38.2% | 16.4% | 9.2% | 2.8% | 5.0% | 12h |
| 3 | held, both ends | 35.5% | 16.4% | 9.2% | 2.6% | 5.2% | 12h |
| 5 | held, both ends | 32.4% | 15.8% | 9.1% | 2.6% | 5.2% | 12h |
| 9 | held, both ends | 28.7% | 15.2% | 9.5% | 2.5% | 4.8% | 12h |
| 1 | one minute each end | 38.2% | 16.4% | 9.2% | 2.8% | 5.0% | |
| 3 | one minute each end | 16.9% | 7.5% | 4.3% | 1.4% | 3.4% | |
| 5 | one minute each end | 12.3% | 6.4% | 4.0% | 1.2% | 2.5% | |
| 9 | one minute each end | 9.2% | 5.0% | 3.3% | 1.2% | 2.2% | |

**Reading it**
- Against a push held through the window, the window length barely matters. The de-biasing does the work: once calibrated, the venues sit so close together that one venue can only move the median as far as its neighbour.
- The shortest round at or under 5% is 12 hours for every W measured.
- W = 1 is not a time median. A single print in its one minute moves it as far as a held push does, which is why its two rows are identical.
- W = 3 is the smallest real window. It halves what a single minute can do at 15 minutes (38.2% to 16.9%) and at 12 hours (2.8% to 1.4%).
- Longer windows help single prints a little more, but they stamp the price later, which moves it further from any side priced at the boundary.
- **So W = 3.**

## 5. The shortest round priced off-hours

With W = 3, each stock's share of rounds one venue can change. Cells show both ends / end only.

| Ticker | Priced starts | Push p50 / p90 bps | 15m | 60m | 4h | 12h | 24h |
|---|---|---|---|---|---|---|---|
| TSLA | 2880 of 2880 | 0.34 / 0.83 | 13.9% / 7.1% | 6.9% / 4.0% | 1.7% / 1.3% | 1.2% / 0.5% | 0.3% / 0.3% |
| NVDA | 2880 of 2880 | 0.45 / 0.91 | 15.6% / 8.2% | 4.5% / 2.6% | 4.0% / 2.2% | 0.8% / 0.2% | 0.1% / 0.0% |
| AAPL | 2880 of 2880 | 0.39 / 0.91 | 20.5% / 9.7% | 11.0% / 6.2% | 5.2% / 2.8% | 1.8% / 1.1% | 0.9% / 0.4% |
| GOOGL | 2880 of 2880 | 0.55 / 1.18 | 17.2% / 9.4% | 6.1% / 3.4% | 3.1% / 2.2% | 0.6% / 0.5% | 0.3% / 0.1% |
| AMZN | 2880 of 2880 | 0.68 / 1.67 | 35.5% / 17.6% | 16.4% / 8.7% | 9.2% / 4.7% | 2.6% / 0.7% | 4.7% / 3.1% |
| META | 2880 of 2880 | 0.61 / 1.39 | 25.0% / 13.2% | 9.0% / 4.8% | 5.4% / 3.6% | 1.4% / 1.0% | 1.9% / 1.2% |
| MSTR | 2880 of 2880 | 0.58 / 1.25 | 10.5% / 5.3% | 5.9% / 3.0% | 2.4% / 1.4% | 0.4% / 0.1% | 0.3% / 0.2% |
| COIN | 2880 of 2880 | 0.86 / 1.87 | 23.8% / 12.7% | 11.0% / 6.1% | 5.2% / 3.0% | 0.3% / 0.1% | 5.2% / 2.9% |
| HOOD | 2880 of 2880 | 0.90 / 2.22 | 19.1% / 9.8% | 9.0% / 5.3% | 3.2% / 1.9% | 2.3% / 1.4% | 0.1% / 0.0% |
| CRCL | 2880 of 2880 | 0.66 / 1.19 | 11.9% / 6.2% | 4.1% / 2.5% | 1.7% / 1.1% | 0.5% / 0.2% | 0.4% / 0.1% |
| MU | 2880 of 2880 | 0.36 / 0.91 | 7.4% / 3.6% | 2.8% / 1.3% | 1.7% / 0.8% | 0.9% / 0.6% | 0.0% / 0.0% |
| MSFT | 2879 of 2880 | 0.46 / 1.12 | 29.4% / 14.8% | 12.0% / 6.3% | 6.2% / 3.0% | 0.7% / 0.5% | 0.2% / 0.0% |
| **worst, both ends** | | | **35.5%** | **16.4%** | **9.2%** | **2.6%** | **5.2%** |
| worst, end only | | | 17.6% | 8.7% | 4.7% | 1.4% | 3.1% |
| worst, start only | | | 20.5% | 8.7% | 4.3% | 1.9% | 3.7% |

**Decision**
- `MIN_OFFHOURS_ROUND_SECS` = 12 hours: the shortest measured round at or under 5% for every stock.
- 15 minutes, 1 hour and 4 hours all fail, for AMZN, MSFT, META and COIN.

**The 24-hour column**
- AMZN (4.7%) and COIN (5.2%) are higher at 24 hours than at 12. The weekend is 48 hours, so 24-hour rounds overlap heavily: about two independent windows.
- Both stocks sat near the same level from Saturday to Sunday, so many 24-hour moves were small.
- Across windows the 24-hour column reads 5.0%, 5.2%, 5.2% and 4.8% with no trend. That is the noise of one weekend, not a rule that longer rounds are weaker.
- Rounds over 24 hours were not measured, because the fixtures cannot hold them.

**Bell rounds that end in session**
- They are exempt, as the brief says.
- Their end is the exchange's, so a push can only reach the start.
- A composite start is at 20:00 to 04:00 ET or a weekend, and the next bell is at 15:59:30 (12:59:30 on a half day). So such a round runs at least 9 hours.
- The worst start-only share is 4.3% at 4 hours and 1.9% at 12 hours.

## 6. composite-v1, for comparison

One print on one venue in the end minute, or in the start and end minutes, marked fresh, on raw closes, with v1's own fallbacks. A print that breaks the quorum counts as a change, because the side would then be priced on Monday. Cells show both ends / end only.

| Ticker | Knocked to the exchange | 15m | 60m | 4h | 12h | 24h |
|---|---|---|---|---|---|---|
| TSLA | 0.0% | 41.7% / 23.9% | 20.6% / 11.6% | 5.7% / 3.5% | 3.4% / 1.9% | 1.1% / 0.7% |
| NVDA | 0.0% | 38.2% / 22.4% | 12.2% / 6.1% | 8.4% / 4.8% | 2.6% / 1.1% | 0.7% / 0.3% |
| AAPL | 0.0% | 62.8% / 39.0% | 39.3% / 20.1% | 16.1% / 8.2% | 7.8% / 3.1% | 3.2% / 1.7% |
| GOOGL | 0.0% | 38.5% / 22.2% | 16.4% / 9.6% | 9.2% / 5.7% | 0.7% / 0.3% | 1.1% / 0.4% |
| AMZN | 1.3% | 59.6% / 35.4% | 34.0% / 17.0% | 18.3% / 10.0% | 9.4% / 5.0% | 11.5% / 4.5% |
| META | 0.7% | 46.6% / 25.5% | 19.4% / 9.9% | 12.0% / 5.7% | 3.3% / 1.4% | 5.6% / 1.7% |
| MSTR | 0.0% | 30.3% / 16.1% | 16.3% / 9.0% | 7.5% / 3.5% | 2.6% / 1.0% | 1.9% / 1.1% |
| COIN | 0.3% | 49.4% / 29.1% | 23.3% / 12.1% | 10.5% / 5.0% | 1.5% / 0.7% | 11.1% / 6.7% |
| HOOD | 0.2% | 36.5% / 21.1% | 20.3% / 10.6% | 7.9% / 4.1% | 4.8% / 2.5% | 0.6% / 0.4% |
| CRCL | 0.0% | 19.7% / 11.4% | 6.1% / 3.3% | 2.3% / 1.3% | 0.6% / 0.4% | 0.9% / 0.4% |
| MU | 0.0% | 25.1% / 13.6% | 8.6% / 4.6% | 5.8% / 2.9% | 2.4% / 1.2% | 0.0% / 0.0% |
| MSFT | 1.1% | 54.7% / 33.9% | 28.2% / 15.6% | 16.3% / 7.5% | 6.9% / 3.3% | 3.6% / 1.0% |

**How this compares with the study**
- Its v1 knock-out rates for these 12 stocks are 0% to 1.3%.
- The study's 5.4% pooled figure is driven by thin names (GPRO 99.5%, HPE 100%) that are not in these fixtures.
- For v1 the "both ends" column allows a different venue at each end.

## 7. What this does not show

- **Evidence base.** One weekend, and 12 stocks that are among the most liquid 24/7 names. Thinner listed names have fewer counted venues and larger gaps between them. The roster rule below requires 3 anchors for that reason.
- **Cost.** No order books were read, so a changeable round is an opportunity, not a measured profit.
- **Attacks not modelled:**
  - Two venues colluding.
  - A push held long enough to move a premium: more than half of up to 70 calibration minutes.
  - A start push feeding the end window's calibration. This only reaches rounds under 81 minutes, which the minimum refuses.
  - Pre-window prints that make a stale venue count. This needs trades in the 15 minutes before the window and 10 or more calibration minutes. It can add a venue to the count but not remove one, and it happens before the boundary, where a taker can see it.
- **Pairs.** The opponent is flat. Two stocks that move together, such as two semiconductor names, are closer than this, and two that do not are further apart.
- **Timing against a side priced at the boundary.** A composite side is stamped up to 3 minutes after its boundary. A Pyth side (VOO) or an exchange side in session (a Hong Kong stock at 21:30 ET) is stamped within a minute. So such a pair lands more than `SAME_PRICE_SECS` apart and is refused, with a sentence that says so.
