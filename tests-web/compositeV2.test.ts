/* Composite-v2, held to last weekend's minutes and to what it closes that v1
 * left open.
 *
 * The same fixtures as composite.test.ts (tests-web/fixtures/weekend.ts), each
 * venue's rows cut to the span a v2 request asks for: from m - 90 minutes, for
 * the calibration, to the window's last minute. The attack figures behind W
 * and the shortest off-hours round are scripts/attack-247.ts's; the harness
 * itself is run here on one stock, so a change to the rule that moves its
 * numbers fails a test rather than a document. */

import { expect } from "chai";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  calibrate,
  CALIBRATION_FROM_MINUTES,
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_TO_MINUTES,
  canonicalJson,
  closeText,
  compositeAt,
  compositePublishTime,
  compositeV2At,
  medianTicks,
  MIN_OFFHOURS_ROUND_SECS,
  PREMIUM_SCALE,
  proofHash,
  referenceAt,
  toTicks,
  venueSeries,
  V2_LOOKBACK_SECS,
  V2_TAIL_MINUTES,
  V2_WINDOW_MINUTES,
  V2_WINDOW_SECS,
  VENUES,
  type Candle,
  type CompositeV2Proof,
  type CompositeV2Result,
  type Reference,
  type VenueId,
  type VenueWindow,
} from "../src/lib/composite";
import { BAR_SETTLE_SECS, exchangeBarFinal } from "../src/lib/oracle";
import { venueRequestV2 } from "../src/lib/venues247";
import { measureTicker } from "../scripts/attack-247";
import { WEEKEND_MON, WEEKEND_SAT, WEEKEND_TICKERS, WEEKEND_VENUES, weekendMinutes, type WeekendVenue } from "./fixtures/weekend";

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

const YAHOO = JSON.parse(readFileSync(resolve(__dirname, "fixtures/weekend-2026-09-12/yahoo.json"), "utf8")) as {
  rows: Record<string, { friday: [number, number] }>;
};
const fridayClose = (ticker: string): Reference => {
  const [t, c] = YAHOO.rows[ticker].friday;
  return { t, close: closeText(c)! };
};

function weekendSeries(ticker: string) {
  return WEEKEND_VENUES.flatMap((v) => {
    const rows = weekendMinutes(v, ticker);
    return rows ? [{ venue: VENUE_OF[v], rows: rows.map((r): Candle => ({ t: r.t, close: closeText(r.c)!, traded: r.traded })) }] : [];
  });
}

/** Each venue's rows for a v2 window at m, as its request returns them once
 *  history is complete: m - 90 minutes to V2_TAIL_MINUTES past the window's
 *  last minute. */
const windowsV2At = (series: ReturnType<typeof weekendSeries>, ticker: string, m: number): (VenueWindow & { rows: Candle[] })[] =>
  series.map((s) => ({
    venue: s.venue,
    instrument: ticker,
    request: { method: "GET" as const, url: `fixture:${s.venue}/${ticker}/${m}` },
    rows: s.rows.filter((r) => r.t >= m - V2_LOOKBACK_SECS && r.t <= m + V2_WINDOW_SECS - 60 + V2_TAIL_MINUTES * 60),
  }));

const FINAL = (m: number) => m + V2_WINDOW_SECS + BAR_SETTLE_SECS;
const v2 = (ticker: string, m: number, windows: VenueWindow[], reference = fridayClose(ticker)) =>
  compositeV2At({ boundary: m, now: FINAL(m), settleSecs: BAR_SETTLE_SECS, windows, reference, exchangeFinal: exchangeBarFinal(m) });

type Priced = Extract<CompositeV2Result, { price: bigint }>;
const priced = (r: CompositeV2Result): Priced => {
  if (!("price" in r)) throw new Error(`expected a price, got ${JSON.stringify(r)}`);
  return r;
};

/** Saturday 12 Sep, 16:00 UTC. */
const SAT16 = 1_789_228_800;

/** A window's rows with every minute from `from` on made quiet at the named venues. */
const quietFrom = (windows: VenueWindow[], venues: VenueId[], from = -Infinity): VenueWindow[] =>
  windows.map((w) => (venues.includes(w.venue) && "rows" in w ? { ...w, rows: w.rows.map((r) => (r.t >= from ? { ...r, traded: false } : r)) } : w));

