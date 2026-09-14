/* A live price comes from the market that would settle a fight ending now, and
 * says which one. These pin that choice to the oracle's hours, and pin the
 * small readers the prices and bars routes are built from. */

import { expect } from "chai";

import { lastClose, liveSourceFor, mergeBars, parseAllMids } from "../src/lib/livePrice";
import { nyToMs } from "../src/lib/market";
import { sourceWords } from "../src/lib/pricemath";
import { byTicker, type Stock } from "../src/lib/stocks";

const et = (y: number, m: number, d: number, hh: number, mm: number, ss = 0) =>
  Math.floor(nyToMs(y, m, d, hh, mm, ss) / 1000);

const stock = (ticker: string): Stock => {
  const s = byTicker(ticker);
  if (!s) throw new Error(`${ticker} is not on the roster`);
  return s;
};

const SUNDAY_NIGHT = et(2026, 9, 13, 20, 30); // exchange shut
const TUESDAY_AFTER = et(2026, 9, 15, 18, 0); // after-hours
const TUESDAY_PRE = et(2026, 9, 15, 7, 0); // pre-market
const TUESDAY_OPEN = et(2026, 9, 15, 11, 0); // regular session

describe("live price sources", () => {
  it("keeps a Pyth-priced stock on Pyth in every session", () => {
    const tsla = stock("TSLA");
    expect(tsla.source).to.equal("pyth");
    for (const t of [SUNDAY_NIGHT, TUESDAY_PRE, TUESDAY_OPEN, TUESDAY_AFTER]) {
      expect(liveSourceFor(tsla, t)).to.equal("pyth");
    }
  });

  it("follows a US stock with a perp through the oracle's hours", () => {
    // NVDA is in src/data/perps.json and priced by the oracle.
    const nvda = stock("NVDA");
    expect(liveSourceFor(nvda, SUNDAY_NIGHT)).to.equal("perp");
    expect(liveSourceFor(nvda, TUESDAY_AFTER)).to.equal("extended");
    expect(liveSourceFor(nvda, TUESDAY_PRE)).to.equal("extended");
    expect(liveSourceFor(nvda, TUESDAY_OPEN)).to.equal("regular");
  });

  it("reads a pool-only stock's pool while the exchange is shut", () => {
    // SPY has a pinned pool and no perp. The oracle prices it on the pool's
    // trimmed mean off-hours, so the page does too.
    const spy = stock("SPY");
    expect(spy.source).to.equal("signed");
    expect(liveSourceFor(spy, SUNDAY_NIGHT)).to.equal("pool");
    expect(liveSourceFor(spy, TUESDAY_OPEN)).to.equal("regular");
  });

  it("shows the last close for a stock nothing prices while shut", () => {
    // NFLX has neither a perp nor a pool, so its fights wait for the open.
    const nflx = stock("NFLX");
    expect(liveSourceFor(nflx, SUNDAY_NIGHT)).to.equal("last");
    expect(liveSourceFor(nflx, TUESDAY_AFTER)).to.equal("extended");
  });

  it("leaves a listing abroad on its exchange", () => {
    const hk = stock("AIAGR");
    expect(hk.market).to.not.equal("US");
    expect(liveSourceFor(hk, SUNDAY_NIGHT)).to.equal("regular");
    expect(liveSourceFor(hk, TUESDAY_OPEN)).to.equal("regular");
  });

  it("names each source in the page's words", () => {
    expect(sourceWords("pyth")).to.equal("Pyth");
    expect(sourceWords("regular")).to.equal("Exchange");
    expect(sourceWords("extended")).to.equal("Extended hours");
    expect(sourceWords("perp")).to.equal("Perp");
    expect(sourceWords("pool")).to.equal("Pool");
    expect(sourceWords("last")).to.equal("Last close");
  });
});

describe("reading perp mids", () => {
  it("keeps positive finite prices and drops everything else", () => {
    const fixture = {
      "xyz:NVDA": "214.99",
      "xyz:AAPL": "330.465",
      "xyz:ZERO": "0",
      "xyz:NEG": "-3",
      "xyz:WORD": "n/a",
      "xyz:EMPTY": "",
      "xyz:NULL": null,
      "xyz:OBJ": { px: "1" },
      "xyz:INF": "Infinity",
      BTC: 58000.5,
    };
    expect(parseAllMids(fixture)).to.deep.equal({ "xyz:NVDA": 214.99, "xyz:AAPL": 330.465, BTC: 58000.5 });
  });

  it("answers an empty map for a body that is not an object of mids", () => {
    expect(parseAllMids(null)).to.deep.equal({});
    expect(parseAllMids("oops")).to.deep.equal({});
    expect(parseAllMids([1, 2])).to.deep.equal({});
  });
});

describe("the last close in a run of minute bars", () => {
  const t0 = et(2026, 9, 15, 17, 0);

  it("skips trailing minutes with no trade", () => {
    const bars = { t: [t0, t0 + 60, t0 + 120, t0 + 180], c: [10, 10.5, null, null] };
    expect(lastClose(bars)).to.deep.equal({ price: 10.5, time: t0 + 120 });
  });

  it("ends a late-stamped last-trade point with its own minute", () => {
    const bars = { t: [t0, t0 + 59], c: [10, 10.25] };
    expect(lastClose(bars)).to.deep.equal({ price: 10.25, time: t0 + 60 });
  });

  it("answers null when nothing traded", () => {
    expect(lastClose({ t: [], c: [] })).to.equal(null);
    expect(lastClose({ t: [t0, t0 + 60], c: [null, 0] })).to.equal(null);
  });
});

describe("merging exchange and perp bars", () => {
  it("takes exchange minutes in session and perp minutes once shut", () => {
    // Tuesday 15 Sep: after-hours ends at 8:00 PM ET, when the exchange shuts.
    const m = (hh: number, mm: number) => et(2026, 9, 15, hh, mm);
    const isClosed = (t: number) => t >= m(20, 0);
    const exchange = {
      t: [m(19, 57), m(19, 58), m(19, 59), m(19, 59) + 59, m(20, 0)],
      c: [100, null, 101, 101.5, 999],
    };
    const perp = {
      t: [m(19, 58), m(19, 59), m(20, 0), m(20, 1), m(20, 2)],
      c: [888, 888, 102, null, 103],
    };
    expect(mergeBars(exchange, perp, isClosed)).to.deep.equal({
      t: [m(19, 57), m(19, 59), m(20, 0), m(20, 2)],
      c: [100, 101.5, 102, 103],
      src: ["exchange", "exchange", "perp", "perp"],
    });
  });

  it("uses the oracle's own session rule at the bell", () => {
    const m = (hh: number, mm: number) => et(2026, 9, 15, hh, mm);
    const isClosed = (t: number) => liveSourceFor(stock("NVDA"), t) === "perp";
    const merged = mergeBars(
      { t: [m(19, 59), m(20, 0)], c: [50, 51] },
      { t: [m(19, 59), m(20, 0)], c: [60, 61] },
      isClosed,
    );
    expect(merged.src).to.deep.equal(["exchange", "perp"]);
    expect(merged.c).to.deep.equal([50, 61]);
  });
});
