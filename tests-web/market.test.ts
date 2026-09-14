import { expect } from "chai";

import { isTradingDay, nextBell, nyToMs, session, sessionFrom, weekBell } from "../src/lib/market";

const at = (iso: string) => Date.parse(iso);
const iso = (unix: number) => new Date(unix * 1000).toISOString();

describe("market clock", () => {
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

  it("puts the week bell on Friday, or the last trading day before the weekend", () => {
    // Monday: that Friday.
    expect(iso(weekBell(at("2026-09-14T14:00:00Z")))).to.equal("2026-09-18T19:59:30.000Z");
    // After Friday's bell: next Friday.
    expect(iso(weekBell(at("2026-09-18T20:30:00Z")))).to.equal("2026-09-25T19:59:30.000Z");
  });
});
