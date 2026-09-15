/* The oracle's two promises: the bytes it signs are the bytes the program
 * parses, and the price it picks for a moment is the one the rules name. */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import {
  BAR_SETTLE_SECS,
  exchangeBarFinal,
  FETCH_TIMEOUT_MS,
  fetchBars,
  fetchPerpBars,
  perpWindowComplete,
  fetchPoolBars,
  firstBarEnd,
  POOL_ATTEMPTS,
  poolWindowThin,
  priceAtBoundary,
  quoteAt,
  quoteMessage,
  signedQuoteInstruction,
  sourceAt,
  trimmedMeanAtBoundary,
  QUOTE_LEN,
} from "../src/lib/oracle";
import { nyToMs } from "../src/lib/market";

/* The same vector is asserted in programs/duel/src/quote.rs
 * (`the_message_layout_is_pinned`), so the two sides cannot drift apart. */
const GOLDEN =
  "53544f4e4b574152533a50524943453a7631" +
  "09".repeat(32) +
  "e803000000000000" + // boundary 1000
  "8855000000000000" + // price 21896
  "feffffff" + // expo -2
  "fc03000000000000"; // publish_time 1020

describe("oracle", () => {
  it("signs exactly the layout the program reads", () => {
    const m = quoteMessage({ feed: "09".repeat(32), boundary: 1000, price: 21896n, expo: -2, publishTime: 1020 });
    expect(m.length).to.equal(QUOTE_LEN);
    expect(Buffer.from(m).toString("hex")).to.equal(GOLDEN);
  });

  it("refuses a feed id that is not 32 bytes", () => {
    expect(() => quoteMessage({ feed: "abcd", boundary: 1, price: 1n, expo: -4, publishTime: 1 })).to.throw(/32 bytes/);
  });

  it("puts key, signature and message in the Ed25519 instruction, all pointing at itself", () => {
    const oracle = Keypair.generate();
    const q = { feed: "09".repeat(32), boundary: 1000, price: 21896n, expo: -2, publishTime: 1020 };
    const data = signedQuoteInstruction(oracle, q).data;
    expect(data[0]).to.equal(1);
    const u16 = (at: number) => data.readUInt16LE(at);
    const [sigAt, sigIx, keyAt, keyIx, msgAt, msgLen, msgIx] = [2, 4, 6, 8, 10, 12, 14].map(u16);
    expect([sigIx, keyIx, msgIx]).to.deep.equal([0xffff, 0xffff, 0xffff]);
    expect(Buffer.from(data.subarray(keyAt, keyAt + 32)).equals(oracle.publicKey.toBuffer())).to.be.true;
    expect(Buffer.from(data.subarray(msgAt, msgAt + msgLen)).toString("hex")).to.equal(GOLDEN);
    expect(sigAt + 64).to.be.at.most(data.length);
  });

  describe("priceAtBoundary", () => {
    const bars = { t: [0, 60, 120], c: [10, null, 12.5] as (number | null)[] };

    it("takes the close of the bar the boundary falls in, as of the bar's end", () => {
      expect(priceAtBoundary(bars, 30, 1_000)).to.deep.equal({ price: 100_000n, publishTime: 60 });
      expect(priceAtBoundary(bars, 0, 1_000)).to.deep.equal({ price: 100_000n, publishTime: 60 });
    });

    it("skips a minute with no trade to the next bar that has one", () => {
      // The boundary is the end of bar 0, bar 1 is empty, so bar 2.
      expect(priceAtBoundary(bars, 60, 1_000)).to.deep.equal({ price: 125_000n, publishTime: 180 });
      expect(priceAtBoundary(bars, 90, 1_000)).to.deep.equal({ price: 125_000n, publishTime: 180 });
    });

    it("waits while the bar is still forming, and when there is none yet", () => {
      expect(priceAtBoundary(bars, 30, 60 + 19)).to.equal(null);
      expect(priceAtBoundary(bars, 30, 60 + 20)).to.deep.equal({ price: 100_000n, publishTime: 60 });
      expect(priceAtBoundary(bars, 200, 10_000)).to.equal(null);
      expect(priceAtBoundary({ t: [], c: [] }, 30, 1_000)).to.equal(null);
    });

    it("rounds the source's float noise away, the same way every time", () => {
      const noisy = { t: [0], c: [332.6000061035156] };
      expect(priceAtBoundary(noisy, 10, 1_000)?.price).to.equal(3_326_000n);
    });
  });

  /* OUT OF HOURS, THE TOKEN PRICES THE STOCK.
   *
   * The exchange shuts and the pool does not, which is the argument for
   * putting a share on a chain at all. The defence against a thin minute being
   * bought is that the price is the median of fifteen of them. */
  describe("trimmedMeanAtBoundary", () => {
    /** A window of minute bars ending exactly at `boundary`. */
    const window = (closes: (number | null)[], boundary = 900) => ({
      t: closes.map((_, i) => boundary - (closes.length - i) * 60),
      c: closes,
    });
    const at = (bars: ReturnType<typeof window>) => trimmedMeanAtBoundary(bars, 900);

    it("averages the middle of the window, as of the boundary", () => {
      // Nine closes: one off each end, mean of the middle seven.
      const bars = window([10, 12, 11, 13, 9, 10, 11, 12, 10]);
      expect(at(bars)).to.deep.equal({ price: 108_571n, publishTime: 900 });
    });

    it("discards a bought minute outright", () => {
      const honest = [100, 100, 101, 100, 99, 100, 100, 101, 100, 100, 99, 100, 100, 100, 101];
      const before = at(window(honest))!.price;
      // One minute taken to the moon is trimmed away and changes nothing.
      expect(at(window([...honest.slice(0, -1), 900]))!.price).to.equal(before);
      // So is one taken to the floor.
      expect(at(window([...honest.slice(0, -1), 1]))!.price).to.equal(before);
    });

    /* THE FAULT THAT SENT US HERE.
     *
     * A median is whichever close sits in the middle, so a window that slides
     * a little often reports the same number twice and the fight is declared a
     * draw. An average of the middle moves whenever the market does. */
    it("moves when the market moves, which a median would not have", () => {
      const start = [100, 100, 101, 100, 99, 100, 100, 101, 100, 100, 99, 100, 100, 100, 101];
      // Two minutes pass and the price drifts up; the middle sample is still 100.
      const later = [...start.slice(2), 102, 103];
      const a = at(window(start))!.price;
      const b = at(window(later))!.price;
      expect(b > a, `${b} should be above ${a}`).to.equal(true);
    });

    it("ignores anything at or after the boundary, and anything older than the hour", () => {
      const boundary = 100_000;
      const bars = {
        // Four inside the hour, two at or after the boundary, one long past.
        t: [0, boundary - 3_000, boundary - 2_400, boundary - 1_800, boundary - 600, boundary, boundary + 60],
        c: [1, 10, 10, 10, 10, 999, 999],
      };
      // Four is under the minimum, so the ones after the boundary cannot help.
      expect(trimmedMeanAtBoundary(bars, boundary)).to.equal(null);
    });

    /* THE FIGHT THAT WOULD NOT SETTLE.
     *
     * MSFT's pool traded a handful of minutes at one in the morning, a fixed
     * quarter-hour window held none of them, and a real fight sat unsettled
     * with no price to end it. Reaching back an hour for the same number of
     * closes is what fixed it. */
    it("reaches back through a quiet hour rather than giving no price", () => {
      const boundary = 100_000;
      const minutes = [55, 44, 33, 22, 11]; // minutes ago, scattered across the hour
      const bars = {
        t: minutes.map((m) => boundary - m * 60 - 60).reverse(),
        c: [100, 101, 102, 103, 104].reverse(),
      };
      const got = trimmedMeanAtBoundary(bars, boundary);
      expect(got, "five closes in the hour is a price").to.not.equal(null);
      expect(got!.publishTime).to.equal(boundary);
    });

    it("gives nothing when the pool barely traded", () => {
      expect(at(window([10, null, null, 11, null, null, 12]))).to.equal(null);
      expect(at(window([10, 0, -1, 11, null]))).to.equal(null);
      expect(trimmedMeanAtBoundary({ t: [], c: [] }, 900)).to.equal(null);
    });
  });

  describe("which market answers for a moment", () => {
    // 2026-09-15 is a Tuesday; 2026-09-13 a Sunday.
    const at = (hh: number, mm: number, day = 15) => Math.floor(nyToMs(2026, 9, day, hh, mm, 0) / 1000);
    const pooled = { market: "US", pool: "somepool" };
    const both = { market: "US", pool: "somepool", perp: "xyz:NVDA" };

    it("uses the exchange right through its extended hours", () => {
      expect(sourceAt(at(4, 0), both)).to.equal("exchange"); // pre-market opens
      expect(sourceAt(at(12, 0), both)).to.equal("exchange");
      expect(sourceAt(at(19, 59), both)).to.equal("exchange"); // after-hours still going
    });

    /* The perp prints every minute and the pool does not, so when both exist
     * the perp wins and the price can use the ordinary boundary rule. */
    it("prefers the perpetual market once the exchange is shut", () => {
      expect(sourceAt(at(20, 0), both)).to.equal("perp"); // after-hours over
      expect(sourceAt(at(2, 30), both)).to.equal("perp"); // the middle of the night
      expect(sourceAt(at(12, 0, 13), both)).to.equal("perp"); // a Sunday
    });

    it("falls back to the pool for a stock with no perpetual market", () => {
      expect(sourceAt(at(2, 30), pooled)).to.equal("pool");
    });

    it("keeps exchange hours for a stock with neither", () => {
      expect(sourceAt(at(2, 30), { market: "US" })).to.equal("exchange");
    });

    it("keeps exchange hours for a listing whose sessions we do not model", () => {
      // Hong Kong trades while New York sleeps; guessing would be worse than
      // waiting for its own bars.
      expect(sourceAt(at(2, 30), { market: "HK", pool: "somepool", perp: "xyz:NVDA" })).to.equal("exchange");
    });
  });

  /* WHAT THE ORACLE ASKS OF OTHER PEOPLE'S APIS, AND WHEN.
   *
   * Every test here replaces fetch, so nothing leaves the machine. Each uses
   * its own coin, pool or boundary, because the oracle keeps finished answers
   * and a shared one would be served from memory instead of asked. */
  describe("asking the price sources", () => {
    const realFetch = globalThis.fetch;
    type Call = { url: string; init?: RequestInit };
    let calls: Call[] = [];

    const stubFetch = (respond: (call: Call) => Response | Promise<Response>) => {
      calls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const call = { url, init };
        calls.push(call);
        return respond(call);
      }) as typeof fetch;
    };
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    /** A price source with a bar for every minute: Hyperliquid's candles or
     *  Yahoo's chart, whichever was asked. */
    const everyMinute = ({ url, init }: Call) => {
      if (url.includes("hyperliquid")) {
        const { req } = JSON.parse(String(init?.body)) as { req: { startTime: number; endTime: number } };
        const rows = [];
        for (let t = Math.ceil(req.startTime / 60_000) * 60_000; t < req.endTime; t += 60_000) {
          rows.push({ t, c: "230.5" });
        }
        return json(rows);
      }
      const q = new URL(url).searchParams;
      const timestamp = [];
      for (let t = Math.ceil(Number(q.get("period1")) / 60) * 60; t < Number(q.get("period2")); t += 60) {
        timestamp.push(t);
      }
      return json({ chart: { result: [{ timestamp, indicators: { quote: [{ close: timestamp.map(() => 101.25) }] } }] } });
    };

    const feed = "0a".repeat(32);
    // A Sunday night, when a stock with a perp is priced by it.
    const shut = Math.floor(nyToMs(2026, 9, 13, 21, 56, 32) / 1000);
    // A Tuesday noon, when the exchange prices it.
    const open = Math.floor(nyToMs(2026, 9, 15, 12, 0, 30) / 1000);

    /* An early nudge, or a crank ahead of its clock, must cost nobody a
     * request: before the bar can be final there is no answer to be had. */
    it("asks the perp nothing until its bar can be final, then asks once", async () => {
      stubFetch(everyMinute);
      const opts = { feed, symbol: "AAPL", market: "US", perp: "xyz:GATE-PERP", boundary: shut };
      const final = firstBarEnd(shut) + BAR_SETTLE_SECS;
      for (let now = shut - 900; now < final; now += 7) {
        expect(await quoteAt({ ...opts, now }), `at ${now - shut}s`).to.equal(null);
      }
      expect(calls).to.have.length(0);

      const q = await quoteAt({ ...opts, now: final });
      expect(calls).to.have.length(1);
      expect(q?.publishTime).to.equal(firstBarEnd(shut));
      expect(q?.price).to.equal(2_305_000n);
    });

    it("asks the exchange nothing until its bar can be final, then asks once", async () => {
      stubFetch(everyMinute);
      const opts = { feed, symbol: "GATE-EXCH", market: "US", boundary: open };
      const final = firstBarEnd(open) + BAR_SETTLE_SECS;
      for (let now = open - 900; now < final; now += 7) {
        expect(await quoteAt({ ...opts, now })).to.equal(null);
      }
      expect(calls).to.have.length(0);

      const q = await quoteAt({ ...opts, now: final });
      expect(calls).to.have.length(1);
      expect(q?.publishTime).to.equal(firstBarEnd(open));
    });

    /* A pool too quiet to price falls back to the exchange's first bar after
     * the boundary. On a Sunday night that bar is Monday's 4:00, so asking the
     * exchange's data source before then can only come back empty, and a page
     * left open all night used to make it ask every few seconds. */
    it("asks the exchange nothing for a quiet pool until the exchange has opened, and the pool only once", async () => {
      const twoBars = { data: { attributes: { ohlcv_list: [[shut - 600, 1, 1, 1, 100, 1], [shut - 300, 1, 1, 1, 101, 1]] } } };
      const monday = Math.floor(nyToMs(2026, 9, 14, 4, 1, 20) / 1000);
      // The exchange's bars, as the data source has them: nothing before Monday's 4:00.
      const exchange = (url: string) => {
        const q = new URL(url).searchParams;
        const timestamp = [];
        for (let t = monday - 80; t < Number(q.get("period2")); t += 60) timestamp.push(t);
        return json({ chart: { result: [{ timestamp, indicators: { quote: [{ close: timestamp.map(() => 99.5) }] } }] } });
      };
      stubFetch(({ url }) => (url.includes("geckoterminal") ? json(twoBars) : exchange(url)));
      const opts = { feed, symbol: "QUIET", market: "US", pool: "quietpool", boundary: shut };
      expect(exchangeBarFinal(shut, "US")).to.equal(monday);
      expect(poolWindowThin("quietpool", shut)).to.equal(undefined);

      for (const now of [shut + 20, shut + 60, shut + 3_600, monday - 1]) {
        expect(await quoteAt({ ...opts, now })).to.equal(null);
      }
      expect(calls.map((c) => new URL(c.url).host)).to.deep.equal(["api.geckoterminal.com"]);
      expect(poolWindowThin("quietpool", shut)).to.equal(true);

      const q = await quoteAt({ ...opts, now: monday });
      expect(calls.map((c) => new URL(c.url).host)).to.deep.equal(["api.geckoterminal.com", "query1.finance.yahoo.com"]);
      expect(q?.publishTime).to.equal(monday - BAR_SETTLE_SECS);
    });

    it("never moves the exchange's time earlier than its bar, in session or out of the US", () => {
      expect(exchangeBarFinal(open, "US")).to.equal(firstBarEnd(open) + BAR_SETTLE_SECS);
      // Sunday 9:56 PM New York is Monday 9:56 AM in Hong Kong: HKEX is in session.
      expect(exchangeBarFinal(shut, "HK")).to.equal(firstBarEnd(shut) + BAR_SETTLE_SECS);
      // Tuesday noon New York is midnight in Hong Kong: its bar waits for Wednesday's 9:30 AM HKT, 9:30 PM ET.
      expect(exchangeBarFinal(open, "HK")).to.equal(Math.floor(nyToMs(2026, 9, 15, 21, 31, 20) / 1000));
      // A market whose sessions are not modelled keeps the plain rule.
      expect(exchangeBarFinal(open, "SOMEWHERE")).to.equal(firstBarEnd(open) + BAR_SETTLE_SECS);
    });

    it("asks the pool nothing until its window has settled", async () => {
      stubFetch(() => json({}, 404));
      const opts = { feed, symbol: "GATE-POOL", market: "US", pool: "gatepool", boundary: shut };
      expect(await quoteAt({ ...opts, now: shut + BAR_SETTLE_SECS - 1 })).to.equal(null);
      expect(calls).to.have.length(0);
    });

    /* The bug this pins: asked before the boundary, the perp window ran from
     * five minutes before the boundary to `now`, which was earlier still. The
     * venue answered 502 and the quote route reported a failure where it
     * should have said "not yet". */
    it("never sends a window that ends before it starts", async () => {
      stubFetch(everyMinute);
      const coin = "xyz:WINDOW";
      for (let now = shut - 1_200; now <= shut + 1_200; now += 13) {
        await quoteAt({ feed, symbol: "WINDOW", market: "US", perp: coin, boundary: shut, now });
        await quoteAt({ feed, symbol: "WINDOW", market: "US", boundary: open, now: open - shut + now });
      }
      expect(calls.length).to.be.greaterThan(0);
      for (const { url, init } of calls) {
        if (url.includes("hyperliquid")) {
          const { req } = JSON.parse(String(init?.body)) as { req: { startTime: number; endTime: number } };
          expect(req.startTime, url).to.be.lessThan(req.endTime);
        } else {
          const q = new URL(url).searchParams;
          expect(Number(q.get("period1")), url).to.be.lessThan(Number(q.get("period2")));
        }
      }
      // Asked directly for an empty window, it asks nobody.
      const before = calls.length;
      expect(await fetchPerpBars(coin, 2_000, 1_000)).to.deep.equal({ t: [], c: [] });
      expect(calls).to.have.length(before);
    });

    /* A quiet perp minute has no candle until the next trade fills it in. A
     * fight whose settler is ten minutes late asks with a fixed window, and a
     * cached answer from before that trade would hide the price from this
     * instance for good. */
    it("does not keep a perp window whose last minute has not printed yet", async () => {
      const boundary = 1_789_364_820; // on the minute
      const to = boundary + 600;
      const now = to + 3_600;
      const realNow = Date.now;
      Date.now = () => now * 1_000;
      let printed = false;
      stubFetch(() => {
        const last = printed ? to : boundary;
        const rows = [];
        for (let t = boundary - 300; t <= last; t += 60) rows.push({ t: t * 1_000, c: "640.78" });
        return json(rows);
      });
      try {
        const coin = "xyz:QUIETNIGHT";
        const early = await fetchPerpBars(coin, boundary - 300, to);
        expect(early.t[early.t.length - 1]).to.equal(boundary);
        printed = true;
        // Asked again, it asks the venue again and sees the minutes filled in.
        const later = await fetchPerpBars(coin, boundary - 300, to);
        expect(calls).to.have.length(2);
        expect(later.t[later.t.length - 1]).to.equal(to);
        // Now it reaches the end of its window, it is kept.
        await fetchPerpBars(coin, boundary - 300, to);
        expect(calls).to.have.length(2);
      } finally {
        Date.now = realNow;
      }
    });

    it("keeps a perp window only once it reaches its last minute and that minute has settled", () => {
      const bars = (last: number) => ({ t: [last - 120, last - 60, last], c: [1, 1, 1] });
      const to = 1_789_365_420;
      expect(perpWindowComplete(bars(to), to, to + 80)).to.equal(true);
      expect(perpWindowComplete(bars(to), to, to + 79)).to.equal(false);
      expect(perpWindowComplete(bars(to - 60), to, to + 3_600)).to.equal(false);
      expect(perpWindowComplete({ t: [], c: [] }, to, to + 3_600)).to.equal(false);
      // `to` mid-minute: the candle that minute starts with is enough.
      expect(perpWindowComplete(bars(to), to + 30, to + 30 + 80)).to.equal(true);
    });

    /* ELAPSED TIME IS READ FROM THE MONOTONIC CLOCK.
     *
     * Date.now() is the wall clock, and the machine is free to step it. Under
     * WSL it does, backwards by a second or more when it resyncs with the host:
     * a run measured with Date.now() saw a five-second abort "fire" after 3.5s,
     * while performance.now() and process.hrtime in the same run agreed on
     * 5,027ms. Timers run on the monotonic clock, so that is the one to time
     * them with. */
    const elapsed = (t0: number) => performance.now() - t0;

    /* A hung source used to hold a crank pass until the platform killed it.
     * All three are started together, so the suite waits five seconds once. */
    it("gives up on a source that never answers, within five seconds", async function () {
      this.timeout(FETCH_TIMEOUT_MS + 4_000);
      stubFetch(
        ({ init }) =>
          new Promise<Response>((_, reject) => {
            const signal = init?.signal;
            // No signal means nothing would ever end this request.
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      );
      const t0 = performance.now();
      const settle = (p: Promise<unknown>) =>
        p.then(
          () => ({ ok: true, name: "", ms: elapsed(t0) }),
          (e: Error) => ({ ok: false, name: e.name, ms: elapsed(t0) }),
        );
      const results = await Promise.all([
        settle(fetchBars("HUNG", 1_000, 2_000)),
        settle(fetchPerpBars("xyz:HUNG", 1_000, 2_000)),
        settle(fetchPoolBars("hungpool", 1_000)),
      ]);
      expect(calls).to.have.length(3);
      for (const r of results) {
        expect(r.ok).to.equal(false);
        // Our own timeout ended it, not something else going wrong first.
        expect(r.name).to.equal("TimeoutError");
        expect(r.ms).to.be.within(FETCH_TIMEOUT_MS - 50, FETCH_TIMEOUT_MS + 1_500);
      }
    });

    it("tries a failing pool twice, a second apart, and no more", async function () {
      this.timeout(5_000);
      stubFetch(() => json({}, 503));
      const t0 = performance.now();
      let error = "";
      await fetchPoolBars("retrypool", 2_000).catch((e: Error) => (error = e.message));
      const ms = elapsed(t0);
      expect(error).to.match(/HTTP 503/);
      expect(calls).to.have.length(POOL_ATTEMPTS);
      expect(POOL_ATTEMPTS).to.equal(2);
      expect(ms).to.be.within(900, 1_900);
    });

    it("does not retry a pool that is simply not there", async () => {
      stubFetch(() => json({}, 404));
      await fetchPoolBars("nopool", 3_000).catch(() => null);
      expect(calls).to.have.length(1);
    });
  });
});
