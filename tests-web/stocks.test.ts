import { expect } from "chai";

import { SOURCE_PYTH, SOURCE_SIGNED, START_DELAY_SECS } from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import { firstBarEnd, PYTH_GRACE_SECS, readyAt, type ClockDuel, type Ready } from "../src/lib/priceClock";
import {
  apartIfTakenAt,
  byTicker,
  firstPriceAt,
  mixedHoursAt,
  nextFairTake,
  pricedAt,
  priceTimeAt,
  quoteSymbolFor,
  SAME_PRICE_SECS,
  TAKE_SLACK_SECS,
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

// The other side prices at once and is never shut: a Pyth feed off the roster.
const CRYPTO = "05".repeat(32);

/** A duel of a roster stock against CRYPTO, starting from `boundary`, for
 *  asking the price clock about that one stock. */
const oneSided = (ticker: string, boundary: number): ClockDuel => {
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
    /* Nasdaq is trading at both moments, so TSLA is not waiting for its
     * exchange: it is waiting for Pyth, and the sentence says that. */
    it("refuses TSLA v NVDA at 7pm on a Friday, and at 8am on a Monday, saying Pyth is what TSLA waits for", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 0))).to.equal(
        "TSLA is priced by Pyth, which does not print until Monday's 9:30 AM ET opening bell, but NVDA trades now, " +
          "so their start prices would be days apart. Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("NVDA", "TSLA", sep(14, 8, 0))).to.equal(
        "TSLA is priced by Pyth, which does not print until Monday's 9:30 AM ET opening bell, but NVDA trades now, " +
          "so their start prices would be hours apart. Pick two that both trade now, or two that both wait.",
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

    /* The tolerance is on the times the program records, not on boundaries.
     * Taken at 9:28:59, the start boundary is 9:29:01: NVDA's price is the
     * pre-market bar closing at 9:30:00 and TSLA's the 9:30:00 print, the same
     * moment. Taken at 9:27:57 the bar closes at 9:28:00, two minutes early. */
    it("counts two price times within a minute as starting together", () => {
      expect(SAME_PRICE_SECS).to.equal(60);
      expect(priceTimeAt("NVDA", sep(14, 9, 29, 1))).to.equal(sep(14, 9, 30));
      expect(priceTimeAt("TSLA", sep(14, 9, 29, 1))).to.equal(sep(14, 9, 30));
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 9, 29, 59))).to.equal(null);
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 9, 28, 59))).to.equal(null);
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 9, 27, 58))).to.equal(null);
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 9, 27, 57))).to.deep.include({ at: "start", early: "NVDA", secs: 120 });
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 9, 27, 58))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 9, 27, 57))).to.equal(
        "TSLA is priced by Pyth, which does not print until Monday's 9:30 AM ET opening bell, but NVDA trades now, " +
          "so their start prices would be minutes apart. Pick two that both trade now, or two that both wait.",
      );
    });

    /* A pool's price carries its boundary and a bar's the bar's end. Taken at
     * 3:59:00am, SPY's pool price is stamped 3:59:02 and NFLX's first bar
     * 4:01:00, which comparing the boundaries (3:59:02 against 4:00:00) called
     * a minute. At 3:59:58 the exchange prices both, from the same bar. */
    it("counts a pool's price against a bar's end, not against the opening", () => {
      expect(priceTimeAt("SPY", sep(3, 3, 59, 2))).to.equal(sep(3, 3, 59, 2));
      expect(priceTimeAt("NFLX", sep(3, 3, 59, 2))).to.equal(sep(3, 4, 1));
      expect(apartIfTakenAt("SPY", "NFLX", sep(3, 3, 59, 0))).to.deep.include({ early: "SPY", late: "NFLX", secs: 118 });
      expect(apartIfTakenAt("SPY", "NFLX", sep(3, 3, 59, 57))).to.deep.include({ secs: 61 });
      expect(apartIfTakenAt("SPY", "NFLX", sep(3, 3, 59, 58))).to.equal(null);
    });

    /* NFLX has neither perp nor pool, so at 3:59:30am it does not trade yet:
     * both wait, for different openings. */
    it("says a side trades now only when it prices at the start itself", () => {
      expect(mixedHoursAt("NFLX", "TSLA", sep(14, 3, 59, 30))).to.equal(
        "NFLX would start at Monday's 4:00 AM ET pre-market open but TSLA not until Monday's 9:30 AM ET opening bell, " +
          "so their start prices would be hours apart. Pick two that open at the same time, or two that both trade now.",
      );
    });

    /* BYDCO trades in Hong Kong, whose hours nothing here models. It is still
     * never called a wait, so these pairs are refused as before, but nobody is
     * told that BYDCO trades now when Hong Kong is shut. */
    it("never says a listing abroad trades now", () => {
      expect(mixedHoursAt("BYDCO", "TSLA", sep(14, 8, 0))).to.equal(
        "TSLA is priced by Pyth, which does not print until Monday's 9:30 AM ET opening bell, but BYDCO is priced on " +
          "its own exchange's hours, so the two would not start together. Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("BYDCO", "TSLA", sep(14, 15, 30), { durationSecs: 3_600, endTs: 0 })).to.equal(
        "This round would end around Monday 4:31 PM ET, when TSLA waits for Tuesday's 9:30 AM ET opening bell but BYDCO " +
          "is priced on its own exchange's hours, so the two would not end together. " +
          "Pick a round that ends while both trade, or two that trade the same hours.",
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
      expect(mixedHoursAt("TSLA", "NFLX", nov(27, 16, 30))).to.match(
        /^TSLA is priced by Pyth, which does not print until Monday's 9:30 AM ET opening bell, but NFLX trades now/,
      );
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

    /* Taken at 3:30:00, NVDA's start price is the bar closing at 3:31:00, so
     * the program ends the hour at 4:31:00. */
    it("refuses TSLA v NVDA for an hour from 3:30pm, and allows fifteen minutes", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), hour)).to.equal(
        "This round would end around Monday 4:31 PM ET, when NVDA still trades but TSLA waits for Tuesday's 9:30 AM ET opening bell, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), { durationSecs: 900, endTs: 0 })).to.equal(null);
    });

    it("says days when the weekend is in the gap", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 15, 30), hour)).to.match(
        /^This round would end around Friday 4:31 PM ET, when NVDA still trades but TSLA waits for Monday's 9:30 AM ET opening bell, so their end prices would be days apart\./,
      );
    });

    /* The program ends a timed round its length after the later start price,
     * and a bar's start price is the end of the bar the boundary falls in.
     * Accepted at 3:53:58, the boundary is 3:54:00, NVDA's bar ends 3:55:00
     * and the round at 4:00:00, after TSLA's last print. At 3:53:57 the
     * boundary is 3:53:59 and the round ends 3:59:00, where NVDA's end bar
     * closes at 4:00:00, a minute after TSLA's print. */
    it("ends a timed round where the program does, from the later side's start price", () => {
      const five = { durationSecs: 300, endTs: 0 };
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 15, 53, 57), five)).to.equal(null);
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 15, 53, 58), five)).to.deep.include({ at: "end", boundary: sep(14, 16, 0) });
      expect(apartIfTakenAt("TSLA", "NVDA", sep(14, 15, 53, 59), five)).to.deep.include({ at: "end", boundary: sep(14, 16, 0) });
      // And the take can land up to TAKE_SLACK_SECS after it was checked.
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 53, 58) - TAKE_SLACK_SECS - 1, five)).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 53, 58) - TAKE_SLACK_SECS, five)).to.match(
        /^This round would end around Monday 4:00 PM ET, when NVDA still trades but TSLA waits for Tuesday's 9:30 AM ET opening bell/,
      );
      // An hour taken at 2:58:58 ends at 4:00:00 too; at 8pm, NFLX's close.
      expect(apartIfTakenAt("TSLA", "NVDA", sep(21, 14, 58, 58), hour)).to.deep.include({ at: "end" });
      expect(apartIfTakenAt("NFLX", "NVDA", sep(18, 19, 53, 58), five)).to.deep.include({ at: "end", late: "NFLX" });
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
        "This round would end around Monday 8:31 PM ET, when NVDA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
    });

    it("refuses a round that would end with both waiting, for different openings", () => {
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 15, 0), { durationSecs: 5 * 3_600, endTs: 0 })).to.equal(
        "This round would end around Monday 8:01 PM ET, when neither trades, and NFLX would take its end price at " +
          "Tuesday's 4:00 AM ET pre-market open but TSLA not until Tuesday's 9:30 AM ET opening bell, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
    });

    it("checks the start before the end", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 0), hour)).to.match(/start prices would be days apart/);
    });
  });

  /* A TAKE STARTS WHEN IT LANDS, NOT WHEN IT WAS CHECKED.
   *
   * The program's start boundary is accepted_ts + START_DELAY_SECS, and the
   * accept lands after the check by up to TAKE_SLACK_SECS. A bell's end is
   * fixed, so nothing at the end catches a take in the last seconds of a
   * session: it has to be refused at the start. */
  describe("refuses a take that could land after a close", () => {
    const bell = (day: number) => ({ durationSecs: 0, endTs: sep(day, 15, 59, 30), expiresTs: sep(day, 15, 54, 30) });

    it("refuses a Friday-bell TSLA v NVDA taken at 3:59:58pm, and at 3:59:00pm", () => {
      expect(START_DELAY_SECS).to.equal(2);
      expect(TAKE_SLACK_SECS).to.equal(90);
      // Taken at 3:59:58 the boundary is 4:00:00: TSLA's next print is Tuesday's.
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 59, 58), bell(18))).to.equal(
        "TSLA stops pricing at 4:00 PM ET, and a take now could land after that. NVDA would then start at once but TSLA " +
          "not until Tuesday's 9:30 AM ET opening bell, so their start prices would be hours apart. Pick two that trade the same hours.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 59, 0), bell(18))).to.match(/^TSLA stops pricing at 4:00 PM ET, and a take now could land after that\./);
      // The last take that cannot start at 4:00:00 is sent 90 seconds before 3:59:58.
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 58, 27), bell(18))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 58, 28), bell(18))).to.not.equal(null);
    });

    it("refuses NFLX v NVDA at 7:59:58pm, on the Friday before Labor Day, and before an early close", () => {
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 59, 58), bell(18))).to.match(
        /^NFLX stops pricing at 8:00 PM ET, and a take now could land after that\. NVDA would then start at once but NFLX not until Tuesday's 4:00 AM ET pre-market open/,
      );
      expect(mixedHoursAt("NFLX", "MSFT", sep(4, 19, 59, 59), bell(8))).to.match(/not until Tuesday's 4:00 AM ET pre-market open, so their start prices would be days apart/);
      const nov = (day: number, hh: number, mm: number, ss = 0) => ny(2026, 11, day, hh, mm, ss);
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 59, 58), { durationSecs: 0, endTs: nov(30, 15, 59, 30) })).to.match(
        /^TSLA stops pricing at 1:00 PM ET, .* not until Monday's 9:30 AM ET opening bell, so their start prices would be days apart/,
      );
    });

    /* Somebody taking a challenge cannot change its stocks or its round, so
     * they are told when they can take it instead. */
    it("tells a taker when the challenge can be taken, or that it cannot", () => {
      const week = { durationSecs: 3_600, endTs: 0, expiresTs: sep(21, 15, 30) };
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), week, "taker")).to.equal(
        "This round would end around Monday 4:31 PM ET, when NVDA still trades but TSLA waits for Tuesday's 9:30 AM ET opening bell, " +
          "so their end prices would be hours apart. You can take it from Tuesday's 9:30 AM ET opening bell.",
      );
      expect(mixedHoursAt("NFLX", "NVDA", SATURDAY, week, "taker")).to.match(/ You can take it from Monday's 4:00 AM ET pre-market open\.$/);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 59, 58), bell(14), "taker")).to.match(/ It closes before the two line up again\.$/);
    });

    /* A bell challenge set up in the pre-market, to be taken in the session. */
    it("finds the first opening a challenge can be taken from, before it closes", () => {
      expect(nextFairTake("TSLA", "NVDA", sep(14, 8, 0), bell(14))).to.equal(sep(14, 9, 30));
      expect(nextFairTake("TSLA", "NVDA", sep(11, 19, 0), bell(18))).to.equal(sep(14, 9, 30));
      expect(nextFairTake("NFLX", "NVDA", SATURDAY, bell(18))).to.equal(sep(14, 4, 0));
      expect(nextFairTake("TSLA", "NFLX", sep(4, 21, 0), bell(11))).to.equal(sep(8, 9, 30)); // past Labor Day
      expect(nextFairTake("TSLA", "NVDA", sep(14, 15, 59), { ...bell(14), expiresTs: sep(15, 9, 0) })).to.equal(null);
    });

    /* A round of 6 hours 28 minutes taken at 9:30:00 ends at 3:59:00, but
     * one landing a minute later ends at 4:00:00, after TSLA's last print. The
     * opening is only offered when a take sent then is fair wherever it lands. */
    it("never offers a moment at which the take would still be refused", () => {
      for (const durationSecs of [300, 3_600, 23_280, 23_340]) {
        for (const from of [SATURDAY, sep(14, 8, 0), sep(14, 15, 0), sep(14, 21, 0)]) {
          const round = { durationSecs, endTs: 0, expiresTs: from + 3 * 86_400 };
          const t = nextFairTake("TSLA", "NVDA", from, round);
          if (t !== null) expect(mixedHoursAt("TSLA", "NVDA", t, round), `${durationSecs}s from ${from}`).to.equal(null);
        }
      }
      expect(nextFairTake("TSLA", "NVDA", sep(14, 8, 0), { durationSecs: 23_280, endTs: 0, expiresTs: sep(16, 8, 0) })).to.equal(null);
    });
  });

  /* THE ONE GAP NOTHING HERE CAN SEE.
   *
   * A pool-only stock is priced at the boundary off-hours, by a trimmed mean
   * of its pool's hour. When that hour had fewer than OFFHOURS_MIN_BARS
   * trades, oracle.ts's quoteAt falls back to the exchange, and a Saturday
   * boundary is priced at Monday's 4:01am bar. Which hours are thin is only
   * known once they have passed, so the pages and the price clock both assume
   * the pool traded, and a pool-only stock against a perp on a Saturday is
   * allowed. This pins that assumption, so changing it is a decision. */
  it("assumes a pool-only stock's pool traded in the hour before its boundary", () => {
    expect(pricedAt("KO", SATURDAY)).to.equal("pool");
    expect(priceTimeAt("KO", SATURDAY)).to.equal(SATURDAY);
    expect(mixedHoursAt("KO", "NVDA", SATURDAY)).to.equal(null);
  });

  /* THE WHOLE TAKE WINDOW, SECOND BY SECOND, AGAINST THE PRICE CLOCK.
   *
   * For accept times a second apart around every opening and close on three
   * days of calendar, and for a bell, five minutes and an hour, this
   * plays the program's sums with publish times taken from priceClock's
   * readyAt (less its grace), not from priceTimeAt:
   *
   *   apartIfTakenAt must be null exactly when both the start and the settle
   *   prices land within SAME_PRICE_SECS, and
   *
   *   whenever mixedHoursAt lets a take through, every accept time in the
   *   TAKE_SLACK_SECS after it must be fair too. */
  describe("agrees with the program's sums, for every accept time near a session edge", () => {
    const published = new Map<string, number>();
    const publishAt = (ticker: string, boundary: number) => {
      const key = `${ticker}:${boundary}`;
      if (!published.has(key)) {
        const s = byTicker(ticker)!;
        const ready = readyAt(oneSided(ticker, boundary), "start", boundary + 20 * 86_400) as Ready;
        published.set(key, ready.at - (s.source === "pyth" ? PYTH_GRACE_SECS : BAR_SETTLE_SECS));
      }
      return published.get(key)!;
    };
    type Round = { durationSecs: number; endTs: number };
    const fairOnChain = (a: string, b: string, acceptedTs: number, round: Round) => {
      const start = acceptedTs + START_DELAY_SECS;
      const [pa, pb] = [publishAt(a, start), publishAt(b, start)];
      if (Math.abs(pa - pb) > SAME_PRICE_SECS) return false;
      const end = round.durationSecs ? Math.max(pa, pb) + round.durationSecs : round.endTs;
      return Math.abs(publishAt(a, end) - publishAt(b, end)) <= SAME_PRICE_SECS;
    };

    const PAIRS = [
      ["TSLA", "NVDA"],
      ["TSLA", "NFLX"],
      ["NFLX", "NVDA"],
      ["SPY", "NFLX"],
      ["TSLA", "QQQ"],
    ];
    /* Seconds before an edge (less the round, for its end) that a take is
     * sent at: where the window's far end crosses it, where a bar's end
     * crosses it, and where the boundary itself does. */
    const SENT = [...Array(111).keys()].map((i) => i - 100).filter((s) => s <= -80 || (s >= -70 && s <= -50) || s >= -10);
    // A normal Monday, the Friday before Labor Day, and the early close.
    const DAYS: { y: number; m: number; d: number; close: number; late: number; bell: number }[] = [
      { y: 2026, m: 9, d: 14, close: 16, late: 20, bell: sep(18, 15, 59, 30) },
      { y: 2026, m: 9, d: 4, close: 16, late: 20, bell: sep(11, 15, 59, 30) },
      { y: 2026, m: 11, d: 27, close: 13, late: 17, bell: ny(2026, 12, 4, 15, 59, 30) },
    ];

    for (const [a, b] of PAIRS) {
      it(`${a} v ${b}`, function () {
        this.timeout(120_000);
        for (const day of DAYS) {
          const edges = [ny(day.y, day.m, day.d, 4, 0), ny(day.y, day.m, day.d, 9, 30), ny(day.y, day.m, day.d, day.close, 0), ny(day.y, day.m, day.d, day.late, 0)];
          const rounds: Round[] = [
            { durationSecs: 0, endTs: day.bell },
            { durationSecs: 300, endTs: 0 },
            { durationSecs: 3_600, endTs: 0 },
          ];
          for (const round of rounds) {
            const fair = new Map<number, boolean>();
            const fairAt = (t: number) => {
              if (!fair.has(t)) fair.set(t, fairOnChain(a, b, t, round));
              return fair.get(t)!;
            };
            for (const edge of edges) {
              for (const shift of round.durationSecs ? [0, round.durationSecs] : [0]) {
                for (const sent of SENT.map((s) => edge - shift + s)) {
                  const where = `${a} v ${b}, ${round.durationSecs || "bell"}, sent ${new Date(sent * 1000).toISOString()}`;
                  expect(apartIfTakenAt(a, b, sent, round) === null, where).to.equal(fairAt(sent));
                  if (mixedHoursAt(a, b, sent, round) === null) {
                    for (let t = sent; t <= sent + TAKE_SLACK_SECS; t++) expect(fairAt(t), `${where}, lands ${t - sent}s later`).to.equal(true);
                  }
                }
              }
            }
          }
        }
      });
    }
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
   * firstPriceAt is not the boundary, and priceTimeAt must be the moment the
   * clock is ready at, less its grace. */
  describe("agrees with the price clock", () => {
    const KINDS: Record<string, string[]> = {
      pyth: ["TSLA", "QQQ", "VOO"],
      perp: ["NVDA", "AAPL"],
      pool: ["SPY", "KO"],
      exchange: ["NFLX", "JPM"],
      abroad: ["BYDCO"],
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

            const d = oneSided(ticker, b);
            const ready = readyAt(d, "start", b + 20 * 86_400) as Ready;
            expect(ready, where).to.have.property("at");
            const expected =
              kind === "pyth"
                ? f + PYTH_GRACE_SECS
                : pricedAt(ticker, b) === "pool"
                  ? f + BAR_SETTLE_SECS
                  : firstBarEnd(f) + BAR_SETTLE_SECS;
            expect(ready.at, where).to.equal(expected);
            // And the time the price will carry is the clock's, less its grace.
            expect(priceTimeAt(ticker, b), `${where}, price time`).to.equal(
              ready.at - (kind === "pyth" ? PYTH_GRACE_SECS : BAR_SETTLE_SECS),
            );

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
