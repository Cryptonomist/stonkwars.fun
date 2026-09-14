/* Composite-v1, held to last weekend's minutes and to its own promises.
 *
 * The plan (docs/247-pricing.md) measured the rule on the minute data the
 * research saved for 12 and 13 Sep 2026, and those minutes are the fixtures
 * here (tests-web/fixtures/weekend.ts). Its figures are reproduced from them
 * through the real composite.ts, not a copy of the rule. Then the promises the
 * plan's step 2 names: the answer does not depend on the order venues come
 * in, on quiet candles printed after the minute, or on when anybody asked, and
 * a venue that did not answer is a wait, never a venue left out.
 *
 * Every test that reaches a network replaces fetch, so nothing leaves the
 * machine. The venues it stands in for answer with last weekend's rows, in the
 * body shape and window semantics each venue was seen to use live on 14 Sep
 * (venues247.ts, venueRequest), moved one week later so the boundary falls
 * after COMPOSITE_FROM. Only the fields the rule reads are filled in. */

import { expect } from "chai";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  canonicalJson,
  closeText,
  COMPOSITE_FROM,
  compositeAt,
  medianTicks,
  proofHash,
  sha256Hex,
  toTicks,
  VENUES,
  type Candle,
  type CompositePriced,
  type CompositeResult,
  type Reference,
  type VenueId,
  type VenueWindow,
} from "../src/lib/composite";
import { retryAt, PERP_FAST_RETRY_WINDOW_SECS, PERP_SLOW_RETRY_SECS } from "../src/lib/crank";
import { SOURCE_SIGNED, START_DELAY_SECS, type DuelView } from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import {
  answerAt,
  BAR_SETTLE_SECS,
  compositeParkedUntil,
  exchangeBarFinal,
  FETCH_TIMEOUT_MS,
  firstBarEnd,
  quoteAt,
  sourceAt,
  TooOld,
  type Answer,
} from "../src/lib/oracle";
import { readyAt, type ClockDuel, type MarketLookup } from "../src/lib/priceClock";
import {
  fetchVenueWindow,
  forgetVenueWindows,
  inputsAt,
  listed247,
  parseVenueBody,
  parseVenues247,
  VENUES247,
  venueRequest,
  windowFinished,
  type PinnedInput,
} from "../src/lib/venues247";
import { WEEKEND_MON, WEEKEND_SAT, WEEKEND_TICKERS, WEEKEND_VENUES, weekendMinutes, type Minute, type WeekendVenue } from "./fixtures/weekend";

const VENUE_OF: Record<WeekendVenue, VenueId> = {
  xyz: "hyperliquid",
  okx_perp: "okx",
  bitget_perp: "bitget",
  binance_bstock: "binance",
  lighter_perp: "lighter",
  backpack_perp: "backpack",
  gate_perp: "gate",
  mexc_perp: "mexc",
  bingx_perp: "bingx",
};

type YahooRow = [number, number];
const YAHOO = JSON.parse(readFileSync(resolve(__dirname, "fixtures/weekend-2026-09-12/yahoo.json"), "utf8")) as {
  rows: Record<string, { friday: YahooRow; monday: YahooRow }>;
};

const fridayClose = (ticker: string): Reference => {
  const [t, c] = YAHOO.rows[ticker].friday;
  return { t, close: closeText(c)! };
};

/** One stock's minutes at every venue that lists it, as the rule's candles. */
function weekendSeries(ticker: string) {
  return WEEKEND_VENUES.flatMap((v) => {
    const rows = weekendMinutes(v, ticker);
    return rows ? [{ venue: VENUE_OF[v], rows: rows.map((r): Candle => ({ t: r.t, close: closeText(r.c)!, traded: r.traded })) }] : [];
  });
}

/** Each venue's window for minute m, as a fetch at m + 80 would have seen it:
 *  the hour up to and including m. Rows are in time order, so two binary
 *  searches cut it. */
