import { expect } from "chai";

import { COMPOSITE_FROM, compositePublishTime } from "../src/lib/composite";
import { SOURCE_PYTH, SOURCE_SIGNED, STALL_REFUND_SECS, START_DELAY_SECS } from "../src/lib/duel";
import { isTradingDay, nyParts, nyToMs } from "../src/lib/market";
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
const nov = (day: number, hh: number, mm: number, ss = 0) => ny(2026, 11, day, hh, mm, ss);

const SATURDAY = at("2026-09-12T18:00:00Z"); // 2 PM ET
const FRIDAY_OPEN = at("2026-09-11T18:00:00Z"); // 2 PM ET

// The other side prices at once and is never shut: a Pyth feed off the roster.
const CRYPTO = "05".repeat(32);

/** A duel of a roster stock against CRYPTO, starting from `boundary`, for
 *  asking the price clock about that one stock; `source` is what the duel
 *  recorded for it, the roster's by default. */
const oneSided = (ticker: string, boundary: number, source?: "pyth" | "signed"): ClockDuel => {
  const s = byTicker(ticker)!;
  return {
    creatorFeed: s.feed,
    creatorSource: (source ?? s.source) === "pyth" ? SOURCE_PYTH : SOURCE_SIGNED,
    opponentFeed: CRYPTO,
    opponentSource: SOURCE_PYTH,
    acceptedTs: boundary - START_DELAY_SECS,
    endTs: boundary + 3_600,
  };
};

/* The sentence for a Pyth side whose start would land in Pyth's dark hours. */
const darkStart = (names: string, from: string, until: string, back: string, stocks = "a stock") =>
  `Pyth does not publish ${names} from ${from} to ${until} ET, and a fight whose start lands then, or within a minute of it, ` +
  `can never be priced. Pick ${stocks} Pyth does not price, or come back from ${back}.`;
const WEEKEND = ["Friday 8:00 PM", "Sunday 8:00 PM"] as const;

