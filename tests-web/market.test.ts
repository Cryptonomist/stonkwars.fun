import { expect } from "chai";

import {
  abroadOpeningAfter,
  abroadOpeningsBetween,
  isTradingDay,
  sessionsModelled,
  nextBell,
  nyToMs,
  PYTH_EDGE_SECS,
  pythGapNear,
  pythPricesAt,
  pythReopeningsBetween,
  pythSpanAt,
  session,
  sessionFrom,
  weekBell,
} from "../src/lib/market";

const at = (iso: string) => Date.parse(iso);
const iso = (unix: number) => new Date(unix * 1000).toISOString();
/** A New York wall-clock time, in unix seconds. */
const ny = (y: number, m: number, d: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(y, m, d, hh, mm, ss) / 1000);
const sep = (d: number, hh: number, mm: number, ss = 0) => ny(2026, 9, d, hh, mm, ss);

describe("market clock", () => {
  /* HKEX and the LSE, as market.ts models them (its comment cites the
   * calendars). Unix seconds from UTC wall time, so these do not lean on the
   * code under test for time zones. */
  describe("Hong Kong and London sessions", () => {
    const utc = (y: number, m: number, d: number, hh: number, mm: number) => Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000);

    it("opens HKEX at 01:30 and 05:00 UTC and closes it at 04:00 and 08:10 UTC, with no daylight saving", () => {
      for (const [y, m, d] of [[2026, 9, 15], [2027, 1, 12]]) {
        expect(abroadOpeningAfter("HK", utc(y, m, d, 1, 29))).to.equal(utc(y, m, d, 1, 30));
        expect(abroadOpeningAfter("HK", utc(y, m, d, 3, 59))).to.equal(utc(y, m, d, 3, 59));
        expect(abroadOpeningAfter("HK", utc(y, m, d, 4, 0))).to.equal(utc(y, m, d, 5, 0));
        expect(abroadOpeningAfter("HK", utc(y, m, d, 8, 9))).to.equal(utc(y, m, d, 8, 9));
        expect(abroadOpeningAfter("HK", utc(y, m, d, 8, 10))).to.equal(utc(y, m, d + 1, 1, 30));
      }
      expect(sessionsModelled("HK") && sessionsModelled("GB") && !sessionsModelled("US") && !sessionsModelled("SOMEWHERE")).to.equal(true);
      expect(abroadOpeningAfter("SOMEWHERE", 12_345)).to.equal(12_345);
    });

    it("skips Hong Kong's weekday general holidays, including the Lunar New Year of 2027", () => {
      // Friday 5 Feb 2027 is a half day (to 04:10 UTC); Monday 8 and Tuesday 9 Feb are holidays.
      expect(abroadOpeningAfter("HK", utc(2027, 2, 5, 4, 5))).to.equal(utc(2027, 2, 5, 4, 5));
      expect(abroadOpeningAfter("HK", utc(2027, 2, 5, 4, 10))).to.equal(utc(2027, 2, 10, 1, 30));
    });

    it("opens the LSE at 08:00 London time, which moves an hour in UTC with British Summer Time", () => {
      expect(abroadOpeningAfter("GB", utc(2026, 9, 14, 6, 59))).to.equal(utc(2026, 9, 14, 7, 0));
      expect(abroadOpeningAfter("GB", utc(2026, 11, 2, 7, 59))).to.equal(utc(2026, 11, 2, 8, 0));
      expect(abroadOpeningAfter("GB", utc(2026, 11, 2, 16, 34))).to.equal(utc(2026, 11, 2, 16, 34));
      expect(abroadOpeningAfter("GB", utc(2026, 11, 2, 16, 35))).to.equal(utc(2026, 11, 3, 8, 0));
      // Good Friday and Easter Monday 2027.
      expect(abroadOpeningAfter("GB", utc(2027, 3, 25, 17, 0))).to.equal(utc(2027, 3, 30, 7, 0));
    });

    it("lists each session start in between, in order", () => {
      expect(abroadOpeningsBetween("HK", utc(2026, 9, 12, 0, 0), utc(2026, 9, 15, 6, 0))).to.deep.equal([
        utc(2026, 9, 14, 1, 30),
        utc(2026, 9, 14, 5, 0),
        utc(2026, 9, 15, 1, 30),
        utc(2026, 9, 15, 5, 0),
      ]);
      expect(abroadOpeningsBetween("GB", utc(2026, 12, 24, 0, 0), utc(2026, 12, 30, 0, 0))).to.deep.equal([utc(2026, 12, 24, 8, 0), utc(2026, 12, 29, 8, 0)]);
      expect(abroadOpeningsBetween("US", 0, 100)).to.deep.equal([]);
    });
  });

  it("converts New York wall time to UTC across daylight saving", () => {
    // EDT, UTC-4
    expect(new Date(nyToMs(2026, 9, 11, 15, 59, 30)).toISOString()).to.equal("2026-09-11T19:59:30.000Z");
    // EST, UTC-5
    expect(new Date(nyToMs(2026, 12, 11, 15, 59, 30)).toISOString()).to.equal("2026-12-11T20:59:30.000Z");
    // The day the clocks go back: 1:30 AM happens twice; either answer is a real instant.
    const fallback = nyToMs(2026, 11, 1, 12, 0, 0);
    expect(new Date(fallback).toISOString()).to.equal("2026-11-01T17:00:00.000Z");
  });

  it("knows sessions, weekends and holidays", () => {
    expect(session(at("2026-09-11T18:00:00Z"))).to.equal("open"); // Fri 2 PM ET
    expect(session(at("2026-09-11T12:00:00Z"))).to.equal("pre"); // Fri 8 AM ET
    expect(session(at("2026-09-11T21:00:00Z"))).to.equal("after"); // Fri 5 PM ET
    expect(session(at("2026-09-12T18:00:00Z"))).to.equal("closed"); // Saturday
    expect(session(at("2026-11-26T18:00:00Z"))).to.equal("closed"); // Thanksgiving
    expect(isTradingDay(at("2026-09-07T18:00:00Z"))).to.equal(false); // Labor Day
  });

  it("closes at 1 PM on a half day", () => {
    expect(session(at("2026-11-27T17:30:00Z"))).to.equal("open"); // 12:30 PM ET
    expect(session(at("2026-11-27T18:30:00Z"))).to.equal("after"); // 1:30 PM ET
  });

  it("offers the next bell inside a session, with lead time", () => {
    // Friday 2 PM ET: today's bell.
    expect(iso(nextBell(at("2026-09-11T18:00:00Z")))).to.equal("2026-09-11T19:59:30.000Z");
    // Friday 3:50 PM ET: under 15 minutes to the bell, so Monday's.
    expect(iso(nextBell(at("2026-09-11T19:50:00Z")))).to.equal("2026-09-14T19:59:30.000Z");
    // Saturday: Monday.
    expect(iso(nextBell(at("2026-09-12T15:00:00Z")))).to.equal("2026-09-14T19:59:30.000Z");
    // The day after Thanksgiving closes early: its bell is 12:59:30 ET.
    expect(iso(nextBell(at("2026-11-27T14:00:00Z")))).to.equal("2026-11-27T17:59:30.000Z");
  });

  it("finds when a session is next running, from any moment", () => {
    const from = (s: string, hours: "extended" | "regular") => {
      const ms = sessionFrom(at(s), hours);
      return ms === null ? null : new Date(ms).toISOString();
    };
    // Inside a session: that very moment.
    expect(from("2026-09-11T18:00:00Z", "regular")).to.equal("2026-09-11T18:00:00.000Z");
    expect(from("2026-09-11T12:00:00Z", "extended")).to.equal("2026-09-11T12:00:00.000Z");
    // Friday 8 AM ET: pre-market is extended hours, not regular ones.
    expect(from("2026-09-11T12:00:00Z", "regular")).to.equal("2026-09-11T13:30:00.000Z");
    // Friday 7 PM ET is after-hours; 9 PM ET is shut until Monday.
    expect(from("2026-09-11T23:00:00Z", "extended")).to.equal("2026-09-11T23:00:00.000Z");
    expect(from("2026-09-12T01:00:00Z", "extended")).to.equal("2026-09-14T08:00:00.000Z");
    expect(from("2026-09-12T01:00:00Z", "regular")).to.equal("2026-09-14T13:30:00.000Z");
    // Labor Day weekend: Monday the 7th is shut, so Tuesday.
    expect(from("2026-09-05T15:00:00Z", "regular")).to.equal("2026-09-08T13:30:00.000Z");
    // A half day's after-hours end at 5 PM ET, and the next is Monday.
    expect(from("2026-11-27T21:30:00Z", "extended")).to.equal("2026-11-27T21:30:00.000Z");
    expect(from("2026-11-27T22:30:00Z", "extended")).to.equal("2026-11-30T09:00:00.000Z");
    // Across the clocks going back (Sunday 1 November): Monday's open is EST.
    expect(from("2026-10-31T16:00:00Z", "regular")).to.equal("2026-11-02T14:30:00.000Z");
  });

  /* PYTH'S HOURS, AS MEASURED FROM HERMES ON 14 SEP 2026.
   *
   * Every second from 8 PM the evening before a trading day to 8 PM on it,
   * joined across weekday nights; dark from Friday 8 PM to Sunday 8 PM, and
   * on Labor Day weekend from Friday 8 PM to Monday 8 PM. The first print
   * after a gap carries a made-up prev_publish_time, so a take is refused under
   * a minute into a span, but a boundary there is still priced when it can be. */
  describe("Pyth's 24/5 hours", () => {
    const span = (t: number) => {
      const s = pythSpanAt(t);
      return s && [iso(s.start), iso(s.end)];
    };

    it("prints from Sunday 8 PM to Friday 8 PM, as one span", () => {
      const week = [iso(sep(13, 20, 0)), iso(sep(18, 20, 0))];
      for (const t of [sep(13, 20, 0), sep(14, 3, 0), sep(15, 20, 0), sep(16, 19, 59, 59), sep(17, 4, 0), sep(18, 19, 59, 59)]) {
        expect(span(t), iso(t)).to.deep.equal(week);
      }
      expect(span(sep(18, 20, 0))).to.equal(null);
      expect(span(sep(19, 12, 0))).to.equal(null);
      expect(span(sep(13, 19, 59, 59))).to.equal(null);
    });

    it("prices a Friday boundary up to the last second, and refuses the margin before the gap", () => {
      expect(PYTH_EDGE_SECS).to.equal(60);
      // TSLA boundary Fri 19:58:59 ET: allowed. Fri 19:59:30: refused. Saturday: refused.
      expect(pythPricesAt(sep(11, 19, 58, 59))).to.equal(true);
      expect(pythGapNear(sep(11, 19, 58, 59))).to.equal(null);
      expect(pythGapNear(sep(11, 19, 59, 0))).to.equal(null);
      expect(pythPricesAt(sep(11, 19, 59, 30))).to.equal(true); // Pyth still prints; only the pages refuse it
      expect(pythGapNear(sep(11, 19, 59, 30))).to.deep.equal({ from: sep(11, 20, 0), until: sep(13, 20, 0) });
      expect(pythPricesAt(sep(11, 20, 0))).to.equal(false);
      expect(pythPricesAt(sep(12, 12, 0))).to.equal(false);
      expect(pythGapNear(sep(12, 12, 0))).to.deep.equal({ from: sep(11, 20, 0), until: sep(13, 20, 0) });
    });

    /* Hermes priced TSLA from 8:00:00 and VOO from 8:00:01 on Sunday 13 Sep,
     * so a boundary in the reopening's first minute can be priced, and the
     * crank tries it. What a page offers keeps the minute's margin: a take
     * there is refused, because when a feed comes back is not known before. */
    it("prices a boundary from Sunday's reopening, and refuses a take less than a minute after it", () => {
      // Sun 20:00:30 ET: refused to a take, and priced if a fight lands there. Sun 20:01:00: allowed.
      for (const t of [sep(13, 20, 0), sep(13, 20, 0, 1), sep(13, 20, 0, 30), sep(13, 20, 0, 59)]) {
        expect(pythPricesAt(t), iso(t)).to.equal(true);
        expect(pythGapNear(t), iso(t)).to.deep.equal({ from: sep(11, 20, 0), until: sep(13, 20, 0) });
      }
      expect(pythPricesAt(sep(13, 19, 59, 59))).to.equal(false);
      expect(pythPricesAt(sep(13, 20, 1))).to.equal(true);
      expect(pythGapNear(sep(13, 20, 1))).to.equal(null);
    });

    it("prints straight through a weekday night", () => {
      // Thu 03:59:59 ET, and the seams at 8 PM that join one day's span to the next.
      expect(pythPricesAt(sep(10, 3, 59, 59))).to.equal(true);
      for (const t of [sep(9, 19, 59, 59), sep(9, 20, 0), sep(9, 20, 0, 1), sep(9, 20, 0, 30), sep(10, 4, 0)]) {
        expect(pythPricesAt(t), iso(t)).to.equal(true);
        expect(pythGapNear(t), iso(t)).to.equal(null);
      }
    });

    it("had no Sunday night before Labor Day: dark from Friday 8 PM to Monday 8 PM", () => {
      // Sun 6 Sep 21:00 ET: refused. Mon 7 Sep 20:01: allowed.
      expect(pythPricesAt(sep(6, 21, 0))).to.equal(false);
      expect(pythPricesAt(sep(7, 12, 0))).to.equal(false);
      expect(pythGapNear(sep(6, 21, 0))).to.deep.equal({ from: sep(4, 20, 0), until: sep(7, 20, 0) });
      expect(pythPricesAt(sep(7, 19, 59, 59))).to.equal(false);
      expect(pythPricesAt(sep(7, 20, 0, 30))).to.equal(true);
      expect(pythGapNear(sep(7, 20, 0, 30))).to.deep.equal({ from: sep(4, 20, 0), until: sep(7, 20, 0) });
      expect(pythPricesAt(sep(7, 20, 1))).to.equal(true);
      expect(span(sep(7, 20, 1))).to.deep.equal([iso(sep(7, 20, 0)), iso(sep(11, 20, 0))]);
      const gap = pythGapNear(sep(6, 21, 0))!;
      expect(gap.until - gap.from).to.equal(72 * 3_600);
    });

    it("ends an early close at 1 PM, and has nothing on Thanksgiving", () => {
      const nov = (d: number, hh: number, mm: number) => ny(2026, 11, d, hh, mm);
      expect(span(nov(25, 12, 0))).to.deep.equal([iso(nov(22, 20, 0)), iso(nov(25, 20, 0))]);
      expect(pythPricesAt(nov(25, 21, 0))).to.equal(false);
      expect(pythPricesAt(nov(26, 12, 0))).to.equal(false);
      expect(span(nov(27, 12, 0))).to.deep.equal([iso(nov(26, 20, 0)), iso(nov(27, 13, 0))]);
      // So the half day's own bell, 12:59:30, is too close to that end to be offered for a Pyth side.
      expect(pythGapNear(nov(27, 12, 59))).to.equal(null);
      expect(pythGapNear(ny(2026, 11, 27, 12, 59, 30))).to.deep.equal({ from: nov(27, 13, 0), until: nov(29, 20, 0) });
      expect(pythPricesAt(nov(27, 14, 0))).to.equal(false);
      expect(pythGapNear(nov(26, 12, 0))).to.deep.equal({ from: nov(25, 20, 0), until: nov(26, 20, 0) });
    });

    it("keeps 8 PM on New York's clock when the clocks go back", () => {
      // Sunday 1 November 2026: EDT ends at 2 AM, so 8 PM that night is 01:00 UTC.
      expect(span(ny(2026, 11, 1, 20, 30))).to.deep.equal(["2026-11-02T01:00:00.000Z", "2026-11-07T01:00:00.000Z"]);
      expect(span(ny(2026, 10, 30, 19, 0))).to.deep.equal(["2026-10-26T00:00:00.000Z", "2026-10-31T00:00:00.000Z"]);
    });

    it("lists the moments a minute after each reopening", () => {
      expect(pythReopeningsBetween(sep(4, 12, 0), sep(16, 0, 0)).map(iso)).to.deep.equal([iso(sep(7, 20, 1)), iso(sep(13, 20, 1))]);
      expect(pythReopeningsBetween(sep(14, 12, 0), sep(18, 12, 0))).to.deep.equal([]);
    });
  });

  it("puts the week bell on Friday, or the last trading day before the weekend", () => {
    // Monday: that Friday.
    expect(iso(weekBell(at("2026-09-14T14:00:00Z")))).to.equal("2026-09-18T19:59:30.000Z");
    // After Friday's bell: next Friday.
    expect(iso(weekBell(at("2026-09-18T20:30:00Z")))).to.equal("2026-09-25T19:59:30.000Z");
  });
});
