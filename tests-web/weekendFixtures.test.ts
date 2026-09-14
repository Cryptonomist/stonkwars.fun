/* The weekend fixtures are whole, and are the data the plan measured.
 *
 * Every later test of the 24/7 rule reads these files, so a truncated or
 * reordered one would quietly turn its cases into different cases. This pins
 * what was cut: the row count of every stock at every venue, the order and
 * spacing of the minutes, and one property of Hyperliquid's candles that the
 * rule relies on and the verification measured (a minute with no trade repeats
 * the close before it). */

import { expect } from "chai";

import {
  loadWeekend,
  WEEKEND_FROM,
  WEEKEND_TICKERS,
  WEEKEND_UNTIL,
  WEEKEND_VENUES,
  weekendBytes,
  weekendMinutes,
} from "./fixtures/weekend";

/* Rows per stock, as cut. 3,000 is the whole window, fifty hours of minutes.
 * Backpack drops quiet minutes at the start of a window and lists no perp for
 * four of the stocks. */
const FULL = 3_000;
const BACKPACK: Record<string, number> = {
  TSLA: 2_989,
  NVDA: 2_998,
  AAPL: 2_996,
  GOOGL: 2_853,
  META: 2_641,
  HOOD: 2_987,
  CRCL: 2_995,
  MU: 2_969,
};

describe("weekend fixtures, 12 Sep 2026", () => {
  it("has nine venues, six of them anchors", () => {
    expect(WEEKEND_VENUES.length).to.equal(9);
    expect(WEEKEND_VENUES.filter((v) => loadWeekend(v).anchor)).to.deep.equal([
      "xyz",
      "okx_perp",
      "bitget_perp",
      "binance_bstock",
      "lighter_perp",
      "backpack_perp",
    ]);
  });

  it("has every stock's rows at every venue", () => {
    let total = 0;
    for (const venue of WEEKEND_VENUES) {
      const file = loadWeekend(venue);
      expect(file.from, venue).to.equal(WEEKEND_FROM);
      expect(file.until, venue).to.equal(WEEKEND_UNTIL);
      for (const ticker of WEEKEND_TICKERS) {
        const rows = weekendMinutes(venue, ticker);
        const want = venue === "backpack_perp" ? BACKPACK[ticker] : FULL;
        if (want === undefined) {
          expect(rows, `${venue} ${ticker}`).to.equal(null);
          continue;
        }
        expect(rows, `${venue} ${ticker}`).to.have.length(want);
        total += rows!.length;
      }
    }
    expect(total).to.equal(8 * 12 * FULL + Object.values(BACKPACK).reduce((a, b) => a + b, 0));
  });

  /* Three hundred thousand rows: checked in a plain loop, and every problem
   * listed at once, because an assertion per row takes longer than the test. */
  it("keeps each stock's minutes in order, on the minute, inside the window, with real closes", () => {
    const problems: string[] = [];
    for (const venue of WEEKEND_VENUES) {
      for (const [ticker, rows] of Object.entries(loadWeekend(venue).rows)) {
        let last = -Infinity;
        for (const m of rows!) {
          const ok =
            m.t % 60 === 0 &&
            m.t > last &&
            m.t >= WEEKEND_FROM &&
            m.t < WEEKEND_UNTIL &&
            Number.isFinite(m.c) &&
            m.c > 0 &&
            m.amount >= 0;
          if (!ok) problems.push(`${venue} ${ticker} at ${m.t}`);
          last = m.t;
        }
        // Every venue but Backpack prints every minute of the window.
        if (venue !== "backpack_perp" && rows!.at(-1)!.t - rows![0].t !== (FULL - 1) * 60) problems.push(`${venue} ${ticker} has a gap`);
      }
    }
    expect(problems.slice(0, 10)).to.deep.equal([]);
  });

  it("repeats the last close on every Hyperliquid minute with no trade", () => {
    let quiet = 0;
    const moved: string[] = [];
    for (const ticker of WEEKEND_TICKERS) {
      const rows = weekendMinutes("xyz", ticker)!;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].traded) continue;
        quiet++;
        if (rows[i].c !== rows[i - 1].c) moved.push(`${ticker} at ${rows[i].t}`);
      }
    }
    expect(moved).to.deep.equal([]);
    expect(quiet).to.equal(11_054);
  });

  it("is the 7,259,173 bytes that were cut, under 8 MB", () => {
    expect(weekendBytes()).to.equal(7_259_173).and.below(8_000_000);
  });
});