describe("fights across trading hours", () => {
  it("starts from two stocks that trade around the clock", () => {
    // The page's default pair and the faucet's starter set.
    for (const t of ["AAPL", "NVDA", "MSFT", "GOOGL"]) {
      expect(tradesAroundTheClock(t), t).to.equal(true);
      expect(pricedAt(t, SATURDAY), t).to.not.equal("waits");
    }
  });

  it("refuses a pair with exactly one side waiting for its exchange", () => {
    expect(pricedAt("NFLX", SATURDAY)).to.equal("waits");
    const said =
      "NFLX waits for its exchange to open but NVDA trades now, so their start prices would be days apart. " +
      "Pick two that both trade now, or two that both wait.";
    expect(mixedHoursAt("NFLX", "NVDA", SATURDAY)).to.equal(said);
    expect(mixedHoursAt("NVDA", "NFLX", SATURDAY)).to.equal(said);
  });

  it("allows two that both trade, two that both wait, and any pair in session", () => {
    expect(mixedHoursAt("AAPL", "NVDA", SATURDAY)).to.equal(null);
    expect(mixedHoursAt("NFLX", "JPM", SATURDAY)).to.equal(null);
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

  /* PYTH PRINTS FIVE DAYS A WEEK (market.ts, pythSpanAt).
   *
   * From 8 PM New York the evening before each trading day to 8 PM on it, so
   * Sunday 8 PM to Friday 8 PM with holidays out, and a boundary less than a
   * minute into a span is never priced. Its perp and the exchange's bars have
   * nothing to do with it. */
  describe("a Pyth stock prices while Pyth prints, and never in its dark hours", () => {
    it("prices pre-market, in session, after-hours and on a weekday night, whatever its perp does", () => {
      for (const t of [sep(14, 8, 0), sep(14, 9, 29, 59), sep(14, 9, 30), sep(14, 15, 59, 59), sep(14, 16, 0), sep(11, 19, 0), sep(14, 22, 0), sep(10, 3, 59, 59)]) {
        expect(pricedAt("TSLA", t), new Date(t * 1000).toISOString()).to.equal("pyth");
        expect(firstPriceAt("TSLA", t)).to.equal(t);
        expect(priceTimeAt("TSLA", t)).to.equal(t);
      }
    });

    it("never prices from Friday 8 PM until a minute after Sunday 8 PM", () => {
      expect(pricedAt("TSLA", sep(11, 19, 59, 59))).to.equal("pyth");
      for (const t of [sep(11, 20, 0), SATURDAY, sep(13, 19, 59, 59), sep(13, 20, 0), sep(13, 20, 0, 30), sep(13, 20, 0, 59)]) {
        expect(pricedAt("TSLA", t), new Date(t * 1000).toISOString()).to.equal("never");
        expect(firstPriceAt("TSLA", t)).to.equal(null);
        expect(priceTimeAt("TSLA", t)).to.equal(null);
      }
      expect(pricedAt("TSLA", sep(13, 20, 1))).to.equal("pyth");
      // Its perp would price it all weekend; Pyth is what prices it.
      expect(pricedAt("NVDA", SATURDAY)).to.equal("perp");
    });

    it("leaves a signed stock on its exchange's bars from 4am to 8pm", () => {
      expect(pricedAt("NVDA", sep(14, 8, 0))).to.equal("exchange");
      expect(pricedAt("NVDA", sep(11, 19, 0))).to.equal("exchange");
      expect(pricedAt("NVDA", sep(14, 22, 0))).to.equal("perp");
      expect(pricedAt("SPY", SATURDAY)).to.equal("pool");
      expect(pricedAt("NFLX", sep(11, 19, 0))).to.equal("exchange");
      expect(pricedAt("NFLX", SATURDAY)).to.equal("waits");
      // BYDCO trades in Hong Kong, shut on a Saturday; Monday 9:29 PM ET is Tuesday 9:29 AM there, before HKEX opens.
      expect(pricedAt("BYDCO", SATURDAY)).to.equal("waits");
      expect(pricedAt("BYDCO", sep(14, 21, 29))).to.equal("waits");
      expect(pricedAt("BYDCO", sep(14, 21, 30))).to.equal("exchange");
    });

    it("dates each side's first price to the opening it waits for, and a Pyth side to none", () => {
      expect(firstPriceAt("TSLA", sep(11, 19, 0))).to.equal(sep(11, 19, 0));
      expect(firstPriceAt("TSLA", sep(14, 8, 0))).to.equal(sep(14, 8, 0));
      expect(firstPriceAt("TSLA", SATURDAY)).to.equal(null);
      expect(firstPriceAt("NFLX", SATURDAY)).to.equal(sep(14, 4, 0));
      expect(firstPriceAt("NFLX", sep(11, 19, 0))).to.equal(sep(11, 19, 0));
      expect(firstPriceAt("NVDA", SATURDAY)).to.equal(SATURDAY);
      // Monday 9:30 AM in Hong Kong is Sunday 9:30 PM in New York.
      expect(firstPriceAt("BYDCO", SATURDAY)).to.equal(sep(13, 21, 30));
      expect(firstPriceAt("?", SATURDAY)).to.equal(null);
    });
  });

  /* A FIGHT WHOSE PYTH SIDE CAN NEVER BE PRICED IS REFUSED, WHATEVER THE OTHER SIDE.
   *
   * The plan's cases (docs/247-pricing.md, Step 1), for the boundary a take
   * lands on: accepted_ts + START_DELAY_SECS, anywhere in the TAKE_SLACK_SECS
   * after the take is sent. A boundary is refused within PYTH_EDGE_SECS of
   * either end of a gap, and in it. */
  describe("refuses a fight whose Pyth side would land where Pyth is dark", () => {
    const week = sep(18, 15, 59, 30);
    const bell = { durationSecs: 0, endTs: week, expiresTs: sep(18, 15, 54, 30) };

    it("allows a TSLA boundary at Fri 7:58:59 PM, and refuses one at 7:59:30 PM and on Saturday", () => {
      // Sent at 7:57:27, the latest landing starts at 7:58:59; sent at 7:57:28, at 7:59:00, the last allowed second.
      expect(sep(11, 19, 57, 27) + TAKE_SLACK_SECS + START_DELAY_SECS).to.equal(sep(11, 19, 58, 59));
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 57, 27), bell)).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 57, 28), bell)).to.equal(null);
      const refused = darkStart("TSLA", ...WEEKEND, "Sunday's 8:01 PM ET");
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 57, 29), bell)).to.equal(refused);
      // A take that lands at once, with its boundary at 7:59:30.
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 59, 28), bell)).to.equal(refused);
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY)).to.equal(refused);
      expect(mixedHoursAt("NVDA", "TSLA", SATURDAY)).to.equal(refused);
    });

    it("refuses a boundary at Sun 8:00:30 PM and allows one at 8:01:00 PM", () => {
      const refused = darkStart("TSLA", ...WEEKEND, "Sunday's 8:01 PM ET");
      expect(mixedHoursAt("TSLA", "NVDA", sep(13, 20, 0, 28), bell)).to.equal(refused);
      expect(mixedHoursAt("TSLA", "NVDA", sep(13, 20, 0, 57), bell)).to.equal(refused);
      expect(mixedHoursAt("TSLA", "NVDA", sep(13, 20, 0, 58), bell)).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(13, 20, 0, 58))).to.equal(null);
    });

    it("allows a boundary at Thu 3:59:59 AM, in the middle of a weekday night", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(10, 3, 59, 57), bell)).to.equal(null);
      expect(mixedHoursAt("TSLA", "QQQ", sep(10, 3, 59, 57), { durationSecs: 900, endTs: 0 })).to.equal(null);
      expect(mixedHoursAt("VOO", "TSLA", sep(9, 19, 59, 58), { durationSecs: 3_600, endTs: 0 })).to.equal(null);
    });

    it("refuses Sun 6 Sep 9 PM, before Labor Day, and allows Mon 7 Sep 8:01 PM", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(6, 20, 59, 58))).to.equal(
        darkStart("TSLA", "Friday 8:00 PM", "Monday 8:00 PM", "Monday's 8:01 PM ET"),
      );
      expect(mixedHoursAt("TSLA", "NVDA", sep(7, 10, 0))).to.match(/^Pyth does not publish TSLA from Friday 8:00 PM to Monday 8:00 PM ET/);
      expect(mixedHoursAt("TSLA", "NVDA", sep(7, 20, 0, 58))).to.equal(null);
    });

    it("refuses two Pyth stocks in the same gap, which used to be allowed as waiting together", () => {
      expect(mixedHoursAt("TSLA", "QQQ", SATURDAY)).to.equal(darkStart("TSLA or QQQ", ...WEEKEND, "Sunday's 8:01 PM ET", "stocks"));
      expect(mixedHoursAt("VOO", "VOO", SATURDAY)).to.equal(darkStart("VOO", ...WEEKEND, "Sunday's 8:01 PM ET"));
    });

    it("refuses a round whose end would land in the dark, and allows one that ends before", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 30), { durationSecs: 3_600, endTs: 0 })).to.equal(
        "This round would end around Friday 8:31 PM ET, but Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET, " +
          "and an end that lands then, or within a minute of it, can never be priced. " +
          "Pick a round that ends while Pyth publishes, or a stock Pyth does not price.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 30), { durationSecs: 900, endTs: 0 })).to.equal(null);
      expect(mixedHoursAt("TSLA", "QQQ", sep(11, 15, 0), { durationSecs: 5 * 3_600, endTs: 0 })).to.equal(
        "This round would end around Friday 8:00 PM ET, but Pyth does not publish TSLA or QQQ from Friday 8:00 PM to Sunday 8:00 PM ET, " +
          "and an end that lands then, or within a minute of it, can never be priced. " +
          "Pick a round that ends while Pyth publishes, or stocks Pyth does not price.",
      );
      // A fixed end on Saturday, taken on Friday afternoon.
      expect(mixedHoursAt("VOO", "NVDA", sep(11, 14, 0), { durationSecs: 0, endTs: SATURDAY })).to.equal(
        "This round would end at Saturday 2:00 PM ET, but Pyth does not publish VOO from Friday 8:00 PM to Sunday 8:00 PM ET, " +
          "and an end that lands then, or within a minute of it, can never be priced. " +
          "Pick a round that ends while Pyth publishes, or a stock Pyth does not price.",
      );
    });

    /* Five minutes from 7:52:28pm: the far end of the take window starts at
     * 7:54:00, NVDA's start bar closes at 7:55:00, and the round ends at
     * 8:00:00. A take sent a second earlier ends at 7:59:00 at the latest. */
    it("ends a timed round where the program does, from the later side's start price, across the take window", () => {
      const five = { durationSecs: 300, endTs: 0 };
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 52, 27), five)).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 52, 28), five)).to.match(
        /^This round would end around Friday 8:00 PM ET, but Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET/,
      );
    });

    it("knows the half day after Thanksgiving: Pyth is taken to stop at 1 PM", () => {
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 30))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 57, 28))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 57, 29))).to.equal(
        darkStart("TSLA", "Friday 1:00 PM", "Sunday 8:00 PM", "Sunday's 8:01 PM ET"),
      );
      expect(pricedAt("TSLA", nov(27, 13, 0))).to.equal("never");
      expect(firstPriceAt("TSLA", nov(27, 13, 30))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NFLX", nov(27, 16, 30))).to.match(/^Pyth does not publish TSLA from Friday 1:00 PM to Sunday 8:00 PM ET/);
      // Thanksgiving itself is dark from Wednesday 8 PM, and Friday's span starts Thursday 8 PM.
      expect(firstPriceAt("VOO", nov(26, 12, 0))).to.equal(null);
      expect(mixedHoursAt("VOO", "NVDA", nov(26, 12, 0))).to.equal(
        darkStart("VOO", "Wednesday 8:00 PM", "Thursday 8:00 PM", "Thursday's 8:01 PM ET"),
      );
      expect(pricedAt("VOO", nov(26, 21, 0))).to.equal("pyth");
      // After COMPOSITE_FROM, NVDA is pinned in venues247.json: the composite prices its shut hours.
      expect(pricedAt("NVDA", nov(26, 12, 0))).to.equal("composite");
    });

    it("keeps Pyth's 8 PM on New York's clock across daylight saving changes", () => {
      // Clocks go back on Sunday 1 November 2026: 8 PM that night is 01:00 UTC.
      expect(firstPriceAt("TSLA", at("2026-11-02T01:00:30Z"))).to.equal(null);
      expect(firstPriceAt("TSLA", at("2026-11-02T01:01:00Z"))).to.equal(at("2026-11-02T01:01:00Z"));
      expect(firstPriceAt("TSLA", at("2026-10-31T00:00:00Z"))).to.equal(null); // Friday 30 Oct, 8 PM EDT
      expect(firstPriceAt("TSLA", at("2026-10-30T23:59:59Z"))).to.equal(at("2026-10-30T23:59:59Z"));
      // And forward on Sunday 14 March 2027: 8 PM is 00:00 UTC again.
      expect(firstPriceAt("TSLA", at("2027-03-15T00:00:30Z"))).to.equal(null);
      expect(firstPriceAt("TSLA", at("2027-03-15T00:01:00Z"))).to.equal(at("2027-03-15T00:01:00Z"));
      expect(mixedHoursAt("TSLA", "NVDA", at("2027-03-13T16:00:00Z"))).to.equal(darkStart("TSLA", ...WEEKEND, "Sunday's 8:01 PM ET"));
    });
  });

  describe("refuses a start the gap between two markets would decide", () => {
    /* The bug this began with: at 7pm on a Friday TSLA v NVDA could be taken,
     * with TSLA's start at Monday's opening bell. Pyth prints at 7pm, so both
     * start then; a stock with neither perp nor pool is the one that waits. */
    it("allows TSLA v NVDA at 7pm on a Friday and 8am on a Monday, when Pyth prints", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(11, 19, 0))).to.equal(null);
      expect(mixedHoursAt("NVDA", "TSLA", sep(14, 8, 0))).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 10, 0))).to.equal(null);
    });

    it("refuses a stock that waits for its exchange against a Pyth stock or a perp on a weekday night", () => {
      const said =
        "NFLX waits for its exchange to open but TSLA trades now, so their start prices would be hours apart. " +
        "Pick two that both trade now, or two that both wait.";
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 21, 0))).to.equal(said);
      expect(mixedHoursAt("NFLX", "TSLA", sep(14, 21, 0))).to.equal(said);
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 21, 0))).to.equal(said.replace("TSLA", "NVDA"));
    });

    it("allows two Pyth stocks together whenever Pyth prints", () => {
      expect(mixedHoursAt("TSLA", "QQQ", sep(11, 19, 0))).to.equal(null);
      expect(mixedHoursAt("VOO", "TSLA", sep(14, 8, 0))).to.equal(null);
      expect(mixedHoursAt("TSLA", "QQQ", sep(14, 22, 0), { durationSecs: 3_600, endTs: 0 })).to.equal(null);
    });

    it("allows two stocks with neither perp nor pool on a Saturday, and two Hong Kong stocks", () => {
      expect(mixedHoursAt("NFLX", "JPM", SATURDAY)).to.equal(null);
      expect(mixedHoursAt("BYDCO", "AIAGR", SATURDAY)).to.equal(null);
    });

    /* The bug the adversarial study found by reading this code: every non-US
     * boundary was called priced at once, so a Hong Kong stock taken against a
     * US one while HKEX was shut started its side at the next Hong Kong
     * session. Now it waits for HKEX, and the take is refused. */
    it("refuses a Hong Kong stock against a US stock while HKEX is shut", () => {
      expect(mixedHoursAt("BYDCO", "NVDA", SATURDAY)).to.equal(
        "BYDCO waits for its exchange to open but NVDA trades now, so their start prices would be days apart. Pick two that both trade now, or two that both wait.",
      );
      // Monday 10 AM New York is 10 PM in Hong Kong.
      expect(mixedHoursAt("NVDA", "BYDCO", sep(14, 10, 0))).to.equal(
        "BYDCO waits for its exchange to open but NVDA trades now, so their start prices would be hours apart. Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("BYDCO", "NVDA", sep(14, 10, 0), { durationSecs: 900, endTs: 0, expiresTs: sep(16, 12, 0) }, "taker")).to.match(
        / You can take it from Monday's 9:30 PM ET\.$/,
      );
    });

    /* The tolerance is on the times the program records, not on boundaries.
     * A Pyth print carries its boundary and a bar the end of the minute the
     * boundary falls in, never more than a minute apart, so a Pyth stock and a
     * bar-priced one that both price start together. Across the 4am opening:
     * taken at 3:58:58, NVDA's perp bar closes at 4:00:00 and NFLX's first bar
     * at 4:01:00; taken at 3:58:57, NVDA's closes at 3:59:00, two minutes early. */
    it("counts two price times within a minute as starting together", () => {
      expect(SAME_PRICE_SECS).to.equal(60);
      expect(priceTimeAt("NVDA", sep(14, 9, 29, 1))).to.equal(sep(14, 9, 30));
      expect(priceTimeAt("TSLA", sep(14, 9, 29, 1))).to.equal(sep(14, 9, 29, 1));
      for (const t of [sep(14, 9, 27, 57), sep(14, 9, 27, 58), sep(14, 21, 59, 58), sep(11, 19, 11, 35)]) {
        expect(apartIfTakenAt("TSLA", "NVDA", t), new Date(t * 1000).toISOString()).to.equal(null);
      }
      expect(apartIfTakenAt("NFLX", "NVDA", sep(14, 3, 58, 58))).to.equal(null);
      expect(apartIfTakenAt("NFLX", "NVDA", sep(14, 3, 58, 57))).to.deep.include({ at: "start", early: "NVDA", late: "NFLX", secs: 120 });
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 3, 58, 58))).to.equal(null);
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 3, 58, 57))).to.equal(
        "NFLX waits for its exchange to open but NVDA trades now, so their start prices would be minutes apart. " +
          "Pick two that both trade now, or two that both wait.",
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

    /* BYDCO trades in Hong Kong: in session from 9:30 PM New York in
     * September, shut at 7:30 PM. */
    it("says a Hong Kong stock trades now only in HKEX's session", () => {
      expect(mixedHoursAt("BYDCO", "NFLX", sep(14, 22, 0))).to.equal(
        "NFLX waits for its exchange to open but BYDCO trades now, so their start prices would be hours apart. Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("BYDCO", "NFLX", sep(14, 19, 30), { durationSecs: 3_600, endTs: 0 })).to.equal(
        "BYDCO waits for its exchange to open but NFLX trades now, so their start prices would be hours apart. Pick two that both trade now, or two that both wait.",
      );
    });

    it("knows HKEX's lunch break, closing auction, holidays and half days, and the LSE's hours", () => {
      const hkt = (y: number, m: number, d: number, hh: number, mm: number) => Math.floor(Date.UTC(y, m - 1, d, hh - 8, mm) / 1000);
      // Lunch: 12:00 to 13:00 Hong Kong time.
      expect(firstPriceAt("BYDCO", hkt(2026, 9, 15, 11, 59))).to.equal(hkt(2026, 9, 15, 11, 59));
      expect(firstPriceAt("BYDCO", hkt(2026, 9, 15, 12, 0))).to.equal(hkt(2026, 9, 15, 13, 0));
      // The closing auction runs to 16:10.
      expect(firstPriceAt("BYDCO", hkt(2026, 9, 15, 16, 9))).to.equal(hkt(2026, 9, 15, 16, 9));
      expect(firstPriceAt("BYDCO", hkt(2026, 9, 15, 16, 10))).to.equal(hkt(2026, 9, 16, 9, 30));
      // National Day, Thursday 1 October 2026.
      expect(firstPriceAt("BYDCO", hkt(2026, 10, 1, 10, 0))).to.equal(hkt(2026, 10, 2, 9, 30));
      // Christmas Eve is a half day to 12:10, Christmas is a holiday, and Monday 28 December trades.
      expect(firstPriceAt("BYDCO", hkt(2026, 12, 24, 12, 5))).to.equal(hkt(2026, 12, 24, 12, 5));
      expect(firstPriceAt("BYDCO", hkt(2026, 12, 24, 13, 30))).to.equal(hkt(2026, 12, 28, 9, 30));
      expect(priceTimeAt("BYDCO", hkt(2026, 12, 24, 13, 30))).to.equal(hkt(2026, 12, 28, 9, 31));

      // NWG in London: 08:00 to 16:35, through the change back to GMT on 25 October 2026.
      const london = (y: number, m: number, d: number, hh: number, mm: number, offset: number) => Math.floor(Date.UTC(y, m - 1, d, hh - offset, mm) / 1000);
      expect(byTicker("NWG")!.market).to.equal("GB");
      expect(firstPriceAt("NWG", london(2026, 10, 23, 16, 34, 1))).to.equal(london(2026, 10, 23, 16, 34, 1));
      expect(firstPriceAt("NWG", london(2026, 10, 23, 16, 35, 1))).to.equal(london(2026, 10, 26, 8, 0, 0));
      // Boxing Day falls on a Saturday in 2026, so Monday 28 December is the bank holiday; Christmas Eve ends at 12:35.
      expect(firstPriceAt("NWG", london(2026, 12, 24, 12, 40, 0))).to.equal(london(2026, 12, 29, 8, 0, 0));
      expect(pricedAt("NWG", london(2026, 12, 24, 12, 30, 0))).to.equal("exchange");
    });

    it("knows a holiday: Labor Day waits for Tuesday", () => {
      const labor = sep(7, 10, 0);
      expect(pricedAt("TSLA", labor)).to.equal("never");
      expect(pricedAt("NVDA", labor)).to.equal("perp");
      expect(firstPriceAt("NFLX", labor)).to.equal(sep(8, 4, 0));
      expect(mixedHoursAt("NFLX", "NVDA", labor)).to.equal(
        "NFLX waits for its exchange to open but NVDA trades now, so their start prices would be hours apart. " +
          "Pick two that both trade now, or two that both wait.",
      );
      expect(mixedHoursAt("NFLX", "JPM", labor)).to.equal(null);
    });

    /* The day after Thanksgiving the session closes at 1pm and after-hours at
     * 5pm, and the next session is Monday's. */
    it("knows an early close", () => {
      expect(pricedAt("NFLX", nov(27, 16, 30))).to.equal("exchange");
      expect(firstPriceAt("NFLX", nov(27, 17, 30))).to.equal(nov(30, 4, 0));
      expect(mixedHoursAt("NFLX", "NVDA", nov(27, 17, 30))).to.match(/^NFLX waits for its exchange to open but NVDA trades now, so their start prices would be days apart\./);
      // Thanksgiving itself: nothing on the exchange, and NVDA, pinned in venues247.json, on the composite.
      expect(pricedAt("NVDA", nov(26, 12, 0))).to.equal("composite");
      expect(firstPriceAt("NFLX", nov(26, 12, 0))).to.equal(nov(27, 4, 0));
    });

    /* Clocks go back on 1 November 2026 and forward on 14 March 2027. The
     * openings stay at 4:00 in New York, so they move an hour in UTC, and the
     * words stay the same. */
    it("keeps the openings on New York's clock across daylight saving changes", () => {
      expect(firstPriceAt("NFLX", at("2026-10-31T16:00:00Z"))).to.equal(at("2026-11-02T09:00:00Z"));
      expect(firstPriceAt("NFLX", at("2027-03-13T16:00:00Z"))).to.equal(at("2027-03-15T08:00:00Z"));
      const round = { durationSecs: 300, endTs: 0, expiresTs: at("2026-11-03T16:00:00Z") };
      expect(mixedHoursAt("NFLX", "NVDA", at("2026-10-31T16:00:00Z"), round, "taker")).to.match(
        / You can take it from Monday's 4:00 AM ET pre-market open\.$/,
      );
      expect(nextFairTake("NFLX", "NVDA", at("2026-10-31T16:00:00Z"), round)).to.equal(at("2026-11-02T09:00:00Z"));
    });
  });

  describe("refuses a round that would end where the two markets part", () => {
    const hour = { durationSecs: 3_600, endTs: 0 };

    /* Taken at 7:30:00, NVDA's start price is the bar closing at 7:31:00, so
     * the program ends the hour at 8:31:00, when NFLX's bars have stopped. */
    it("refuses NFLX v NVDA for an hour from 7:30pm, and allows fifteen minutes", () => {
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 30), hour)).to.equal(
        "This round would end around Monday 8:31 PM ET, when NVDA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 30), { durationSecs: 900, endTs: 0 })).to.equal(null);
      // A Pyth stock prints after 8pm on a Monday, so TSLA v NVDA is fair for the hour.
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 19, 30), hour)).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 15, 30), hour)).to.equal(null);
    });

    it("says days when the weekend is in the gap", () => {
      expect(mixedHoursAt("NFLX", "NVDA", sep(11, 19, 30), hour)).to.match(
        /^This round would end around Friday 8:31 PM ET, when NVDA still trades but NFLX waits for Monday's 4:00 AM ET pre-market open, so their end prices would be days apart\./,
      );
    });

    /* The program ends a timed round its length after the later start price,
     * and a bar's start price is the end of the bar the boundary falls in.
     * Accepted at 7:53:58, the boundary is 7:54:00, the bars end 7:55:00 and
     * the round at 8:00:00, after NFLX's last bar. At 7:53:57 the boundary is
     * 7:53:59 and the round ends 7:59:00, whose bars close at 8:00:00. */
    it("ends a timed round where the program does, from the later side's start price", () => {
      const five = { durationSecs: 300, endTs: 0 };
      expect(apartIfTakenAt("NFLX", "NVDA", sep(14, 19, 53, 57), five)).to.equal(null);
      expect(apartIfTakenAt("NFLX", "NVDA", sep(14, 19, 53, 58), five)).to.deep.include({ at: "end", boundary: sep(14, 20, 0) });
      expect(apartIfTakenAt("NFLX", "NVDA", sep(14, 19, 53, 59), five)).to.deep.include({ at: "end", boundary: sep(14, 20, 0) });
      // And the take can land up to TAKE_SLACK_SECS after it was checked.
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 53, 58) - TAKE_SLACK_SECS - 1, five)).to.equal(null);
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 53, 58) - TAKE_SLACK_SECS, five)).to.match(
        /^This round would end around Monday 8:00 PM ET, when NVDA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open/,
      );
      // An hour taken at 6:58:58 ends at 8:00:00 too.
      expect(apartIfTakenAt("NFLX", "NVDA", sep(21, 18, 58, 58), hour)).to.deep.include({ at: "end", late: "NFLX" });
      expect(apartIfTakenAt("NFLX", "NVDA", sep(18, 19, 53, 58), five)).to.deep.include({ at: "end", late: "NFLX" });
    });

    it("allows a bell, which always rings in session", () => {
      expect(mixedHoursAt("TSLA", "NVDA", sep(14, 10, 0), { durationSecs: 0, endTs: sep(14, 15, 59, 30) })).to.equal(null);
      expect(mixedHoursAt("TSLA", "NFLX", sep(14, 10, 0), { durationSecs: 0, endTs: sep(18, 15, 59, 30) })).to.equal(null);
    });

    it("allows two that stop together, and counts a round from a start that waited", () => {
      expect(mixedHoursAt("TSLA", "QQQ", sep(14, 15, 30), hour)).to.equal(null);
      expect(mixedHoursAt("TSLA", "QQQ", sep(11, 18, 0), hour)).to.equal(null);
      // NFLX v JPM taken on Saturday: an hour from Monday's 4am, still in pre-market.
      expect(mixedHoursAt("NFLX", "JPM", SATURDAY, hour)).to.equal(null);
    });

    it("refuses a stock with neither perp nor pool against a Pyth stock past 8pm", () => {
      expect(mixedHoursAt("NFLX", "TSLA", sep(14, 19, 30), hour)).to.equal(
        "This round would end around Monday 8:31 PM ET, when TSLA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open, " +
          "so their end prices would be hours apart. Pick a round that ends while both trade, or two that trade the same hours.",
      );
    });

    it("checks the start before the end", () => {
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 21, 0), hour)).to.match(/start prices would be hours apart/);
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, hour)).to.match(/a fight whose start lands then/);
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

    it("refuses a Friday-bell NFLX v NVDA taken at 7:59:58pm, and at 7:59:00pm", () => {
      expect(START_DELAY_SECS).to.equal(2);
      expect(TAKE_SLACK_SECS).to.equal(90);
      // Taken at 7:59:58 the boundary is 8:00:00: NFLX's next bar is Tuesday's.
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 59, 58), bell(18))).to.equal(
        "NFLX stops pricing at 8:00 PM ET, and a take now could land after that. NVDA would then start at once but NFLX " +
          "not until Tuesday's 4:00 AM ET pre-market open, so their start prices would be hours apart. Pick two that trade the same hours.",
      );
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 59, 0), bell(18))).to.match(/^NFLX stops pricing at 8:00 PM ET, and a take now could land after that\./);
      // The last take that cannot start at 8:00:00 is sent 90 seconds before 7:59:58.
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 58, 27), bell(18))).to.equal(null);
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 58, 28), bell(18))).to.not.equal(null);
    });

    it("refuses NFLX v MSFT on the Friday before Labor Day, and NFLX or TSLA before an early close", () => {
      expect(mixedHoursAt("NFLX", "MSFT", sep(4, 19, 59, 59), bell(8))).to.match(/not until Tuesday's 4:00 AM ET pre-market open, so their start prices would be days apart/);
      expect(mixedHoursAt("NFLX", "NVDA", nov(27, 16, 59, 58), { durationSecs: 0, endTs: nov(30, 15, 59, 30) })).to.match(
        /^NFLX stops pricing at 5:00 PM ET, .* not until Monday's 4:00 AM ET pre-market open, so their start prices would be days apart/,
      );
      expect(mixedHoursAt("TSLA", "NVDA", nov(27, 12, 59, 58), { durationSecs: 0, endTs: nov(30, 15, 59, 30) })).to.match(
        /^Pyth does not publish TSLA from Friday 1:00 PM to Sunday 8:00 PM ET/,
      );
    });

    /* Somebody taking a challenge cannot change its stocks or its round, so
     * they are told when they can take it instead. */
    it("tells a taker when the challenge can be taken, or that it cannot", () => {
      const week = { durationSecs: 3_600, endTs: 0, expiresTs: sep(21, 15, 30) };
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 30), week, "taker")).to.equal(
        "This round would end around Monday 8:31 PM ET, when NVDA still trades but NFLX waits for Tuesday's 4:00 AM ET pre-market open, " +
          "so their end prices would be hours apart. You can take it from Tuesday's 4:00 AM ET pre-market open.",
      );
      expect(mixedHoursAt("NFLX", "NVDA", SATURDAY, week, "taker")).to.match(/ You can take it from Monday's 4:00 AM ET pre-market open\.$/);
      const shortly = { ...bell(18), expiresTs: sep(15, 3, 0) };
      expect(mixedHoursAt("NFLX", "NVDA", sep(14, 19, 59, 58), shortly, "taker")).to.match(/ It closes before the two line up again\.$/);
      // A Pyth side in the dark: the moment Pyth has printed for a minute.
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, week, "taker")).to.equal(
        "Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET, and a fight whose start lands then, or within a minute of it, " +
          "can never be priced. You can take it from Sunday's 8:01 PM ET.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, { ...week, expiresTs: sep(13, 12, 0) }, "taker")).to.match(/ It closes before it can be taken\.$/);
    });

    it("finds the first moment a challenge can be taken from, before it closes", () => {
      expect(nextFairTake("TSLA", "NVDA", sep(11, 19, 59), bell(18))).to.equal(sep(13, 20, 1));
      expect(nextFairTake("NFLX", "NVDA", SATURDAY, bell(18))).to.equal(sep(14, 4, 0));
      // Past Labor Day: TSLA prices again from Monday 8:01 PM, but NFLX not until Tuesday's 4am.
      expect(nextFairTake("TSLA", "NFLX", sep(4, 21, 0), bell(11))).to.equal(sep(8, 4, 0));
      expect(nextFairTake("TSLA", "QQQ", sep(4, 21, 0), bell(11))).to.equal(sep(7, 20, 1));
      expect(nextFairTake("TSLA", "QQQ", nov(27, 13, 30), { durationSecs: 0, endTs: ny(2026, 12, 4, 15, 59, 30) })).to.equal(nov(29, 20, 1));
      expect(nextFairTake("NFLX", "NVDA", sep(14, 19, 59), { ...bell(14), expiresTs: sep(15, 3, 0) })).to.equal(null);
    });

    /* A round that runs past a Friday night or an 8pm close can never be fair,
     * wherever it starts before its challenge expires, and one that can is
     * only offered at a moment a take sent then is fair wherever it lands. */
    it("never offers a moment at which the take would still be refused", () => {
      const pairs = [
        ["TSLA", "NVDA"],
        ["NFLX", "NVDA"],
        ["TSLA", "NFLX"],
        ["VOO", "QQQ"],
      ];
      for (const [a, b] of pairs) {
        for (const durationSecs of [300, 3_600, 23_280, 57_600]) {
          for (const from of [SATURDAY, sep(11, 19, 0), sep(14, 8, 0), sep(14, 15, 0), sep(14, 21, 0), nov(27, 12, 0)]) {
            const round = { durationSecs, endTs: 0, expiresTs: from + 3 * 86_400 };
            const t = nextFairTake(a, b, from, round);
            if (t !== null) expect(mixedHoursAt(a, b, t, round), `${a} v ${b}, ${durationSecs}s from ${from}`).to.equal(null);
          }
        }
      }
      expect(nextFairTake("NFLX", "NVDA", sep(14, 8, 0), { durationSecs: 57_600, endTs: 0, expiresTs: sep(16, 8, 0) })).to.equal(null);
      // Five days from any take on Monday ends on Saturday; from Wednesday it would end on Monday, in Pyth's hours again.
      expect(nextFairTake("TSLA", "QQQ", sep(14, 8, 0), { durationSecs: 5 * 86_400, endTs: 0, expiresTs: sep(14, 20, 0) })).to.equal(null);
      expect(nextFairTake("TSLA", "QQQ", sep(14, 8, 0), { durationSecs: 5 * 86_400, endTs: 0, expiresTs: sep(16, 8, 0) })).to.equal(sep(16, 4, 0));
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

  /* A DUEL KEEPS THE SOURCES IT WAS CREATED WITH.
   *
   * The registry's source for a stock can change (set_asset moves TSLA and QQQ
   * to the oracle), and a duel records each side's at creation. A take on a
   * fight that exists is judged by what it recorded; only a create asks the
   * roster. The roster still says TSLA is Pyth, so these hold both ways. */
  describe("judges a fight that exists by the sources it recorded", () => {
    const signedDuel = { durationSecs: 900, endTs: 0, expiresTs: sep(18, 12, 0), creatorSource: SOURCE_SIGNED, opponentSource: SOURCE_SIGNED };
    const sat19 = sep(19, 14, 0);

    it("prices a Pyth stock recorded as signed like the signed stock it then is", () => {
      expect(pricedAt("TSLA", SATURDAY)).to.equal("never");
      expect(pricedAt("TSLA", SATURDAY, "signed")).to.equal("perp");
      expect(firstPriceAt("TSLA", SATURDAY, "signed")).to.equal(SATURDAY);
      expect(priceTimeAt("TSLA", SATURDAY, "signed")).to.equal(firstBarEnd(SATURDAY));
      // After the cutover TSLA is pinned in venues247.json, so a signed TSLA is the composite's.
      expect(pricedAt("TSLA", sat19, "signed")).to.equal("composite");
      expect(priceTimeAt("TSLA", sat19, "signed")).to.equal(compositePublishTime(sat19));
      // And a signed stock recorded as Pyth is Pyth's.
      expect(pricedAt("NVDA", SATURDAY, "pyth")).to.equal("never");
      expect(firstPriceAt("NVDA", sep(14, 22, 0), "pyth")).to.equal(sep(14, 22, 0));
    });

    it("lets a TSLA v NVDA recorded as signed be taken on a Saturday, and refuses one recorded on Pyth", () => {
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, signedDuel, "taker")).to.equal(null);
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, { ...signedDuel, creatorSource: SOURCE_PYTH }, "taker")).to.equal(
        "Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET, and a fight whose start lands then, or within a minute of it, " +
          "can never be priced. You can take it from Sunday's 8:01 PM ET.",
      );
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, { ...signedDuel, opponentSource: SOURCE_PYTH }, "taker")).to.match(/^Pyth does not publish NVDA from Friday/);
      // Without recorded sources, the roster's: TSLA on Pyth.
      expect(mixedHoursAt("TSLA", "NVDA", SATURDAY, { durationSecs: 900, endTs: 0 })).to.match(/^Pyth does not publish TSLA from Friday/);
      expect(apartIfTakenAt("TSLA", "NFLX", sep(14, 21, 0), signedDuel)).to.deep.include({ early: "TSLA", late: "NFLX" });
    });

    it("finds the next fair take by the recorded sources", () => {
      const nfl = { ...signedDuel, expiresTs: sep(16, 12, 0) };
      expect(nextFairTake("TSLA", "NFLX", SATURDAY, nfl)).to.equal(sep(14, 4, 0));
      expect(nextFairTake("TSLA", "NVDA", sep(11, 21, 0), { ...nfl, creatorSource: SOURCE_PYTH })).to.equal(sep(13, 20, 1));
    });

    /* After the cutover, a Pyth side and a composite side are stamped minutes
     * apart even when both price at once: the composite's window. */
    it("refuses a Pyth side against a composite side on a weekday night after the cutover, and says why", () => {
      const tuesday = sep(22, 21, 0);
      expect(mixedHoursAt("VOO", "TSLA", tuesday, { durationSecs: 86_400, endTs: 0, creatorSource: SOURCE_PYTH, opponentSource: SOURCE_SIGNED })).to.equal(
        "TSLA is priced by the median of its 24/7 markets over the 3 minutes from the start and VOO at once, so their start prices would be minutes apart. " +
          "Pick two priced the same way: two stocks priced around the clock, or two that are not.",
      );
    });
  });

  /* A ROUND THE COMPOSITE PRICES RUNS AT LEAST 12 HOURS.
   *
   * One venue can move a composite price by a fraction of a basis point, and
   * over 15 minutes that is often the whole move (docs/247-hardening.md). So a
   * round with a start or end the composite prices is refused under
   * MIN_OFFHOURS_ROUND_SECS, a bell round that ends in session excepted. */
  describe("refuses a round too short for the 24/7 prices that would decide it", () => {
    const sat19 = sep(19, 14, 0);
    const minutes = (n: number) => ({ durationSecs: n * 60, endTs: 0 });
    const why = "and a round priced that way must run at least 12 hours, because over a shorter one a single market could tip the result.";

    it("refuses 15 minutes of AAPL v NVDA on a Saturday after the cutover, and allows 12 and 24 hours", () => {
      expect(mixedHoursAt("AAPL", "NVDA", sat19, minutes(15))).to.equal(
        `AAPL and NVDA would be priced by their 24/7 markets at the start of this round, ${why} Pick a round of 12 hours or more, or a bell.`,
      );
      expect(mixedHoursAt("AAPL", "NVDA", sat19, minutes(60))).to.match(/^AAPL and NVDA would be priced by their 24\/7 markets/);
      expect(mixedHoursAt("AAPL", "NVDA", sat19, minutes(719))).to.match(/^AAPL and NVDA would be priced by their 24\/7 markets/);
      expect(mixedHoursAt("AAPL", "NVDA", sat19, minutes(720))).to.equal(null);
      expect(mixedHoursAt("AAPL", "NVDA", sat19, minutes(1_440))).to.equal(null);
      // Before the cutover the perps price it, as they always did.
      expect(mixedHoursAt("AAPL", "NVDA", SATURDAY, minutes(15))).to.equal(null);
      // Two Pyth stocks on a weekday night are not the composite's.
      expect(mixedHoursAt("TSLA", "VOO", sep(22, 21, 0), minutes(15))).to.equal(null);
    });

    it("refuses an hour from 7:30 PM on a weekday, whose end the composite would price", () => {
      expect(mixedHoursAt("AAPL", "NVDA", sep(23, 19, 30), minutes(60))).to.equal(
        `This round would end around Wednesday 8:31 PM ET, when AAPL and NVDA would be priced by their 24/7 markets, ${why} Pick a round of 12 hours or more, or a bell.`,
      );
      expect(mixedHoursAt("AAPL", "NVDA", sep(23, 18, 0), minutes(60))).to.equal(null);
    });

    it("lets a bell round that ends in session start on the composite, and not a fixed end at any other time", () => {
      expect(mixedHoursAt("AAPL", "NVDA", sep(24, 21, 0), { durationSecs: 0, endTs: sep(25, 15, 59, 30) })).to.equal(null);
      expect(mixedHoursAt("AAPL", "NVDA", sep(25, 3, 50), { durationSecs: 0, endTs: sep(25, 15, 59, 30) })).to.equal(null);
      expect(mixedHoursAt("AAPL", "NVDA", sat19, { durationSecs: 0, endTs: sat19 + 3_600 })).to.match(/^AAPL and NVDA would be priced by their 24\/7 markets at the start/);
    });

    it("tells a taker when a short round can be taken: when the exchange prices both ends", () => {
      const round = { ...minutes(15), expiresTs: sep(24, 12, 0), creatorSource: SOURCE_SIGNED, opponentSource: SOURCE_SIGNED };
      expect(mixedHoursAt("AAPL", "NVDA", sat19, round, "taker")).to.equal(
        `AAPL and NVDA would be priced by their 24/7 markets at the start of this round, ${why} You can take it from Monday's 4:00 AM ET pre-market open.`,
      );
      expect(nextFairTake("AAPL", "NVDA", sat19, round)).to.equal(sep(21, 4, 0));
      expect(mixedHoursAt("AAPL", "NVDA", sat19, { ...round, expiresTs: sep(20, 12, 0) }, "taker")).to.match(/ It closes before it can be taken\.$/);
    });
  });

  /* FROM THE CUTOVER, ONLY THE COMPOSITE PRICES A SHUT US STOCK.
   *
   * A perp or pool pinned before it priced stocks the composite does not list
   * (GLD, GME, KO, MCD, MRNA, STRC). From COMPOSITE_FROM those wait for their
   * exchange like any stock with neither, and a fight across the cutover ends
   * on the rules it started under. */
  describe("retires perps and pools after the cutover for stocks the composite does not list", () => {
    const sat19 = sep(19, 14, 0);

    it("has the stocks the plan names losing round-the-clock pricing", () => {
      for (const t of ["GLD", "GME", "KO", "MCD", "MRNA", "STRC"]) {
        const where = quoteSymbolFor(byTicker(t)!.feed)!;
        expect(!!(where.perp || where.pool), `${t} has a perp or pool`).to.equal(true);
        expect(where.composite, `${t} is not pinned`).to.equal(undefined);
      }
    });

    it("waits for the exchange from the cutover, and keeps the pool or perp before it", () => {
      for (const t of ["GLD", "GME", "KO", "MCD", "MRNA", "STRC"]) {
        expect(pricedAt(t, SATURDAY), t).to.be.oneOf(["perp", "pool"]);
        expect(pricedAt(t, sat19), t).to.equal("waits");
        expect(firstPriceAt(t, sat19), t).to.equal(sep(21, 4, 0));
        expect(readyAt(oneSided(t, sat19), "start", sat19), t).to.deep.equal({ shut: [t] });
      }
      expect(pricedAt("NVDA", sat19)).to.equal("composite");
      expect(mixedHoursAt("KO", "NVDA", sat19)).to.equal(
        "KO waits for its exchange to open but NVDA trades now, so their start prices would be days apart. Pick two that both trade now, or two that both wait.",
      );
      // The cutover is a boundary (Wednesday 16 Sep, 7:06:40 PM ET): the night before keeps the pool, that night waits.
      expect(COMPOSITE_FROM).to.be.within(sep(16, 19, 0), sep(16, 20, 0));
      expect(pricedAt("KO", sep(15, 21, 0))).to.equal("pool");
      expect(pricedAt("KO", sep(16, 21, 0))).to.equal("waits");
    });
  });

  /* THE WHOLE TAKE WINDOW, SECOND BY SECOND, AGAINST THE PRICE CLOCK.
   *
   * For accept times a second apart around every opening and close on five
   * days of calendar, Pyth's own edges among them, and for a bell, five
   * minutes and an hour, this plays the program's sums with publish times
   * taken from priceClock's readyAt (less its grace), not from priceTimeAt. A
   * side the clock says can never be priced makes the fight unfair:
   *
   *   apartIfTakenAt must be null exactly when both the start and the settle
   *   prices land within SAME_PRICE_SECS, or some side can never be priced
   *   (which is not a question of the two parting), and
   *
   *   whenever mixedHoursAt lets a take through, every accept time in the
   *   TAKE_SLACK_SECS after it must be fair: both sides priced, at the start
   *   and at the end, within SAME_PRICE_SECS. */
  describe("agrees with the program's sums, for every accept time near a session edge", () => {
    const published = new Map<string, number | null>();
    const publishAt = (ticker: string, boundary: number) => {
      const key = `${ticker}:${boundary}`;
      if (!published.has(key)) {
        const s = byTicker(ticker)!;
        const clock = readyAt(oneSided(ticker, boundary), "start", boundary + 20 * 86_400);
        published.set(key, "at" in clock ? clock.at - (s.source === "pyth" ? PYTH_GRACE_SECS : BAR_SETTLE_SECS) : null);
      }
      return published.get(key)!;
    };
    type Round = { durationSecs: number; endTs: number };
    const onChain = (a: string, b: string, acceptedTs: number, round: Round): "fair" | "apart" | "never" => {
      const start = acceptedTs + START_DELAY_SECS;
      const [pa, pb] = [publishAt(a, start), publishAt(b, start)];
      if (pa === null || pb === null) return "never";
      if (Math.abs(pa - pb) > SAME_PRICE_SECS) return "apart";
      const end = round.durationSecs ? Math.max(pa, pb) + round.durationSecs : round.endTs;
      const [ea, eb] = [publishAt(a, end), publishAt(b, end)];
      if (ea === null || eb === null) return "never";
      return Math.abs(ea - eb) <= SAME_PRICE_SECS ? "fair" : "apart";
    };

    const PAIRS = [
      ["TSLA", "NVDA"],
      ["TSLA", "NFLX"],
      ["NFLX", "NVDA"],
      ["SPY", "NFLX"],
      ["TSLA", "QQQ"],
      ["VOO", "NVDA"],
      ["BYDCO", "NVDA"],
    ];
    /* Seconds before an edge (less the round, for its end) that a take is
     * sent at: where the window's far end crosses it, where a bar's end
     * crosses it, and where the boundary itself does. */
    const SENT = [...Array(111).keys()].map((i) => i - 100).filter((s) => s <= -80 || (s >= -70 && s <= -50) || s >= -10);
    /* A normal Monday, the Friday before Labor Day, Labor Day's own evening
     * when Pyth comes back, the Sunday evening it comes back after a weekend,
     * and the early close. Pyth's edges are where its margin ends: a minute
     * before a span's end, and a minute after its start. */
    const DAYS: { edges: number[]; bell: number }[] = [
      { edges: [sep(14, 4, 0), sep(14, 9, 30), sep(14, 16, 0), sep(14, 20, 0)], bell: sep(18, 15, 59, 30) },
      { edges: [sep(4, 4, 0), sep(4, 9, 30), sep(4, 16, 0), sep(4, 19, 59), sep(4, 20, 0)], bell: sep(11, 15, 59, 30) },
      { edges: [sep(7, 20, 1)], bell: sep(11, 15, 59, 30) },
      { edges: [sep(13, 20, 1)], bell: sep(18, 15, 59, 30) },
      { edges: [nov(27, 4, 0), nov(27, 9, 30), nov(27, 12, 59), nov(27, 13, 0), nov(27, 17, 0)], bell: ny(2026, 12, 4, 15, 59, 30) },
      // HKEX's edges on Tuesday 15 Sep in Hong Kong: its opening, lunch, afternoon and closing auction, in New York time.
      { edges: [sep(14, 21, 30), sep(15, 0, 0), sep(15, 1, 0), sep(15, 4, 10)], bell: sep(18, 15, 59, 30) },
      // A weekday night after the cutover, where the composite's window and the exchange hand over.
      { edges: [sep(23, 20, 0), sep(24, 4, 0)], bell: sep(25, 15, 59, 30) },
    ];

    for (const [a, b] of PAIRS) {
      it(`${a} v ${b}`, function () {
        this.timeout(240_000);
        for (const day of DAYS) {
          const rounds: Round[] = [
            { durationSecs: 0, endTs: day.bell },
            { durationSecs: 300, endTs: 0 },
            { durationSecs: 3_600, endTs: 0 },
          ];
          for (const round of rounds) {
            const verdicts = new Map<number, ReturnType<typeof onChain>>();
            const verdictAt = (t: number) => {
              if (!verdicts.has(t)) verdicts.set(t, onChain(a, b, t, round));
              return verdicts.get(t)!;
            };
            for (const edge of day.edges) {
              for (const shift of round.durationSecs ? [0, round.durationSecs] : [0]) {
                for (const sent of SENT.map((s) => edge - shift + s)) {
                  const where = `${a} v ${b}, ${round.durationSecs || "bell"}, sent ${new Date(sent * 1000).toISOString()}`;
                  expect(apartIfTakenAt(a, b, sent, round) === null, where).to.equal(verdictAt(sent) !== "apart");
                  if (mixedHoursAt(a, b, sent, round) === null) {
                    for (let t = sent; t <= sent + TAKE_SLACK_SECS; t++) expect(verdictAt(t), `${where}, lands ${t - sent}s later`).to.equal("fair");
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
   * five stretches of calendar (Labor Day, the weekend of 12 September, the
   * week of Thanksgiving with its early close, and both daylight saving
   * changes), firstPriceAt must be exactly the moment the price clock prices
   * that side from:
   *
   *   Pyth             ready at firstPriceAt + PYTH_GRACE_SECS, and "never",
   *                    with the stall refund's moment, exactly where
   *                    firstPriceAt is null; never shut
   *   a pool's window  ready at firstPriceAt + BAR_SETTLE_SECS
   *   a minute bar     ready at the end of the bar firstPriceAt falls in,
   *                    plus BAR_SETTLE_SECS
   *
   * and the clock must call a side shut exactly while firstPriceAt is after
   * both the boundary and now. pricedAt must call it a wait exactly when
   * firstPriceAt is a later moment, and never exactly when it is null, and
   * priceTimeAt must be the moment the clock is ready at, less its grace. */
  describe("agrees with the price clock", () => {
    /* Pyth's hours as the plan states them, written again from scratch so the
     * grid checks market.ts's spans against the rule and not only against
     * themselves. A moment from 8 PM belongs to the next calendar day. That day
     * must be a trading day; on a half day Pyth is taken to stop at 1 PM; and
     * the first minute after 8 PM is refused unless the day before printed
     * right up to 8 PM, which a full trading day does. */
    const HALF_DAYS = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
    const dayOf = (p: { y: number; m: number; d: number }) => {
      const q = nyParts(nyToMs(p.y, p.m, p.d, 12, 0));
      return { q, trading: isTradingDay(nyToMs(q.y, q.m, q.d, 12, 0)), half: HALF_DAYS.has(`${q.y}-${String(q.m).padStart(2, "0")}-${String(q.d).padStart(2, "0")}`) };
    };
    const pythPricesInWords = (t: number) => {
      const p = nyParts(t * 1_000);
      const late = p.hh >= 20;
      const day = dayOf({ y: p.y, m: p.m, d: p.d + (late ? 1 : 0) });
      if (!day.trading) return false;
      if (!late && day.half && p.hh >= 13) return false;
      const before = dayOf({ y: day.q.y, m: day.q.m, d: day.q.d - 1 });
      const firstMinute = late && p.hh === 20 && p.mm === 0;
      return !(firstMinute && !(before.trading && !before.half));
    };

    const KINDS: Record<string, string[]> = {
      pyth: ["TSLA", "QQQ", "VOO"],
      perp: ["NVDA", "AAPL"],
      pool: ["SPY", "KO"],
      exchange: ["NFLX", "JPM"],
      abroad: ["BYDCO"],
      // Pyth stocks on the roster, in duels that recorded them as signed (after a set_asset).
      "signed by record": ["TSLA", "QQQ"],
    };

    const EDGES = [
      [3, 59, 59], [4, 0, 0], [9, 29, 59], [9, 30, 0], [12, 58, 59], [12, 59, 0], [12, 59, 1], [12, 59, 59], [13, 0, 0],
      [15, 59, 59], [16, 0, 0], [16, 59, 59], [17, 0, 0], [19, 58, 59], [19, 59, 0], [19, 59, 1], [19, 59, 59], [20, 0, 0],
      [20, 0, 1], [20, 0, 59], [20, 1, 0],
    ];
    const grid: number[] = [];
    for (const [y, m, d0, days] of [
      [2026, 9, 4, 5],
      [2026, 9, 11, 4],
      [2026, 11, 23, 8],
      [2026, 10, 30, 4],
      [2027, 3, 12, 4],
    ]) {
      for (let i = 0; i < days; i++) {
        const midnight = ny(y, m, d0 + i, 0, 0);
        for (let t = midnight + 37; t < midnight + 86_400; t += 40 * 60) grid.push(t);
        for (const [hh, mm, ss] of EDGES) grid.push(ny(y, m, d0 + i, hh, mm, ss));
      }
    }

    for (const [kind, tickers] of Object.entries(KINDS)) {
      it(`${kind}: ${tickers.join(", ")}`, function () {
        this.timeout(120_000);
        const src = kind === "signed by record" ? "signed" : undefined;
        for (const ticker of tickers) {
          for (const b of grid) {
            const where = `${ticker} at ${new Date(b * 1000).toISOString()}`;
            const first = firstPriceAt(ticker, b, src);
            const d = oneSided(ticker, b, src);
            const clock = readyAt(d, "start", b + 20 * 86_400);

            if (kind === "pyth") {
              expect(first === null || first === b, where).to.equal(true);
              expect(first !== null, `${where}, against the rule in words`).to.equal(pythPricesInWords(b));
              expect(pricedAt(ticker, b), where).to.equal(first === null ? "never" : "pyth");
              expect(priceTimeAt(ticker, b), `${where}, price time`).to.equal(first);
              expect(clock, where).to.deep.equal(
                first === null ? { never: [ticker], refundAt: d.acceptedTs + STALL_REFUND_SECS } : { at: b + PYTH_GRACE_SECS, why: "pyth" },
              );
              expect("shut" in readyAt(d, "start", b), `${where}, now`).to.equal(false);
              continue;
            }

            expect(first, where).to.be.a("number");
            const f = first as number;
            expect(f, where).to.be.at.least(b);
            expect(pricedAt(ticker, b, src) === "waits", where).to.equal(f !== b);

            const ready = clock as Ready;
            expect(ready, where).to.have.property("at");
            const priced = pricedAt(ticker, b, src);
            const expected =
              priced === "pool" ? f + BAR_SETTLE_SECS : priced === "composite" ? compositePublishTime(f) + BAR_SETTLE_SECS : firstBarEnd(f) + BAR_SETTLE_SECS;
            expect(ready.at, where).to.equal(expected);
            // And the time the price will carry is the clock's, less its grace.
            expect(priceTimeAt(ticker, b, src), `${where}, price time`).to.equal(ready.at - BAR_SETTLE_SECS);

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