/** The same, with a venue's closes in [from, to] moved by `bps` and marked traded. */
const pushed = (windows: VenueWindow[], venue: VenueId, from: number, to: number, bps: number): VenueWindow[] =>
  windows.map((w) =>
    w.venue === venue && "rows" in w
      ? {
          ...w,
          rows: w.rows.map((r) => (r.t >= from && r.t <= to ? { ...r, close: ((Number(r.close) * (10_000 + bps)) / 10_000).toFixed(4), traded: true } : r)),
        }
      : w,
  );

describe("composite-v2", () => {
  it("stamps a price at the end of its window, the window chosen by the harness", () => {
    expect(V2_WINDOW_MINUTES).to.equal(3);
    expect(compositePublishTime(SAT16 + 17)).to.equal(SAT16 + 180);
    expect(compositePublishTime(SAT16 + 59)).to.equal(SAT16 + 180);
    expect(MIN_OFFHOURS_ROUND_SECS).to.equal(12 * 3_600);
  });

  describe("on last weekend's minutes", function () {
    this.timeout(120_000);

    /* Every fifteen-minute boundary of the weekend: the real rule, 192 times a
     * stock. v1 lost MSFT's Saturday 11:30 AM ET to the exchange; v2 counts the
     * markets fresh in the 15 minutes before its window, and they hold. */
    it("prices every fifteen-minute boundary for all twelve stocks by the median of at least 5 counted markets", () => {
      for (const ticker of WEEKEND_TICKERS) {
        const series = weekendSeries(ticker);
        let n = 0;
        let fewest = Infinity;
        let guardAll = 0;
        for (let m = WEEKEND_SAT; m < WEEKEND_MON; m += 900) {
          const r = priced(v2(ticker, m, windowsV2At(series, ticker, m)));
          n++;
          fewest = Math.min(fewest, r.proof.counted);
          guardAll += r.proof.minutes.filter((x) => x.guard === "all").length;
        }
        expect(n, ticker).to.equal(192);
        expect(fewest, ticker).to.be.at.least(5);
        expect(guardAll, `${ticker}: minutes the guard fell back to every close`).to.equal(0);
      }
    });

    it("prices MSFT's Saturday 11:30 AM ET, which v1 sent to Monday's bar", () => {
      const m = 1_789_227_000;
      const series = weekendSeries("MSFT");
      const v1Windows = series.map((s) => ({ venue: s.venue, instrument: "MSFT", request: { method: "GET" as const, url: "x" }, rows: s.rows.filter((r) => r.t >= m - 3_600 && r.t <= m) }));
      const one = compositeAt({ boundary: m, now: m + 80, settleSecs: BAR_SETTLE_SECS, windows: v1Windows, reference: fridayClose("MSFT"), exchangeFinal: exchangeBarFinal(m) });
      expect(one).to.have.property("waitUntil");
      expect(priced(v2("MSFT", m, windowsV2At(series, "MSFT", m))).proof.counted).to.be.at.least(5);
    });
  });

  describe("determinism and the proof", () => {
    const series = weekendSeries("TSLA");
    const windows = windowsV2At(series, "TSLA", SAT16);
    const base = priced(v2("TSLA", SAT16, windows));

    it("prices TSLA at Saturday 16:00 UTC from all nine venues, each calibrated from its own last hour", () => {
      const p: CompositeV2Proof = base.proof;
      expect([base.tier, base.publishTime, p.publishTime]).to.deep.equal([null, SAT16 + 180, SAT16 + 180]);
      expect(p.rule).to.equal("composite-v2");
      expect(p.window).to.deep.equal({ from: SAT16, to: SAT16 + 120, minutes: 3 });
      expect(p.calibration).to.deep.equal({ fromMinutes: CALIBRATION_FROM_MINUTES, toMinutes: CALIBRATION_TO_MINUTES, minSamples: CALIBRATION_MIN_SAMPLES, scale: "100000000" });
      expect(p.venues.map((v) => v.venue)).to.deep.equal(Object.keys(VENUES));
      expect(base.price.toString()).to.equal(p.price);
      // The price is the median of the minutes' medians.
      const values = p.minutes.map((x) => BigInt(x.value!)).sort((a, b) => (a < b ? -1 : 1));
      expect(p.median).to.equal(values[1].toString());
      for (const v of p.venues.filter((x) => x.counted)) {
        for (const x of v.minutes) {
          expect(x.samples, `${v.venue} at ${x.t}`).to.be.at.least(CALIBRATION_MIN_SAMPLES);
          expect(BigInt(x.calibrated!)).to.equal(calibrate(BigInt(x.ticks!), BigInt(x.premium!)));
        }
      }
      // Calibrated, the counted venues sit within a few bps of each other; raw, they do not.
      const spread = (xs: bigint[]) => Number(((xs.reduce((a, b) => (b > a ? b : a)) - xs.reduce((a, b) => (b < a ? b : a))) * 10_000n) / xs[0]);
      const counted = p.venues.filter((v) => v.counted);
      expect(spread(counted.map((v) => BigInt(v.minutes[0].calibrated!)))).to.be.below(spread(counted.map((v) => BigInt(v.minutes[0].ticks!))));
    });

    it("gives the same answer whatever order the venues come in", () => {
      for (const order of [[...windows].reverse(), [...windows.slice(4), ...windows.slice(0, 4)]]) {
        const again = priced(v2("TSLA", SAT16, order));
        expect(again.sha256).to.equal(base.sha256);
      }
    });

    it("ignores rows past the window, and flat Hyperliquid candles printed after it", () => {
      const more = windows.map((w) => {
        const last = w.rows.at(-1)!;
        const flat = [3, 4, 5].map((k) => ({ t: SAT16 + 60 * k, close: last.close, traded: w.venue !== "hyperliquid" }));
        return { ...w, rows: [...w.rows, ...flat] };
      });
      expect(priced(v2("TSLA", SAT16, more)).sha256).to.equal(base.sha256);
    });

    /* Only rows a real request returns. At the moment the rule first asks, a
     * venue that has not printed the window's last minute has nothing at or
     * after it: a wait. If the venue skipped that minute, its request, which
     * reaches V2_TAIL_MINUTES past the window, returns the minutes after it
     * once they print, and the skipped minute counts as no trade. */
    it("waits when a venue that prints every minute has nothing for the window's last minute yet, and prices once a later minute proves it skipped", () => {
      const last = SAT16 + 120;
      const cutAt = (t: number) => windows.map((w) => (w.venue === "okx" ? { ...w, rows: w.rows.filter((r) => r.t < t) } : w));
      expect(v2("TSLA", SAT16, cutAt(last))).to.deep.equal({ wait: `no candle for ${last} yet at OKX TSLA`, retryAt: null });
      const skipped = windows.map((w) => (w.venue === "okx" ? { ...w, rows: w.rows.filter((r) => r.t !== last) } : w));
      expect(skipped.find((w) => w.venue === "okx")!.rows.some((r) => r.t > last)).to.equal(true);
      expect("price" in v2("TSLA", SAT16, skipped)).to.equal(true);
      // The rows the request returns past the window are the ones venueRequestV2 asks for, and no further.
      const okx = new URL(venueRequestV2({ venue: "okx", instrument: "TSLA-USDT-SWAP" }, SAT16).url);
      expect(Number(okx.searchParams.get("after")) / 1_000 - 60).to.equal(last + V2_TAIL_MINUTES * 60);
    });

    /* Hyperliquid prints a quiet minute only once somebody trades after it, so
     * asked at the moment the rule first can, it may not have the window's
     * trailing quiet minutes yet, and asked later it does. Both must be the
     * same proof, byte for byte. */
    it("hashes the same proof whether Hyperliquid's trailing quiet minutes have printed yet or not", () => {
      let checked = 0;
      for (const ticker of WEEKEND_TICKERS) {
        const s = weekendSeries(ticker);
        if (!s.some((x) => x.venue === "hyperliquid")) continue;
        for (let m = WEEKEND_SAT; m < WEEKEND_MON && checked < 40; m += 900) {
          const later = windowsV2At(s, ticker, m);
          const hl = later.find((w) => w.venue === "hyperliquid")!;
          const last = m + V2_WINDOW_SECS - 60;
          const lastTrade = Math.max(...hl.rows.filter((r) => r.traded && r.t <= last).map((r) => r.t));
          // Only windows whose last minutes were quiet at Hyperliquid.
          if (!(lastTrade < last)) continue;
          const atFetch = later.map((w) => (w.venue === "hyperliquid" ? { ...w, rows: w.rows.filter((r) => r.t <= lastTrade) } : w));
          const a = v2(ticker, m, later);
          const b = v2(ticker, m, atFetch);
          if (!("price" in a) || !("price" in b)) throw new Error(`${ticker} at ${m}: ${JSON.stringify(a)}`);
          expect(b.sha256, `${ticker} at ${m}`).to.equal(a.sha256);
          checked++;
        }
      }
      expect(checked).to.be.at.least(20);
    });

    it("waits on a 429, never leaving the venue out", () => {
      const limited = windows.map((w) => (w.venue === "bitget" ? { venue: w.venue, instrument: w.instrument, request: w.request, error: "HTTP 429" } : w));
      expect(v2("TSLA", SAT16, limited)).to.deep.equal({ wait: "waiting on Bitget TSLA: HTTP 429", retryAt: null });
    });

    it("asks nothing before the window's last minute has closed and settled", () => {
      const at = (now: number) =>
        compositeV2At({ boundary: SAT16 + 17, now, settleSecs: BAR_SETTLE_SECS, windows, reference: fridayClose("TSLA"), exchangeFinal: exchangeBarFinal(SAT16) });
      expect(at(SAT16 + 199)).to.deep.equal({ wait: `the minute is not final until ${SAT16 + 200}`, retryAt: SAT16 + 200 });
      expect(priced(at(SAT16 + 200)).publishTime).to.equal(SAT16 + 180);
    });

    it("hashes the same inputs to the same sha256, the sha256 of the canonical JSON", () => {
      expect(priced(v2("TSLA", SAT16, windowsV2At(series, "TSLA", SAT16))).sha256).to.equal(base.sha256);
      expect(base.sha256).to.equal(createHash("sha256").update(canonicalJson(base.proof), "utf8").digest("hex"));
      expect(proofHash(base.proof)).to.equal(base.sha256);
    });

    it("asks each venue for the span the rule reads and five minutes past it, and no more than OKX answers in one request", () => {
      expect(V2_TAIL_MINUTES).to.equal(5);
      const r = venueRequestV2({ venue: "okx", instrument: "TSLA-USDT-SWAP" }, SAT16);
      expect(r.url).to.equal(`https://www.okx.com/api/v5/market/history-candles?instId=TSLA-USDT-SWAP&bar=1m&after=${(SAT16 + 480) * 1_000}&limit=100`);
      const lighter = venueRequestV2({ venue: "lighter", instrument: "112" }, SAT16);
      expect(lighter.url).to.equal(
        `https://mainnet.zklighter.elliot.ai/api/v1/candles?market_id=112&resolution=1m&start_timestamp=${(SAT16 - 5_400) * 1_000}&end_timestamp=${(SAT16 + 480) * 1_000}&count_back=98`,
      );
      const gate = venueRequestV2({ venue: "gate", instrument: "TSLA_USDT" }, SAT16);
      expect(gate.url).to.equal(`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=TSLA_USDT&interval=1m&from=${SAT16 - 5_400}&to=${SAT16 + 420}`);
    });
  });

  /* ─── What v2 closes ─────────────────────────────────────────────────────── */

  describe("one venue", () => {
    const series = weekendSeries("TSLA");
    const windows = windowsV2At(series, "TSLA", SAT16);
    const base = priced(v2("TSLA", SAT16, windows));
    const bps = (a: bigint, b: bigint) => Number(((a > b ? a - b : b - a) * 1_000_000n) / b) / 100;

    it("pushed 60 bps in every minute of the window moves TSLA's price by at most 1 bp", () => {
      for (const venue of Object.keys(VENUES) as VenueId[]) {
        for (const g of [-60, -30, 30, 60]) {
          const r = priced(v2("TSLA", SAT16, pushed(windows, venue, SAT16, SAT16 + 120, g)));
          expect(r.proof.counted, venue).to.equal(base.proof.counted);
          expect(bps(r.price, base.price), `${venue} ${g} bps`).to.be.at.most(1);
        }
      }
    });

    it("printing a tenth of the price in one minute moves nothing", () => {
      const bad = windows.map((w) => (w.venue === "okx" ? { ...w, rows: w.rows.map((r) => (r.t === SAT16 + 60 ? { ...r, close: (Number(r.close) / 10).toFixed(2), traded: true } : r)) } : w));
      const r = priced(v2("TSLA", SAT16, bad));
      const okx = r.proof.venues.find((v) => v.venue === "okx")!;
      expect(okx.minutes.map((x) => x.kept)).to.deep.equal([true, false, true]);
      expect(r.price).to.equal(base.price);
    });

    /* The knock-out. Three markets have traded: Hyperliquid and OKX, the two
     * anchors, and Gate. OKX prints 100 bps up in the boundary's minute. v1
     * drops it as diverged, is left with one anchor, and sends the side to
     * Monday. v2 counted OKX before the window, so it still counts: the guard
     * sets its closes aside, the median of the three holds, and the side is
     * priced. */
    it("cannot knock a side to the exchange by diverging", () => {
      const thin = quietFrom(windows, ["bitget", "binance", "lighter", "backpack", "mexc", "bingx"]);
      const honest = priced(v2("TSLA", SAT16, thin));
      expect([honest.proof.counted, honest.proof.countedAnchors]).to.deep.equal([3, 2]);

      const attacked = pushed(thin, "okx", SAT16, SAT16 + 120, 100);
      const cut = attacked.map((w) => ({ ...w, rows: (w as { rows: Candle[] }).rows.filter((r) => r.t >= SAT16 - 3_600 && r.t <= SAT16) }));
      const one = compositeAt({ boundary: SAT16, now: SAT16 + 80, settleSecs: BAR_SETTLE_SECS, windows: cut, reference: fridayClose("TSLA"), exchangeFinal: exchangeBarFinal(SAT16) });
      expect(one).to.have.property("waitUntil");

      const r = priced(v2("TSLA", SAT16, attacked));
      expect([r.tier, r.proof.counted]).to.deep.equal([null, 3]);
      expect(bps(r.price, honest.price)).to.be.at.most(30);
    });

    /* A venue that was quiet before the window and trades inside it does not
     * join: who counts was settled before the boundary's minute began. */
    it("does not count a venue that wakes up inside the window", () => {
      const thin = quietFrom(windows, ["bitget", "binance", "lighter", "backpack", "mexc", "bingx"]);
      const honest = priced(v2("TSLA", SAT16, thin));
      const woke = priced(v2("TSLA", SAT16, pushed(thin, "bitget", SAT16, SAT16 + 120, 40)));
      expect(woke.price).to.equal(honest.price);
      const bitget = woke.proof.venues.find((v) => v.venue === "bitget")!;
      expect([bitget.counted, bitget.why, bitget.minutes.some((x) => x.kept)]).to.deep.equal([false, "stale", false]);

      // And with only two markets fresh before the window, a third that wakes inside it cannot make a quorum.
      const two = quietFrom(thin, ["gate"]);
      expect(v2("TSLA", SAT16, two)).to.have.property("waitUntil");
      expect(v2("TSLA", SAT16, pushed(two, "gate", SAT16, SAT16 + 120, 0))).to.have.property("waitUntil");
    });

    /* Everyone calibrated over the hour, but only Hyperliquid and Binance
     * trading in the 15 minutes before the window. */
    it("never prices from two anchors alone", () => {
      const two = quietFrom(windows, ["bitget", "lighter", "backpack", "gate", "mexc", "bingx", "okx"], SAT16 - 900);
      const r = v2("TSLA", SAT16, two);
      if (!("waitUntil" in r)) throw new Error(JSON.stringify(r));
      expect(r.proof.tier).to.equal("exchange");
      expect(r.reason).to.match(/^2 markets \(2 anchors\) had traded in the 15 minutes before/);
    });

    it("trips the breaker more than 15% from the exchange's last close", () => {
      const [t, c] = YAHOO.rows.TSLA.friday;
      const far = { t, close: (c * 0.8).toFixed(2) };
      const r = v2("TSLA", SAT16, windows, far);
      if (!("waitUntil" in r)) throw new Error(JSON.stringify(r));
      expect(r.reason).to.match(/beyond the 1,500 bps breaker$/);
      expect(r.proof.reference).to.deep.equal({ t, close: far.close, ticks: toTicks(far.close)!.toString() });
      expect(v2("TSLA", SAT16, windows, { error: "HTTP 429" })).to.deep.equal({ wait: "the exchange's last close could not be read: HTTP 429", retryAt: null });
    });

    it("keeps premiums to 1e-8 and reads them only from minutes before the window", () => {
      expect(PREMIUM_SCALE).to.equal(100_000_000n);
      // Changing every close from the window's first minute on changes no premium.
      const moved = windows.map((w) => ({ ...w, rows: w.rows.map((r) => (r.t >= SAT16 ? { ...r, close: (Number(r.close) * 1.001).toFixed(4) } : r)) }));
      const r = priced(v2("TSLA", SAT16, moved));
      const premiums = (p: CompositeV2Proof) => p.venues.map((v) => v.minutes.map((x) => x.premium));
      expect(premiums(r.proof)).to.deep.equal(premiums(base.proof));
    });
  });

  /* ─── The tiers, each one on its edge ────────────────────────────────────── */

  /* On last weekend's fixtures every priced minute had five or more counted
   * venues, the guard never fell back and nothing was uncalibrated, so the
   * rule's quorum, its guard, its calibration minimum and its breaker were each
   * asserted nowhere: deleting any of them passed. These put each one on its
   * edge, from the same real rows made thinner. */
  describe("each tier, on its edge", () => {
    const series = weekendSeries("TSLA");
    const windows = windowsV2At(series, "TSLA", SAT16);
    const base = priced(v2("TSLA", SAT16, windows));
    const OTHERS: VenueId[] = ["hyperliquid", "okx", "bitget", "binance", "lighter", "backpack", "gate", "mexc", "bingx"];
    const quietBut = (keep: VenueId[], from?: number) => quietFrom(windows, OTHERS.filter((v) => !keep.includes(v)), from);

    it("prices nothing from three counted markets with one anchor among them", () => {
      const one = quietBut(["binance", "gate", "mexc"], SAT16 - 900);
      const r = v2("TSLA", SAT16, one);
      if (!("waitUntil" in r)) throw new Error(JSON.stringify(r));
      expect([r.proof.counted, r.proof.countedAnchors]).to.deep.equal([3, 1]);
      expect(r.reason).to.match(/^3 markets \(1 anchors\) had traded in the 15 minutes before/);
    });

    /* HL, OKX and Gate count; OKX prints 100 bps up through the window. The
     * guard sets it aside and keeps 2, under the quorum, so each minute is the
     * median of all three. */
    it("takes the median of every counted close in a minute whose guard keeps fewer than three", () => {
      const thin = quietBut(["hyperliquid", "okx", "gate"]);
      const r = priced(v2("TSLA", SAT16, pushed(thin, "okx", SAT16, SAT16 + 120, 100)));
      expect([r.proof.counted, r.proof.countedAnchors]).to.deep.equal([3, 2]);
      for (const x of r.proof.minutes) {
        expect([x.guard, x.kept, x.keptAnchors], `minute ${x.t}`).to.deep.equal(["all", 3, 2]);
        const closes = r.proof.venues.filter((v) => v.counted).map((v) => BigInt(v.minutes.find((y) => y.t === x.t)!.calibrated!));
        expect(x.value).to.equal(medianTicks(closes).toString());
      }
    });

    /* HL, OKX, Gate and MEXC count; OKX prints 100 bps up. The guard keeps
     * HL, Gate and MEXC: three markets but one anchor, which is not a quorum
     * either, so every close counts. */
    it("takes every counted close when the guard keeps three markets but only one anchor", () => {
      const four = quietBut(["hyperliquid", "okx", "gate", "mexc"]);
      const honest = priced(v2("TSLA", SAT16, four));
      expect([honest.proof.counted, honest.proof.countedAnchors]).to.deep.equal([4, 2]);
      expect(honest.proof.minutes.map((x) => x.guard)).to.deep.equal(["held", "held", "held"]);
      const r = priced(v2("TSLA", SAT16, pushed(four, "okx", SAT16, SAT16 + 120, 100)));
      for (const x of r.proof.minutes) expect([x.guard, x.kept, x.keptAnchors], `minute ${x.t}`).to.deep.equal(["all", 4, 2]);
    });

    /* Bitget made to trade only in the first minutes of the span, and in the
     * minute before the window so it is fresh. Its premium at window minute k
     * is read from minutes k - 75 to k - 6 where it was fresh, and each later
     * minute's reach starts a minute later, so its samples fall by one a
     * minute: with trades in the span's first n minutes (fresh through the
     * fourteen after) they are n - 1, n - 2 and n - 3 across the window. */
    it("counts a market only with 10 calibration minutes at every minute of the window", () => {
      const tradedFirst = (minutes: number) =>
        windows.map((w) =>
          w.venue === "bitget"
            ? { ...w, rows: w.rows.map((r) => ({ ...r, traded: (r.t >= SAT16 - V2_LOOKBACK_SECS && r.t < SAT16 - V2_LOOKBACK_SECS + minutes * 60) || r.t === SAT16 - 60 })) }
            : w,
        );
      const bitget = (n: number) => priced(v2("TSLA", SAT16, tradedFirst(n))).proof.venues.find((v) => v.venue === "bitget")!;
      const read = (n: number) => [bitget(n).why, bitget(n).minutes.map((x) => x.samples)];
      expect(read(13)).to.deep.equal(["counted", [12, 11, 10]]);
      // Calibrated at the first two minutes, 9 samples at the last: not counted.
      expect(read(12)).to.deep.equal(["uncalibrated", [11, 10, 9]]);
      expect(read(11)).to.deep.equal(["uncalibrated", [10, 9, 8]]);
      expect(read(10)).to.deep.equal(["uncalibrated", [9, 8, 7]]);
      expect(bitget(12).fresh).to.equal(true);
    });

    /* v1's median at a calibration minute, from four markets one of which is
     * 10% off: the guard drops it, and the reference is the median of the
     * rest. With the outlier an anchor, what is left has one anchor, and there
     * is no reference at that minute. */
    it("measures premiums against a reference that has had its own outlier removed", () => {
      const t = SAT16;
      const one = (venue: VenueId, close: string) => venueSeries(venue, [{ t, close, traded: true }], t, t);
      const honest = [one("hyperliquid", "100.0000"), one("okx", "100.0100"), one("gate", "100.0200"), one("mexc", "110.0000")];
      expect(referenceAt(honest, 0)).to.equal(1_000_100n);
      const anchorOff = [one("hyperliquid", "100.0000"), one("okx", "110.0000"), one("gate", "100.0100"), one("mexc", "100.0200")];
      expect(referenceAt(anchorOff, 0)).to.equal(null);
    });

    /* The breaker's edge, from TSLA's real price: a reference 14.99% away
     * either side prices it, 15.01% sends the side to the exchange. */
    it("trips the breaker past 1,500 bps from the exchange's last close and not before", () => {
      const P = base.price;
      const text = (ticks: bigint) => `${ticks / 10_000n}.${(ticks % 10_000n).toString().padStart(4, "0")}`;
      const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
      const cases: [string, bigint, boolean][] = [
        ["14.99% below the price", ceilDiv(P * 10_000n, 11_499n), true],
        ["15.01% below the price", (P * 10_000n) / 11_501n, false],
        ["14.99% above the price", (P * 10_000n) / 8_501n, true],
        ["15.01% above the price", ceilDiv(P * 10_000n, 8_499n), false],
      ];
      for (const [where, R, prices] of cases) {
        const gap = ((P > R ? P - R : R - P) * 10_000n) / R;
        expect(Number(gap), where).to.be.within(prices ? 1_490 : 1_501, prices ? 1_499 : 1_510);
        const r = v2("TSLA", SAT16, windows, { t: SAT16 - 86_400, close: text(R) });
        if (prices) expect(priced(r).price, where).to.equal(P);
        else expect(r, where).to.have.property("reason").that.matches(/beyond the 1,500 bps breaker$/);
      }
    });
  });

  /* ─── The harness ────────────────────────────────────────────────────────── */

  describe("the attack harness", function () {
    this.timeout(120_000);

    it("reproduces TSLA's row of docs/247-hardening.md, checking itself against compositeV2At", () => {
      const r = measureTicker("TSLA", V2_WINDOW_MINUTES);
      const recorded = (JSON.parse(readFileSync(resolve(__dirname, "../scripts/data/attack-247.json"), "utf8")) as { results: Record<string, typeof r[]> }).results[
        String(V2_WINDOW_MINUTES)
      ].find((x) => x.ticker === "TSLA");
      expect(r.checked).to.be.greaterThan(20);
      expect(r).to.deep.equal(recorded);
      expect(r.v2["12h"].both / r.v2["12h"].rounds).to.be.at.most(0.05);
    });
  });
});
