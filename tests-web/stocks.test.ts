import { expect } from "chai";

import { SOURCE_PYTH, SOURCE_SIGNED, START_DELAY_SECS } from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import { firstBarEnd, PYTH_GRACE_SECS, readyAt, type ClockDuel, type Ready } from "../src/lib/priceClock";
import {
  byTicker,
  firstPriceAt,
  mixedHoursAt,
  pricedAt,
  quoteSymbolFor,
  SAME_PRICE_SECS,
  tradesAroundTheClock,
} from "../src/lib/stocks";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/** A New York wall-clock time, in unix seconds. */
const ny = (y: number, m: number, d: number, hh: number, mm: number, ss = 0) =>
  Math.floor(nyToMs(y, m, d, hh, mm, ss) / 1000);
/** September 2026: the 11th is a Friday, the 12th and 13th the weekend, the
 *  14th a Monday. The 7th was Labor Day. */
const sep = (day: number, hh: number, mm: number, ss = 0) => ny(2026, 9, day, hh, mm, ss);

const SATURDAY = at("2026-09-12T18:00:00Z");
const FRIDAY_OPEN = at("2026-09-11T18:00:00Z"); // 2 PM ET

describe("fights across trading hours", () => {
  it("starts from two stocks that trade around the clock", () => {
    // The page's default pair and the faucet's starter set.
    for (const t of ["AAPL", "NVDA", "MSFT", "GOOGL"]) {
      expect(tradesAroundTheClock(t), t).to.equal(true);
      expect(pricedAt(t, SATURDAY), t).to.not.equal("waits");
    }
  });

  it("refuses a pair with exactly one side waiting for its exchange", () => {
    expect(pricedAt("TSLA", SATURDAY)).to.equal("waits");
    const said =
      "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be days apart. " +
      "Pick two that both trade now, or two that both wait.";
    expect(mixedHoursAt("TSLA", "NVDA", SATURDAY)).to.equal(said);
    expect(mixedHoursAt("NVDA", "TSLA", SATURDAY)).to.equal(said);
  });

  it("allows two that both trade, two that both wait, and any pair in session", () => {
    expect(mixedHoursAt("AAPL", "NVDA", SATURDAY)).to.equal(null);
    expect(mixedHoursAt("TSLA", "QQQ", SATURDAY)).to.equal(null);
    expect(mixedHoursAt("TSLA", "NVDA", FRIDAY_OPEN)).to.equal(null);
  });

  it("says nothing about a ticker off the roster", () => {
    expect(mixedHoursAt("?", "NVDA", SATURDAY)).to.equal(null);
  });

  /* The kinds these tests lean on. A roster rebuild that gives NFLX a perp
   * or TSLA an oracle should fail here, by name, rather than quietly turn the
   * cases below into different cases. */
  it("has the kinds of stock the cases below assume", () => {
    const kind = (t: string) => {
      const s = byTicker(t)!;
      const where = quoteSymbolFor(s.feed)!;
      return [s.source, s.market, !!where.perp, !!where.pool].join(" ");
    };
    expect(kind("TSLA")).to.equal("pyth US true false");
    expect(kind("QQQ")).to.equal("pyth US false true");
    expect(kind("VOO")).to.equal("pyth US false false");
    expect(kind("NVDA")).to.equal("signed US true true");
    expect(kind("SPY")).to.equal("signed US false true");
    expect(kind("NFLX")).to.equal("signed US false false");
    expect(kind("JPM")).to.equal("signed US false false");
    expect(kind("BYDCO")).to.equal("signed HK false false");
  });

  describe("a Pyth stock keeps the regular session's hours", () => {
    it("prices only from 9:30 to the close, whatever its perp or the exchange's bars do", () => {
      expect(pricedAt("TSLA", sep(14, 8, 0))).to.equal("waits"); // pre-market
      expect(pricedAt("TSLA", sep(14, 9, 29, 59))).to.equal("waits");
      expect(pricedAt("TSLA", sep(14, 9, 30))).to.equal("exchange");
      expect(pricedAt("TSLA", sep(14, 10, 0))).to.equal("exchange"); // open
      expect(pricedAt("TSLA", sep(14, 15, 59, 59))).to.equal("exchange");
      expect(pricedAt("TSLA", sep(14, 16, 0))).to.equal("waits");
      expect(pricedAt("TSLA", sep(11, 19, 0))).to.equal("waits"); // after-hours
      expect(pricedAt("TSLA", SATURDAY)).to.equal("waits"); // closed
      expect(pricedAt("TSLA", sep(14, 22, 0))).to.equal("waits"); // closed, a weekday night
    });

    it("leaves a signed stock on its exchange's bars from 4am to 8pm", () => {
      expect(pricedAt("NVDA", sep(14, 8, 0))).to.equal("exchange");
      expect(pricedAt("NVDA", sep(11, 19, 0))).to.equal("exchange");
      expect(pricedAt("NVDA", sep(14, 22, 0))).to.equal("perp");
      expect(pricedAt("SPY", SATURDAY)).to.equal("pool");
      expect(pricedAt("NFLX", sep(11, 19, 0))).to.equal("exchange");
      expect(pricedAt("NFLX", SATURDAY)).to.equal("waits");
      expect(pricedAt("BYDCO", SATURDAY)).to.equal("exchange");
    });

    it("dates each side's first price to the opening it waits for", () => {
      expect(firstPriceAt("TSLA", sep(11, 19, 0))).to.equal(sep(14, 9, 30));
      expect(firstPriceAt("TSLA", sep(14, 8, 0))).to.equal(sep(14, 9, 30));
      expect(firstPriceAt("TSLA", sep(14, 10, 0))).to.equal(sep(14, 10, 0));
      expect(firstPriceAt("NFLX", SATURDAY)).to.equal(sep(14, 4, 0));
      expect(firstPriceAt("NFLX", sep(11, 19, 0))).to.equal(sep(11, 19, 0));
      expect(firstPriceAt("NVDA", SATURDAY)).to.equal(SATURDAY);
      expect(firstPriceAt("BYDCO", SATURDAY)).to.equal(SATURDAY);
      expect(firstPriceAt("?", SATURDAY)).to.equal(null);
    });
  });

  describe("refuses a start the gap between two markets would decide", () => {
    /* The bug: at 7pm on a Friday TSLA v NVDA could be taken. NVDA started
     * from its 7:01pm after-hours bar and TSLA from Monday's 9:30 Pyth print,
     * so the weekend decided the fight. */
    it("refuses TSLA v NVDA at 7pm on a Friday, and at 8am on a Monday", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 0))).to.equal(
        "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be days apart. " +
          "Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("NVDA", "TSLA", sep(14, 8, 0))).to.equal(
        "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be hours apart. " +
          "Pick two that both trade now, or two that both wait.",
      );
    });

    it("allows TSLA v NVDA at 10am on a Monday", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 10, 0))).to.equal(null);
    });

    it("allows two Pyth stocks together outside the session, waiting for the same bell", () => {
      expect(mixedHoursAt("TSLA", "QQQ", SATURDAY)).to.equal(null);
      expect(mixedHoursAt("TSLA", "QQQ", sep(11, 19, 0))).to.equal(null);
      expect(mixedHoursAt("VOO", "TSLA", sep(14, 8, 0))).to.equal(null);
    });

    it("refuses a Pyth stock against one with neither perp nor pool on a Saturday: both wait, for different openings", () => {
      const said =
        "NFLX would start at Monday's 4:00 AM ET pre-market open but TSLA not until Monday's 9:30 AM ET opening bell, " +
        "so their start prices would be hours apart. Pick two that open at the same time, or two that both trade now.";
      expect(mixedHoursAt("TSLA", "NFLX", SATURDAY)).to.equal(said);
      expect(mixedHoursAt("NFLX", "TSLA", SATURDAY)).to.equal(said);
      // After 8pm on a weekday, the same two openings the next morning.
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 21, 0))).to.equal(said.replace(/Monday/g, "Tuesday"));
    });

    it("allows two stocks with neither perp nor pool on a Saturday, and a stock abroad against a perp", () => {
      expect(mixedHoursAt("NFLX", "JPM", SATURDAY)).to.equal(null);
      expect(mixedHoursAt("BYDCO", "NVDA", SATURDAY)).to.equal(null);
    });

    /* A pre-market bar that closes at 9:30:00 and Pyth's 9:30:00 print are as
     * close as any fight in session, where a bar closes up to a minute after
     * a Pyth print. Past a minute the gap counts. */
    it("counts two first prices within a minute as starting together", () => {
      expect(SAME_PRICE_SECS).to.equal(60);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 9, 29, 59))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 9, 29, 0))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 9, 28, 59))).to.equal(
        "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be minutes apart. " +
          "Pick two that both trade now, or two that both wait.",
      );
    });

    it("knows a holiday: Labor Day waits for Tuesday", () => {
      const labor = sep(7, 10, 0);
      expect(pricedAt("TSLA", labor)).to.equal("waits");
      expect(pricedAt("NVDA", labor)).to.equal("perp");
      expect(firstPriceAt("TSLA", labor)).to.equal(sep(8, 9, 30));
      expect(firstPriceAt("NFLX", labor)).to.equal(sep(8, 4, 0));
      expect(mixedHoursAt("TSLA", "NVDA", labor)).to.equal(
        "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be hours apart. " +
          "Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("TSLA", "NFLX", labor)).to.match(/^NFLX would start at Tuesday's 4:00 AM ET pre-market open but TSLA not until Tuesday's 9:30 AM ET opening bell,/);
      expect(mixedHoursAt("TSLA", "QQQ", labor)).to.equal(null);
    });

    /* The day after Thanksgiving the session closes at 1pm and after-hours at
     * 5pm, and the next session is Monday's. */
    it("knows an early close", () => {
      const nov = (day: number, hh: number, mm: number) => ny(2026, 11, day, hh, mm);
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 30))).to.equal(null);
      expect(pricedAt("TSLA", nov(27, 13, 0))).to.equal("waits");
      expect(firstPriceAt("TSLA", nov(27, 13, 30))).to.equal(nov(30, 9, 30));
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 13, 30))).to.match(/would be days apart/);
      expect(pricedAt("NFLX", nov(27, 16, 30))).to.equal("exchange");
      expect(mixedHoursAt("TSLA", "NFLX", nov(27, 16, 30))).to.match(/^TSLA waits for its exchange to open but NFLX trades now/);
      expect(firstPriceAt("NFLX", nov(27, 17, 30))).to.equal(nov(30, 4, 0));
      expect(mixedHoursAt("TSLA", "NFLX", nov(27, 17, 30))).to.match(/^NFLX would start at Monday's 4:00 AM ET/);
      // Thanksgiving itself: nothing on the exchange, the perp as ever.
      expect(pricedAt("NVDA", nov(26, 12, 0))).to.equal("perp");
      expect(firstPriceAt("VOO", nov(26, 12, 0))).to.equal(nov(27, 9, 30));
    });

    /* Clocks go back on 1 November 2026 and forward on 14 March 2027. The
     * openings stay at 9:30 and 4:00 in New York, so they move an hour in UTC,
     * and the words stay the same. */
    it("keeps the openings on New York's clock across daylight saving changes", () => {
      expect(firstPriceAt("TSLA", at("2026-10-31T16:00:00Z"))).to.equal(at("2026-11-02T14:30:00Z"));
      expect(firstPriceAt("NFLX", at("2026-10-31T16:00:00Z"))).to.equal(at("2026-11-02T09:00:00Z"));
      expect(firstPriceAt("TSLA", at("2026-10-29T21:00:00Z"))).to.equal(at("2026-10-30T13:30:00Z"));
      expect(firstPriceAt("TSLA", at("2027-03-13T16:00:00Z"))).to.equal(at("2027-03-15T13:30:00Z"));
      expect(firstPriceAt("NFLX", at("2027-03-13T16:00:00Z"))).to.equal(at("2027-03-15T08:00:00Z"));
      expect(mixedHoursAt("TSLA", "NFLX", at("2026-10-31T16:00:00Z"))).to.match(
        /^NFLX would start at Monday's 4:00 AM ET pre-market open but TSLA not until Monday's 9:30 AM ET opening bell,/,
      );
      // 9:29 and 9:31 New York on the Monday after the change, in session or not.
      expect(pricedAt("TSLA", at("2026-11-02T14:29:00Z"))).to.equal("waits");
      expect(pricedAt("TSLA", at("2026-11-02T14:31:00Z"))).to.equal("exchange");
    });
  });

  describe("refuses a round that would end where the two markets part", () => {
    const hour = { durationSecs: 3_600, endTs: 0 };

    it("refuses TSLA v NVDA for an hour from 3:30pm, and allows fifteen minutes", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), hour)).to.equal(
        "This round would end around Monday 4:30 PM ET, when NVDA still trades but TSLA waits for Tuesday's 9:30 AM ET opening bell, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), { durationSecs: 900, endTs: 0 })).to.equal(null);
    });

    it("says days when the weekend is in the gap", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 15, 30), hour)).to.match(
        /^This round would end around Friday 4:30 PM ET, when NVDA still trades but TSLA waits for Monday's 9:30 AM ET opening bell, so their end prices would be days apart\./,
      );
    });

    /* A timed round ends its length after the later start price, and a bar's
     * price comes up to a minute after the boundary. So a round whose end could
     * land on either side of the close within that minute is refused. */
    it("checks both ends of the minute a timed round can end in", () => {
      const five = { durationSecs: 300, endTs: 0 };
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 55), five)).to.not.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 54), five)).to.not.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 53, 59), five)).to.equal(null);
    });

    it("allows a bell, which always rings in session", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 10, 0), { durationSecs: 0, endTs: sep(14, 15, 59, 30) })).to.equal(null);
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 10, 0), { durationSecs: 0, endTs: sep(18, 15, 59, 30) })).to.equal(null);
    });

    it("allows two that stop together, and counts a round from a start that waited", () => {
      expect(mixedHoursAt("TSLA", "QQQ", sep(14, 15, 30), hour)).to.equal(null);
      // Taken on Saturday, TSLA v QQQ starts at Monday's bell and ends at 10:30.
      expect(mixedHoursAt("TSLA", "QQQ", SATURDAY, hour)).to.equal(null);
      // NFLX v JPM taken on Saturday: an hour from Monday's 4am, still in pre-market.
      expect(mixedHoursAt("NFLX", "JPM", SATURDAY, hour)).to.equal(null);
    });

    it("refuses a stock with neither perp nor pool against a perp past 8pm", () => {
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 30), hour)).to.equal(
        "This round would end around Monday 8:30 PM ET, when NVDA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
    });

    it("refuses a round that would end with both waiting, for different openings", () => {
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 15, 0), { durationSecs: 5 * 3_600, endTs: 0 })).to.equal(
        "This round would end around Monday 8:00 PM ET, when neither trades, and NFLX would take its end price at " +
          "Tuesday's 4:00 AM ET pre-market open but TSLA not until Tuesday's 9:30 AM ET opening bell, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
    });

    it("checks the start before the end", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 0), hour)).to.match(/start prices would be days apart/);
    });
  });

  /* THE PAGES AND THE CRANK CANNOT DRIFT APART.
   *
   * For real roster stocks of every kind and every boundary on a grid through
   * three stretches of calendar (Labor Day, the week of Thanksgiving with its
   * early close, and the end of daylight saving), firstPriceAt must be exactly
   * the moment the price clock prices that side from:
   *
   *   Pyth             ready at firstPriceAt + PYTH_GRACE_SECS
   *   a pool's window  ready at firstPriceAt + BAR_SETTLE_SECS
   *   a minute bar     ready at the end of the bar firstPriceAt falls in,
   *                    plus BAR_SETTLE_SECS
   *
   * and the clock must call the side shut exactly while firstPriceAt is after
   * both the boundary and now. pricedAt must call it a wait exactly when
   * firstPriceAt is not the boundary. */
  describe("agrees with the price clock", () => {
    const KINDS: Record<string, string[]> = {
      pyth: ["TSLA", "QQQ", "VOO"],
      perp: ["NVDA", "AAPL"],
      pool: ["SPY", "KO"],
      exchange: ["NFLX", "JPM"],
      abroad: ["BYDCO"],
    };
    // The other side prices at once and is never shut: a Pyth feed off the roster.
    const CRYPTO = "05".repeat(32);

    const duel = (ticker: string, boundary: number): ClockDuel => {
      const s = byTicker(ticker)!;
      return {
        creatorFeed: s.feed,
        creatorSource: s.source === "pyth" ? SOURCE_PYTH : SOURCE_SIGNED,
        opponentFeed: CRYPTO,
        opponentSource: SOURCE_PYTH,
        acceptedTs: boundary - START_DELAY_SECS,
        endTs: boundary + 3_600,
      };
    };

    const EDGES = [
      [3, 59, 59], [4, 0, 0], [9, 29, 59], [9, 30, 0], [12, 59, 59], [13, 0, 0],
      [15, 59, 59], [16, 0, 0], [16, 59, 59], [17, 0, 0], [19, 59, 59], [20, 0, 0],
    ];
    const grid: number[] = [];
    for (const [y, m, d0, days] of [
      [2026, 9, 4, 5],
      [2026, 11, 23, 8],
      [2026, 10, 30, 4],
    ]) {
      for (let i = 0; i < days; i++) {
        const midnight = ny(y, m, d0 + i, 0, 0);
        for (let t = midnight + 37; t < midnight + 86_400; t += 40 * 60) grid.push(t);
        for (const [hh, mm, ss] of EDGES) grid.push(ny(y, m, d0 + i, hh, mm, ss));
      }
    }

    for (const [kind, tickers] of Object.entries(KINDS)) {
      it(`${kind}: ${tickers.join(", ")}`, function () {
        this.timeout(60_000);
        for (const ticker of tickers) {
          for (const b of grid) {
            const where = `${ticker} at ${new Date(b * 1000).toISOString()}`;
            const first = firstPriceAt(ticker, b);
            expect(first, where).to.be.a("number");
            const f = first as number;
            expect(f, where).to.be.at.least(b);
            expect(pricedAt(ticker, b) === "waits", where).to.equal(f !== b);

            const d = duel(ticker, b);
            const ready = readyAt(d, "start", b + 20 * 86_400) as Ready;
            expect(ready, where).to.have.property("at");
            const expected =
              kind === "pyth"
                ? f + PYTH_GRACE_SECS
                : pricedAt(ticker, b) === "pool"
                  ? f + BAR_SETTLE_SECS
                  : firstBarEnd(f) + BAR_SETTLE_SECS;
            expect(ready.at, where).to.equal(expected);

            expect("shut" in readyAt(d, "start", b), `${where}, now`).to.equal(f > b);
            if (f > b) {
              expect("shut" in readyAt(d, "start", f - 1), `${where}, a second before`).to.equal(true);
              expect("shut" in readyAt(d, "start", f), `${where}, at its opening`).to.equal(false);
            }
          }
        }
      });
    }
  });
});