function windowsAt(series: ReturnType<typeof weekendSeries>, ticker: string, m: number): VenueWindow[] {
  const firstAtOrAfter = (rows: Candle[], t: number) => {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return series.map((s) => ({
    venue: s.venue,
    instrument: ticker,
    request: { method: "GET" as const, url: `fixture:${s.venue}/${ticker}/${m}` },
    rows: s.rows.slice(firstAtOrAfter(s.rows, m - 3_600), firstAtOrAfter(s.rows, m + 1)),
  }));
}

const weekendComposite = (ticker: string, m: number, windows: VenueWindow[]) =>
  compositeAt({
    boundary: m,
    now: m + 60 + BAR_SETTLE_SECS,
    settleSecs: BAR_SETTLE_SECS,
    windows,
    reference: fridayClose(ticker),
    exchangeFinal: exchangeBarFinal(m),
  });

const priced = (r: CompositeResult): CompositePriced => {
  if (!("price" in r)) throw new Error(`expected a price, got ${JSON.stringify(r)}`);
  return r;
};

/** A minute the plan's determinism cases use: Saturday 12 Sep, 16:00 UTC. */
const SAT16 = 1_789_228_800;

describe("composite-v1", () => {
  /* ─── The plan's figures ─────────────────────────────────────────────────── */

  describe("on last weekend's minutes", function () {
    this.timeout(300_000);

    type Tally = { byMedian: number; other: { m: number; result: CompositeResult }[]; boundaries15: number; minKept: number; dropped: number };
    const tally = new Map<string, Tally>();

    before(() => {
      for (const ticker of WEEKEND_TICKERS) {
        const series = weekendSeries(ticker);
        const t: Tally = { byMedian: 0, other: [], boundaries15: 0, minKept: Infinity, dropped: 0 };
        for (let m = WEEKEND_SAT; m < WEEKEND_MON; m += 60) {
          const result = weekendComposite(ticker, m, windowsAt(series, ticker, m));
          if ("price" in result && result.tier === null) {
            t.byMedian++;
            if (m % 900 === 0) t.boundaries15++;
            t.minKept = Math.min(t.minKept, result.proof.kept);
            t.dropped += result.proof.venues.filter((v) => v.why === "diverged").length;
          } else {
            t.other.push({ m, result });
          }
        }
        tally.set(ticker, t);
      }
    });

    it("prices all 2,880 minutes by the median for eleven of the twelve stocks, as the plan measured", () => {
      for (const ticker of WEEKEND_TICKERS.filter((t) => t !== "MSFT")) {
        expect(tally.get(ticker)!.byMedian, ticker).to.equal(2_880);
        expect(tally.get(ticker)!.boundaries15, ticker).to.equal(192);
      }
    });

    /* The one MSFT minute is Saturday 11:30 AM ET. Four markets had traded in
     * the 15 minutes before it, but only one anchor, Hyperliquid: OKX,
     * Bitget, Binance and Lighter had last traded at 11:14. Gate, MEXC and
     * BingX can never be the two anchors, so the rule falls back, and with
     * one fresh anchor there is no two-anchor price either: the exchange's
     * first bar after it, Monday 4:01:20 AM ET. */
    it("prices 2,879 of MSFT's minutes and 191 of its 192 fifteen-minute boundaries, and sends the other to the exchange", () => {
      const msft = tally.get("MSFT")!;
      expect(msft.byMedian).to.equal(2_879);
      expect(msft.boundaries15).to.equal(191);
      expect(msft.other).to.have.length(1);
      const [{ m, result }] = msft.other;
      expect(m).to.equal(1_789_227_000);
      expect(m).to.equal(Math.floor(nyToMs(2026, 9, 12, 11, 30) / 1000));
      if (!("waitUntil" in result)) throw new Error(JSON.stringify(result));
      expect(result.waitUntil).to.equal(Math.floor(nyToMs(2026, 9, 14, 4, 1, 20) / 1000));
      expect(result.proof.tier).to.equal("exchange");
      expect([result.proof.fresh, result.proof.freshAnchors]).to.deep.equal([4, 1]);
      expect(result.proof.venues.filter((v) => v.fresh).map((v) => v.venue)).to.deep.equal(["hyperliquid", "gate", "mexc", "bingx"]);
    });

    /* The plan's "zero divergence drops" is its simulation's count of minutes
     * the guard cost the quorum, and that is zero here too. The guard did
     * drop 36 single closes while the quorum held, which lead_sim.py's own
     * state() and 50 bps band count identically: GOOGL 12 (Lighter and
     * Backpack), MSTR 2 and COIN 9 (MEXC), HOOD 6 and MU 3 (Backpack), CRCL 4
     * (Lighter). */
    it("loses no minute to the divergence guard, drops 36 single closes, and keeps at least 4 inputs at every priced minute", () => {
      const dropped = Object.fromEntries(WEEKEND_TICKERS.map((t) => [t, tally.get(t)!.dropped]));
      expect(dropped).to.deep.equal({ TSLA: 0, NVDA: 0, AAPL: 0, GOOGL: 12, AMZN: 0, META: 0, MSTR: 2, COIN: 9, HOOD: 6, CRCL: 4, MU: 3, MSFT: 0 });
      const minKept = Object.fromEntries(WEEKEND_TICKERS.map((t) => [t, tally.get(t)!.minKept]));
      expect(Math.min(...Object.values(minKept))).to.equal(4);
      expect(minKept.AMZN).to.equal(4);
      // Nothing tripped the breaker: every non-median answer is MSFT's one fallback.
      expect(WEEKEND_TICKERS.reduce((n, t) => n + tally.get(t)!.other.length, 0)).to.equal(1);
    });
  });

  /* ─── The plan's determinism cases ───────────────────────────────────────── */

  describe("determinism", () => {
    const series = weekendSeries("TSLA");
    const windows = windowsAt(series, "TSLA", SAT16);
    const base = priced(weekendComposite("TSLA", SAT16, windows));

    it("prices TSLA at Saturday 16:00 UTC from all nine venues", () => {
      expect(base.tier).to.equal(null);
      expect(base.publishTime).to.equal(SAT16 + 60);
      expect(base.proof.venues.map((v) => v.venue)).to.deep.equal(Object.keys(VENUES));
      expect(base.price.toString()).to.equal(base.proof.price);
    });

    it("gives the same answer whatever order the venues come in", () => {
      for (const order of [[...windows].reverse(), [...windows.slice(4), ...windows.slice(0, 4)]]) {
        const again = priced(weekendComposite("TSLA", SAT16, order));
        expect(again.sha256).to.equal(base.sha256);
        expect(canonicalJson(again.proof)).to.equal(canonicalJson(base.proof));
      }
    });

    it("ignores flat Hyperliquid candles printed after the minute", () => {
      const more = windows.map((w) => {
        if (w.venue !== "hyperliquid" || !("rows" in w)) return w;
        const last = w.rows.at(-1)!;
        const flat = [1, 2, 3].map((k) => ({ t: SAT16 + 60 * k, close: last.close, traded: false }));
        return { ...w, rows: [...w.rows, ...flat] };
      });
      expect(priced(weekendComposite("TSLA", SAT16, more)).sha256).to.equal(base.sha256);
    });

    it("waits when a venue that prints every minute has no candle for it and none after", () => {
      const missing = windows.map((w) => (w.venue === "okx" && "rows" in w ? { ...w, rows: w.rows.filter((r) => r.t !== SAT16) } : w));
      const r = weekendComposite("TSLA", SAT16, missing);
      expect(r).to.deep.equal({ wait: `no candle for ${SAT16} yet at OKX TSLA`, retryAt: null });

      // With a later minute already out, the missing one was simply skipped.
      const skipped = missing.map((w) =>
        w.venue === "okx" && "rows" in w ? { ...w, rows: [...w.rows, { t: SAT16 + 60, close: w.rows.at(-1)!.close, traded: false }] } : w,
      );
      expect("price" in weekendComposite("TSLA", SAT16, skipped)).to.equal(true);
    });

    it("waits on a 429, never leaving the venue out", () => {
      const limited = windows.map((w) => (w.venue === "bitget" ? { venue: w.venue, instrument: w.instrument, request: w.request, error: "HTTP 429" } : w));
      expect(weekendComposite("TSLA", SAT16, limited)).to.deep.equal({ wait: "waiting on Bitget TSLA: HTTP 429", retryAt: null });
    });

    it("drops a 10x print and moves the median by at most 10 bps", () => {
      const bad = windows.map((w) => {
        if (w.venue !== "okx" || !("rows" in w)) return w;
        return { ...w, rows: w.rows.map((r) => (r.t === SAT16 ? { ...r, close: (Number(r.close) * 10).toFixed(2), traded: true } : r)) };
      });
      const r = priced(weekendComposite("TSLA", SAT16, bad));
      const okx = r.proof.venues.find((v) => v.venue === "okx")!;
      expect([okx.fresh, okx.kept, okx.why]).to.deep.equal([true, false, "diverged"]);
      const moved = r.price > base.price ? r.price - base.price : base.price - r.price;
      expect(moved * 10_000n <= 10n * base.price, `moved ${moved} ticks on ${base.price}`).to.equal(true);
    });

    it("hashes the same inputs to the same sha256, which is the sha256 of the canonical JSON", () => {
      const again = priced(weekendComposite("TSLA", SAT16, windowsAt(series, "TSLA", SAT16)));
      expect(again.sha256).to.equal(base.sha256);
      expect(base.sha256).to.equal(createHash("sha256").update(canonicalJson(base.proof), "utf8").digest("hex"));
    });
  });

  /* ─── The rule's parts ───────────────────────────────────────────────────── */

  describe("parts", () => {
    it("turns decimal text into ticks, rounding half away from zero", () => {
      expect(toTicks("359.88")).to.equal(3_598_800n);
      expect(toTicks("366.16505")).to.equal(3_661_651n);
      expect(toTicks("366.16504999")).to.equal(3_661_650n);
      expect(toTicks("0.00005")).to.equal(1n);
      expect(toTicks("175")).to.equal(1_750_000n);
      for (const bad of ["0", "0.00004", "-1", "1e3", "abc", ""]) expect(toTicks(bad), bad).to.equal(null);
      expect(closeText(175)).to.equal("175");
      expect(closeText(359.67)).to.equal("359.67");
      expect(closeText(1e-7)).to.equal("0.0000001");
      expect(closeText(null)).to.equal(null);
    });

    it("takes the middle of an odd count, and rounds the mean of the middle two up", () => {
      expect(medianTicks([5n, 1n, 3n])).to.equal(3n);
      expect(medianTicks([4n, 1n, 3n, 2n])).to.equal(3n); // (2 + 3 + 1) / 2
      expect(medianTicks([2n, 4n])).to.equal(3n);
    });

    it("computes SHA-256 exactly as node:crypto does", () => {
      const inputs = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "b".repeat(1_000), "Priced 24/7: Sat 3:15 AM ET, ünïcödé"];
      for (const s of inputs) expect(sha256Hex(s), s.slice(0, 10)).to.equal(createHash("sha256").update(s, "utf8").digest("hex"));
    });

    it("writes canonical JSON with sorted keys whatever order they were built in", () => {
      expect(canonicalJson({ b: 1, a: [{ d: null, c: "x" }] })).to.equal('{"a":[{"c":"x","d":null}],"b":1}');
      expect(canonicalJson({ a: [{ c: "x", d: null }], b: 1 })).to.equal('{"a":[{"c":"x","d":null}],"b":1}');
    });

    /* Hand-built windows for the tiers: every close and time here is TSLA's
     * at Saturday 16:00 UTC, with venues left out or quietened to make the
     * case. */
    const tsla = windowsAt(weekendSeries("TSLA"), "TSLA", SAT16);
    const quieten = (w: VenueWindow): VenueWindow => ("rows" in w ? { ...w, rows: w.rows.map((r) => ({ ...r, traded: false })) } : w);
    const only = (keep: VenueId[]) => tsla.map((w) => (keep.includes(w.venue) ? w : quieten(w)));

    it("prices two fresh anchors within 25 bps at their mean", () => {
      const r = priced(weekendComposite("TSLA", SAT16, only(["hyperliquid", "binance"])));
      expect(r.tier).to.equal("two-anchor");
      const [a, b] = ["hyperliquid", "binance"].map((v) => BigInt(r.proof.venues.find((x) => x.venue === v)!.ticks!));
      expect(r.price).to.equal((a + b + 1n) / 2n);
      expect(r.proof.venues.filter((v) => v.kept).map((v) => v.venue)).to.deep.equal(["hyperliquid", "binance"]);
      expect(r.proof.reason).to.match(/^2 markets \(2 anchors\) traded/);
    });

    it("sends a side with one fresh anchor to the exchange's first bar, and says when that can be final", () => {
      const r = weekendComposite("TSLA", SAT16, only(["hyperliquid", "gate", "mexc", "bingx"]));
      if (!("waitUntil" in r)) throw new Error(JSON.stringify(r));
      expect(r.waitUntil).to.equal(exchangeBarFinal(SAT16));
      expect(r.proof.tier).to.equal("exchange");
      expect(r.proof.price).to.equal(null);
      expect(r.sha256).to.equal(proofHash(r.proof));
      // No price was checked against the exchange's close, so whether it could be read changes nothing.
      expect(r.proof.reference).to.equal(null);
      for (const reference of [null, { error: "TSLA: market data HTTP 502" }]) {
        const again = compositeAt({ boundary: SAT16, now: SAT16 + 80, settleSecs: BAR_SETTLE_SECS, windows: only(["hyperliquid", "gate", "mexc", "bingx"]), reference, exchangeFinal: exchangeBarFinal(SAT16) });
        expect(again).to.have.property("sha256", r.sha256);
      }
    });

    it("treats a price more than 15% from the exchange's last close as a failed quorum", () => {
      const [t, c] = YAHOO.rows.TSLA.friday;
      const far = { t, close: (c * 0.8).toFixed(2) };
      const r = compositeAt({ boundary: SAT16, now: SAT16 + 80, settleSecs: BAR_SETTLE_SECS, windows: tsla, reference: far, exchangeFinal: exchangeBarFinal(SAT16) });
      if (!("waitUntil" in r)) throw new Error(JSON.stringify(r));
      expect(r.reason).to.match(/bps from the exchange's last close, beyond the 1,500 bps breaker$/);
      expect(r.proof.median).to.not.equal(null);
      expect(r.proof.reference).to.deep.equal({ t, close: far.close, ticks: toTicks(far.close)!.toString() });
    });

    it("waits for the exchange's last close when it cannot be read or is not there", () => {
      const at = (reference: Reference) =>
        compositeAt({ boundary: SAT16, now: SAT16 + 80, settleSecs: BAR_SETTLE_SECS, windows: tsla, reference, exchangeFinal: exchangeBarFinal(SAT16) });
      expect(at({ error: "TSLA: market data HTTP 429" })).to.deep.equal({ wait: "the exchange's last close could not be read: TSLA: market data HTTP 429", retryAt: null });
      expect(at(null)).to.have.property("wait");
    });

    it("asks nothing before the minute is final, and signs nothing older than its venues keep", () => {
      const at = (now: number, windows = tsla) =>
        compositeAt({ boundary: SAT16 + 17, now, settleSecs: BAR_SETTLE_SECS, windows, reference: fridayClose("TSLA"), exchangeFinal: exchangeBarFinal(SAT16) });
      expect(at(SAT16 + 79)).to.deep.equal({ wait: `the minute is not final until ${SAT16 + 80}`, retryAt: SAT16 + 80 });
      expect("price" in at(SAT16 + 80)).to.equal(true);
      // Hyperliquid pinned: three days.
      expect(at(SAT16 + 17 + 3 * 86_400 + 1)).to.have.property("refused").that.matches(/3 days/);
      // Without it, the shortest is Gate's six.
      const noHl = tsla.filter((w) => w.venue !== "hyperliquid");
      expect("price" in at(SAT16 + 17 + 3 * 86_400 + 1, noHl)).to.equal(true);
      expect(at(SAT16 + 17 + 6 * 86_400 + 1, noHl)).to.have.property("refused").that.matches(/6 days/);
    });
  });

  /* ─── The pins and the venues ────────────────────────────────────────────── */

  describe("venues247", () => {
    const pin = (over: Partial<PinnedInput>) => ({ venue: "okx", instrument: "TSLA-USDT-SWAP", from: COMPOSITE_FROM, ...over });
    const file = (inputs: unknown[]) => ({ rule: "composite-v1", tickers: { TSLA: inputs } });

    it("reads the deployed file", () => {
      expect(VENUES247.rule).to.equal("composite-v1");
      expect(listed247("NOT-A-TICKER")).to.equal(false);
    });

    it("refuses pins that are not a venue's own market id, or that would count a venue twice", () => {
      expect(() => parseVenues247(file([pin({ venue: "kraken" as VenueId })]))).to.throw(/unknown venue/);
      expect(() => parseVenues247(file([pin({ instrument: "TSLA-USDT-SWAP&after=1" })]))).to.throw(/is not a OKX instrument/);
      expect(() => parseVenues247(file([pin({ venue: "lighter", instrument: "https://example.com" })]))).to.throw(/Lighter instrument/);
      expect(() => parseVenues247(file([pin({}), pin({ from: COMPOSITE_FROM + 60 })]))).to.throw(/pinned twice/);
      expect(() => parseVenues247(file([pin({ until: COMPOSITE_FROM })]))).to.throw(/until must be a boundary after from/);
      expect(() => parseVenues247(file([{ ...pin({}), url: "x" }]))).to.throw(/unknown field url/);
      expect(() => parseVenues247({ rule: "composite-v2", tickers: {} })).to.throw(/rule must be composite-v1/);
      // Back to back is not twice.
      expect(() => parseVenues247(file([pin({ until: COMPOSITE_FROM + 60 }), pin({ from: COMPOSITE_FROM + 60 })]))).to.not.throw();
    });

    it("pins a market from its from boundary up to, not including, its until", () => {
      const f = parseVenues247(file([pin({ until: COMPOSITE_FROM + 600 }), pin({ venue: "gate", instrument: "TSLA_USDT" })]));
      expect(inputsAt("TSLA", COMPOSITE_FROM - 1, f)).to.deep.equal([]);
      expect(inputsAt("TSLA", COMPOSITE_FROM + 599, f).map((i) => i.venue)).to.deep.equal(["okx", "gate"]);
      expect(inputsAt("TSLA", COMPOSITE_FROM + 600, f).map((i) => i.venue)).to.deep.equal(["gate"]);
    });

    /* The requests as verified live on 14 Sep (see venueRequest). m here is
     * 22:10 UTC that day, the minute the probes asked about. */
    it("builds each venue's fixed request for a minute", () => {
      const m = 1_789_423_800;
      const url = (venue: VenueId, instrument: string) => {
        const r = venueRequest({ venue, instrument }, m);
        return "body" in r ? `${r.method} ${r.url} ${r.body}` : `${r.method} ${r.url}`;
      };
      expect(url("hyperliquid", "xyz:TSLA")).to.equal(
        'POST https://api.hyperliquid.xyz/info {"type":"candleSnapshot","req":{"coin":"xyz:TSLA","interval":"1m","startTime":1789420200000,"endTime":1789423859000}}',
      );
      expect(url("okx", "TSLA-USDT-SWAP")).to.equal("GET https://www.okx.com/api/v5/market/history-candles?instId=TSLA-USDT-SWAP&bar=1m&after=1789423860000&limit=100");
      expect(url("bitget", "TSLAUSDT")).to.equal(
        "GET https://api.bitget.com/api/v2/mix/market/history-candles?symbol=TSLAUSDT&productType=USDT-FUTURES&granularity=1m&startTime=1789420200000&endTime=1789423860000&limit=200",
      );
      expect(url("binance", "TSLABUSDT")).to.equal(
        "GET https://data-api.binance.vision/api/v3/klines?symbol=TSLABUSDT&interval=1m&startTime=1789420200000&endTime=1789423800000&limit=1000",
      );
      expect(url("lighter", "112")).to.equal(
        "GET https://mainnet.zklighter.elliot.ai/api/v1/candles?market_id=112&resolution=1m&start_timestamp=1789420200000&end_timestamp=1789423860000&count_back=61",
      );
      expect(url("backpack", "TSLA.US_USDC_PERP")).to.equal("GET https://api.backpack.exchange/api/v1/klines?symbol=TSLA.US_USDC_PERP&interval=1m&startTime=1789420200&endTime=1789423860");
      expect(url("gate", "TSLA_USDT")).to.equal("GET https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=TSLA_USDT&interval=1m&from=1789420200&to=1789423800");
      expect(url("mexc", "TESLA_USDT")).to.equal("GET https://contract.mexc.com/api/v1/contract/kline/TESLA_USDT?interval=Min1&start=1789420200&end=1789423800");
      expect(url("bingx", "NCSKTSLA2USD-USDT")).to.equal(
        "GET https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=NCSKTSLA2USD-USDT&interval=1m&startTime=1789420200000&endTime=1789423860000&limit=1440",
      );
    });

    /* One row from each venue's live answer on 14 Sep, 22:20 UTC, as it came
     * back. The probe printed whole rows for every venue but MEXC, whose
     * columns it printed only for time, close and volume, so that body carries
     * just those; the envelope fields the probe did not print are left out. */
    it("reads each venue's body as it answered live", () => {
      const m = 1_789_423_800;
      const okxRow = ["1789423800000", "359.95", "360.03", "359.95", "360.03", "0.59", "0.59", "212.3843", "1"];
      const cases: [VenueId, unknown, Candle][] = [
        ["hyperliquid", [{ t: 1789423800000, T: 1789423859999, s: "xyz:TSLA", i: "1m", o: "359.88", c: "359.88", h: "359.88", l: "359.88", v: "6.947", n: 1 }], { t: m, close: "359.88", traded: true }],
        ["okx", { code: "0", data: [okxRow] }, { t: m, close: "360.03", traded: true }],
        ["bitget", { code: "00000", data: [["1789423740000", "360.07", "360.07", "360.07", "360.07", "0", "0"]] }, { t: m - 60, close: "360.07", traded: false }],
        ["binance", [[1789423800000, "359.76000000", "359.76000000", "359.76000000", "359.76000000", "0.00000000", 1789423859999, "0.00000000", 0, "0.00000000", "0.00000000", "0"]], { t: m, close: "359.76000000", traded: false }],
        ["lighter", { code: 200, r: "1m", c: [{ t: 1789423740000, o: 359.89, h: 359.89, l: 359.89, c: 359.89, O: 359.89, H: 359.89, L: 359.89, C: 359.89, v: 0, V: 0, i: 30437425911 }] }, { t: m - 60, close: "359.89", traded: false }],
        ["backpack", [{ close: "360.04", end: "2026-09-14 22:11:00", high: "360.04", low: "360.04", open: "360.04", quoteVolume: "0", start: "2026-09-14 22:10:00", trades: "0", volume: "0" }], { t: m, close: "360.04", traded: false }],
        ["gate", [{ o: "360.07", v: 29, t: 1789423800, c: "360.07", l: "360.07", h: "360.07", sum: "104.4203" }], { t: m, close: "360.07", traded: true }],
        ["mexc", { data: { time: [1789423800], close: [359.99], vol: [22] } }, { t: m, close: "359.99", traded: true }],
        ["bingx", { code: 0, data: [{ open: "359.98", close: "359.97", high: "359.98", low: "359.95", volume: "4.009", time: 1789423740000 }] }, { t: m - 60, close: "359.97", traded: true }],
      ];
      for (const [venue, body, want] of cases) expect(parseVenueBody(venue, body), venue).to.deep.equal([want]);
      // A candle OKX has not confirmed is not history yet.
      expect(parseVenueBody("okx", { code: "0", data: [[...okxRow.slice(0, 8), "0"]] })).to.deep.equal([]);
      // A body without the venue's success code is not an answer.
      expect(() => parseVenueBody("bitget", { data: [] })).to.throw(/code undefined/);
    });

    describe("fetching", () => {
      const realFetch = globalThis.fetch;
      afterEach(() => {
        globalThis.fetch = realFetch;
        forgetVenueWindows();
      });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      const m = SAT16 + 7 * 86_400;
      const opts = { now: m + 80, timeoutMs: FETCH_TIMEOUT_MS, settleSecs: BAR_SETTLE_SECS };

      it("turns a 429, a timeout and a strange body into errors, which the rule waits on", async () => {
        globalThis.fetch = (async () => json({}, 429)) as typeof fetch;
        expect(await fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, m, opts)).to.have.property("error", "HTTP 429");

        globalThis.fetch = ((_url: string, init?: RequestInit) =>
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
        expect(await fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, m, { ...opts, timeoutMs: 50 })).to.have.property("error", "no answer in 0.05s");

        globalThis.fetch = (async () => json({ label: "INVALID" })) as typeof fetch;
        expect(await fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, m, opts)).to.have.property("error").that.matches(/^unexpected answer/);
      });

      it("keeps a finished window, and asks again for one that has not reached its minute", async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
          calls++;
          return json([{ t: m, c: "360.07", v: 29 }]);
        }) as typeof fetch;
        await fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, m, opts);
        await fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, m, { ...opts, now: m + 999 });
        expect(calls).to.equal(1);

        // Hyperliquid, quiet since m - 120: its answer about m is not settled until m prints.
        calls = 0;
        globalThis.fetch = (async () => {
          calls++;
          return json([{ t: (m - 120) * 1000, c: "359.88", n: 1 }]);
        }) as typeof fetch;
        await fetchVenueWindow({ venue: "hyperliquid", instrument: "xyz:TSLA" }, m, opts);
        await fetchVenueWindow({ venue: "hyperliquid", instrument: "xyz:TSLA" }, m, opts);
        expect(calls).to.equal(2);

        // Not before its minute has closed and settled, however complete it looks.
        expect(windowFinished([{ t: m, close: "1", traded: true }], m, m + 79, BAR_SETTLE_SECS)).to.equal(false);
        expect(windowFinished([{ t: m, close: "1", traded: true }], m, m + 80, BAR_SETTLE_SECS)).to.equal(true);
      });

      it("asks Bitget one request at a time, and the rest together", async () => {
        const open: Record<string, number> = {};
        const most: Record<string, number> = {};
        globalThis.fetch = (async (url: string) => {
          const host = new URL(url).host;
          open[host] = (open[host] ?? 0) + 1;
          most[host] = Math.max(most[host] ?? 0, open[host]);
          await new Promise((r) => setTimeout(r, 30));
          open[host]--;
          return json(host.includes("bitget") ? { code: "00000", data: [] } : []);
        }) as typeof fetch;
        const at = (k: number) => SAT16 + 7 * 86_400 + 60 * k;
        await Promise.all([
          ...[0, 1, 2].map((k) => fetchVenueWindow({ venue: "bitget", instrument: "TSLAUSDT" }, at(k), opts)),
          ...[0, 1, 2].map((k) => fetchVenueWindow({ venue: "gate", instrument: "TSLA_USDT" }, at(k), opts)),
        ]);
        expect(most["api.bitget.com"]).to.equal(1);
        expect(most["api.gateio.ws"]).to.equal(3);
      });
    });
  });

  /* ─── The oracle, end to end ─────────────────────────────────────────────── */

  describe("in the oracle", () => {
    /* Last weekend, one week on: Saturday 19 Sep 2026, 16:00 UTC, after the
     * cutover and while the exchange is shut. Both Saturdays are in EDT. */
    const WEEK = 7 * 86_400;
    const M = SAT16 + WEEK;
    const B = M + 17;
    const feed = "c0".repeat(32);

    /* TSLA's own markets at every venue, as the plan's table names them. */
    const TSLA_PINS = [
      { venue: "hyperliquid", instrument: "xyz:TSLA" },
      { venue: "okx", instrument: "TSLA-USDT-SWAP" },
      { venue: "bitget", instrument: "TSLAUSDT" },
      { venue: "binance", instrument: "TSLABUSDT" },
      { venue: "lighter", instrument: "112" },
      { venue: "backpack", instrument: "TSLA.US_USDC_PERP" },
      { venue: "gate", instrument: "TSLA_USDT" },
      { venue: "mexc", instrument: "TESLA_USDT" },
      { venue: "bingx", instrument: "NCSKTSLA2USD-USDT" },
    ].map((p) => ({ ...p, from: COMPOSITE_FROM }));
    const pins = parseVenues247({
      rule: "composite-v1",
      tickers: {
        TSLA: TSLA_PINS,
        TSLAB: TSLA_PINS,
        TSLAC: TSLA_PINS,
        THIN: TSLA_PINS.filter((p) => ["gate", "mexc", "bingx", "hyperliquid"].includes(p.venue)),
        LATE: TSLA_PINS,
      },
    });
    const side = (composite: string) => ({ feed, symbol: "TSLA", currency: "USD", market: "US", perp: "xyz:TSLA", composite, boundary: B, venues: pins });

    /* The venues, answering with TSLA's weekend rows moved on a week, cut to
     * each request's window with the semantics each venue showed live. */
    const HOST: Record<string, VenueId | "yahoo"> = {
      "api.hyperliquid.xyz": "hyperliquid",
      "www.okx.com": "okx",
      "api.bitget.com": "bitget",
      "data-api.binance.vision": "binance",
      "mainnet.zklighter.elliot.ai": "lighter",
      "api.backpack.exchange": "backpack",
      "api.gateio.ws": "gate",
      "contract.mexc.com": "mexc",
      "open-api.bingx.com": "bingx",
      "query1.finance.yahoo.com": "yahoo",
    };
    const moved: Partial<Record<VenueId, Minute[]>> = {};
    for (const v of WEEKEND_VENUES) {
      const rows = weekendMinutes(v, "TSLA");
      if (rows) moved[VENUE_OF[v]] = rows.map((r) => ({ ...r, t: r.t + WEEK }));
    }
    const yahooBars = [YAHOO.rows.TSLA.friday, YAHOO.rows.TSLA.monday].map(([t, c]) => [t + WEEK, c] as YahooRow);
    const stamp = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ");

    function answer(url: string, init?: RequestInit): { host: string; body: unknown } {
      const u = new URL(url);
      const q = (k: string) => Number(u.searchParams.get(k));
      const venue = HOST[u.host];
      if (venue === "yahoo") {
        const bars = yahooBars.filter(([t]) => t >= q("period1") && t <= q("period2"));
        return { host: u.host, body: { chart: { result: [{ timestamp: bars.map(([t]) => t), indicators: { quote: [{ close: bars.map(([, c]) => c) }] } }] } } };
      }
      const rows = moved[venue] ?? [];
      const inside = (from: number, to: number, endInclusive: boolean) => rows.filter((r) => r.t >= from && (endInclusive ? r.t <= to : r.t < to));
      const body = (() => {
        switch (venue) {
          case "hyperliquid": {
            const { req } = JSON.parse(String(init?.body)) as { req: { startTime: number; endTime: number } };
            return inside(req.startTime / 1000, req.endTime / 1000, true).map((r) => ({ t: r.t * 1000, c: String(r.c), n: r.amount }));
          }
          case "okx":
            return { code: "0", data: rows.filter((r) => r.t < q("after") / 1000).slice(-q("limit")).reverse().map((r) => [String(r.t * 1000), "", "", "", String(r.c), String(r.amount), "", "", "1"]) };
          case "bitget":
            return { code: "00000", data: inside(q("startTime") / 1000, q("endTime") / 1000, false).map((r) => [String(r.t * 1000), "", "", "", String(r.c), String(r.amount), ""]) };
          case "binance":
            return inside(q("startTime") / 1000, q("endTime") / 1000, true).map((r) => [r.t * 1000, "", "", "", String(r.c), "", r.t * 1000 + 59_999, "", r.amount]);
          case "lighter": {
            const end = q("end_timestamp") / 1000;
            return { code: 200, r: "1m", c: inside(Math.min(q("start_timestamp") / 1000, end - 60 * q("count_back")), end, false).map((r) => ({ t: r.t * 1000, c: r.c, v: r.amount })) };
          }
          case "backpack":
            return inside(q("startTime"), q("endTime"), false).map((r) => ({ start: stamp(r.t), close: String(r.c), trades: String(r.amount) }));
          case "gate":
            return inside(q("from"), q("to"), true).map((r) => ({ t: r.t, c: String(r.c), v: r.amount }));
          case "mexc": {
            const got = inside(q("start"), q("end"), true);
            return { success: true, code: 0, data: { time: got.map((r) => r.t), close: got.map((r) => r.c), vol: got.map((r) => r.amount) } };
          }
          case "bingx":
            return { code: 0, data: inside(q("startTime") / 1000, q("endTime") / 1000, false).reverse().map((r) => ({ time: r.t * 1000, close: String(r.c), volume: String(r.amount) })) };
          default:
            throw new Error(`unexpected request ${url}`);
        }
      })();
      return { host: u.host, body };
    }

    const realFetch = globalThis.fetch;
    let calls: string[] = [];
    const serve = (refuse: (host: string) => number | null = () => null) => {
      calls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        const { host, body } = answer(url, init);
        const status = refuse(host);
        return new Response(JSON.stringify(status ? {} : body), { status: status ?? 200 });
      }) as typeof fetch;
    };
    afterEach(() => {
      globalThis.fetch = realFetch;
      forgetVenueWindows();
    });

    const bytes = (a: Answer) => JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const weekendPrice = priced(weekendComposite("TSLA", SAT16, windowsAt(weekendSeries("TSLA"), "TSLA", SAT16)));

    it("chooses the composite only for a pinned stock, with the exchange shut, from the cutover", () => {
      const pinned = { market: "US", perp: "xyz:TSLA", pool: "somepool", composite: "TSLA" };
      expect(sourceAt(B, pinned)).to.equal("composite");
      // The same Saturday a week earlier, before the cutover, keeps the perp.
      expect(sourceAt(B - WEEK, pinned)).to.equal("perp");
      expect(sourceAt(B - WEEK, { ...pinned, perp: undefined })).to.equal("pool");
      // The cutover is Wednesday 16 Sep, 7:06:40 PM ET: that night is the composite's, the night before the perp's.
      expect(sourceAt(Math.floor(nyToMs(2026, 9, 16, 21, 0) / 1000), pinned)).to.equal("composite");
      expect(sourceAt(Math.floor(nyToMs(2026, 9, 15, 21, 0) / 1000), pinned)).to.equal("perp");
      expect(sourceAt(Math.floor(nyToMs(2026, 9, 21, 12, 0) / 1000), pinned)).to.equal("exchange");
      expect(sourceAt(B, { market: "HK", composite: "TSLA" })).to.equal("exchange");
      expect(sourceAt(B, { market: "US", perp: "xyz:TSLA" })).to.equal("perp");
    });

    it("asks no venue before the minute can be final", async () => {
      serve();
      for (let now = B; now < M + 80; now += 9) expect(await quoteAt({ ...side("TSLA"), now })).to.equal(null);
      expect(calls).to.deep.equal([]);
      const a = await answerAt({ ...side("TSLA"), now: M + 79 });
      expect([a.wait, a.retryAt]).to.deep.equal([`the minute is not final until ${M + 80}`, M + 80]);
    });

    it("signs last weekend's median through the live request and body shapes, with the proof", async () => {
      serve();
      const a = await answerAt({ ...side("TSLA"), now: M + 80 });
      expect(a.source).to.equal("composite");
      expect(a.quote).to.deep.equal({ feed, boundary: B, price: weekendPrice.price, expo: -4, publishTime: M + 60 });
      expect(a.tier).to.equal(null);
      expect(a.proof!.venues.map((v) => [v.venue, v.close, v.lastTraded === null ? null : v.lastTraded - WEEK, v.why])).to.deep.equal(
        weekendPrice.proof.venues.map((v) => [v.venue, v.close, v.lastTraded, v.why]),
      );
      expect(a.sha256).to.equal(proofHash(a.proof!));
      // Nine venues and the exchange's last close, each asked once.
      expect(calls).to.have.length(10);
      expect(a.proof!.venues.map((v) => v.request)).to.deep.equal(TSLA_PINS.map((p) => venueRequest(p as PinnedInput, M)));
    });

    it("answers byte for byte the same five minutes later, and the same again worked out from scratch", async () => {
      serve();
      const first = await answerAt({ ...side("TSLA"), now: M + 80 });
      const later = await answerAt({ ...side("TSLA"), now: M + 380 });
      expect(bytes(later)).to.equal(bytes(first));

      forgetVenueWindows();
      serve();
      const fresh = await answerAt({ ...side("TSLAB"), now: M + 380 });
      // All nine venues again; the exchange's last close for the minute is kept from before.
      expect(calls).to.have.length(9);
      expect(fresh.sha256).to.equal(first.sha256);
      expect(bytes(fresh)).to.equal(bytes(first));
    });

    it("waits while a venue answers 429, and prices the same once it answers", async () => {
      serve((host) => (host === "api.bitget.com" ? 429 : null));
      const limited = await answerAt({ ...side("TSLAC"), now: M + 80 });
      expect(limited.quote).to.equal(null);
      expect(limited.wait).to.equal("waiting on Bitget TSLAUSDT: HTTP 429");
      expect(compositeParkedUntil("TSLAC", B)).to.equal(undefined);

      serve();
      const ok = await answerAt({ ...side("TSLAC"), now: M + 95 });
      expect(ok.quote?.price).to.equal(weekendPrice.price);
    });

    it("parks a thin side until the exchange can price it, asks nobody again meanwhile, then signs the exchange's bar", async () => {
      serve();
      const monday = Math.floor(nyToMs(2026, 9, 21, 4, 1, 20) / 1000);
      // THIN pins Hyperliquid and the three non-anchors, so a quorum needs a second anchor it does not have.
      const a = await answerAt({ ...side("THIN"), now: M + 80 });
      expect([a.quote, a.tier, a.parkedUntil, a.retryAt]).to.deep.equal([null, "exchange", monday, monday]);
      expect([a.proof!.fresh, a.proof!.freshAnchors]).to.deep.equal([4, 1]);
      expect(compositeParkedUntil("THIN", B)).to.equal(monday);

      calls = [];
      const again = await answerAt({ ...side("THIN"), now: M + 3_600 });
      expect(calls).to.deep.equal([]);
      expect(again.sha256).to.equal(a.sha256);

      const signed = await answerAt({ ...side("THIN"), now: monday });
      const [t, c] = YAHOO.rows.TSLA.monday;
      expect(signed.quote).to.deep.equal({ feed, boundary: B, price: BigInt(Math.round(c * 10_000)), expo: -4, publishTime: t + WEEK + 60 });
      expect(signed.tier).to.equal("exchange");
      expect(signed.sha256).to.equal(a.sha256);
    });

    it("refuses a boundary older than Hyperliquid's three days, without asking anyone", async () => {
      serve();
      let thrown: unknown;
      try {
        await answerAt({ ...side("LATE"), now: B + 3 * 86_400 + 1 });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).to.be.instanceOf(TooOld);
      expect((thrown as Error).message).to.match(/older than the 3 days its venues keep minutes for/);
      expect(calls).to.deep.equal([]);
    });
  });

  /* ─── The clock and the crank ────────────────────────────────────────────── */

  describe("in the price clock and the crank", () => {
    const B = SAT16 + 7 * 86_400 + 17;
    const pinned = { symbol: "TSLA", currency: "USD", market: "US", perp: "xyz:TSLA", pool: "somepool", composite: "PARKED" };
    const lookup: MarketLookup = () => pinned;
    const clockDuel = (boundary: number): ClockDuel => ({
      creatorFeed: "d1".repeat(32),
      opponentFeed: "d2".repeat(32),
      creatorSource: SOURCE_SIGNED,
      opponentSource: SOURCE_SIGNED,
      acceptedTs: boundary - START_DELAY_SECS,
      endTs: boundary + 3_600,
    });
    const duel = (boundary: number) => clockDuel(boundary) as DuelView;

    it("makes a composite side ready when its minute closes and settles, like a perp", () => {
      expect(readyAt(clockDuel(B), "start", B, lookup)).to.deep.equal({ at: firstBarEnd(B) + BAR_SETTLE_SECS, why: "minute-close" });
      // Before the cutover the same pins keep the perp, and a pool-only side its pool window.
      const before = B - 7 * 86_400;
      expect(readyAt(clockDuel(before), "start", before, lookup)).to.deep.equal({ at: firstBarEnd(before) + BAR_SETTLE_SECS, why: "minute-close" });
      const poolOnly: MarketLookup = () => ({ ...pinned, perp: undefined });
      expect(readyAt(clockDuel(before), "start", before, poolOnly)).to.deep.equal({ at: before + BAR_SETTLE_SECS, why: "pool-window" });
      // A stock with only the composite waits for the exchange before the cutover, and is ready after it.
      const bare: MarketLookup = () => ({ symbol: "TSLA", market: "US", composite: "PARKED" });
      expect(readyAt(clockDuel(before), "start", before, bare)).to.deep.equal({ shut: ["TSLA"] });
      expect(readyAt(clockDuel(B), "start", B, bare)).to.deep.equal({ at: firstBarEnd(B) + BAR_SETTLE_SECS, why: "minute-close" });
    });

    it("asks a late composite side again in five seconds, then every fifteen", () => {
      // A ticker nothing has parked, so the answer is the late-perp schedule.
      const late = { ...pinned, composite: "NEVERPARKED" };
      const d = duel(B);
      const due = firstBarEnd(B) + BAR_SETTLE_SECS;
      expect(retryAt(d, "start", due - 30, () => late, late)).to.equal(due);
      expect(retryAt(d, "start", due + 1, () => late, late)).to.equal(due + 6);
      const slow = due + PERP_FAST_RETRY_WINDOW_SECS;
      expect(retryAt(d, "start", slow, () => late, late)).to.equal(slow + PERP_SLOW_RETRY_SECS);
    });

    it("parks a side that fell back to the exchange until the exchange's bar can be final", async () => {
      const realFetch = globalThis.fetch;
      const M = Math.floor(B / 60) * 60;
      /* PARKED pins two non-anchors, answering with their live 14 Sep rows
       * for the minute made quiet (volume 0): no quorum, no two anchors. */
      const venues = parseVenues247({
        rule: "composite-v1",
        tickers: { PARKED: [{ venue: "gate", instrument: "TSLA_USDT", from: COMPOSITE_FROM }, { venue: "mexc", instrument: "TESLA_USDT", from: COMPOSITE_FROM }] },
      });
      const [ft, fc] = YAHOO.rows.TSLA.friday;
      globalThis.fetch = (async (url: string) => {
        if (url.includes("yahoo")) return new Response(JSON.stringify({ chart: { result: [{ timestamp: [ft + 7 * 86_400], indicators: { quote: [{ close: [fc] }] } }] } }));
        if (url.includes("gateio")) return new Response(JSON.stringify([{ t: M, c: "359.88", v: 0 }]));
        return new Response(JSON.stringify({ success: true, code: 0, data: { time: [M], close: [359.99], vol: [0] } }));
      }) as typeof fetch;
      try {
        const a = await answerAt({ feed: "d1".repeat(32), ...pinned, boundary: B, now: M + 80, venues });
        const monday = Math.floor(nyToMs(2026, 9, 21, 4, 1, 20) / 1000);
        expect(a.parkedUntil).to.equal(monday);
        const d = duel(B);
        expect(retryAt(d, "start", M + 81, lookup, pinned)).to.equal(monday);
        expect(retryAt(d, "start", M + 86_400, lookup, pinned)).to.equal(monday);
        // Once the exchange runs, at its next minute close, as a thin pool does.
        const later = monday + 45;
        expect(retryAt(d, "start", later, lookup, pinned)).to.equal(firstBarEnd(later - BAR_SETTLE_SECS) + BAR_SETTLE_SECS);
      } finally {
        globalThis.fetch = realFetch;
        forgetVenueWindows();
      }
    });
  });
});
