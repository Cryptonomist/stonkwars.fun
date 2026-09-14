/* The nudge schedule's promises: a page asks first just before the price can
 * exist, then when the server says, backs off while something is failing,
 * and stops once the fight has moved, its market is shut, the server has said
 * never, or it has tried for a quarter of an hour. */

import { expect } from "chai";

import {
  SOURCE_PYTH,
  SOURCE_SIGNED,
  STALL_REFUND_SECS,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_SETTLED,
  STATUS_VOID,
} from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import {
  AFTER_SENT_SECS,
  FIRST_LEAD_SECS,
  GIVE_UP_SECS,
  nextNudgeAt,
  nudgeJobFor,
  type NudgeAnswer,
  type NudgeJob,
} from "../src/lib/nudgeSchedule";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import { firstBarEnd, type MarketLookup } from "../src/lib/priceClock";

const ny = (day: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(2026, 9, day, hh, mm, ss) / 1000);

const READY = 1_789_000_000;
const job: NudgeJob = { kind: "start", readyAt: READY };
const answer = (state: NudgeAnswer["state"], serverTime: number, extra: Partial<NudgeAnswer> = {}): NudgeAnswer => ({
  state,
  serverTime,
  ...extra,
});

describe("nudge schedule", () => {
  describe("nextNudgeAt", () => {
    it("asks first two seconds before the price can exist", () => {
      expect(FIRST_LEAD_SECS).to.equal(2);
      expect(nextNudgeAt(job, null, 0, READY - 60)).to.equal(READY - 2);
    });

    it("asks straight away when the page opens after that", () => {
      expect(nextNudgeAt(job, null, 0, READY + 30)).to.equal(READY + 30);
    });

    it("follows the server's retryAt", () => {
      const last = answer("not-yet", READY - 40, { readyAt: READY, retryAt: READY - 1 });
      expect(nextNudgeAt(job, last, 0, READY - 40)).to.equal(READY - 1);
      const late = answer("not-yet", READY + 3, { retryAt: READY + 60 });
      expect(nextNudgeAt(job, late, 0, READY + 3)).to.equal(READY + 60);
    });

    it("never asks twice inside a second, whatever retryAt says", () => {
      const last = answer("not-yet", READY, { retryAt: READY - 100 });
      expect(nextNudgeAt(job, last, 0, READY)).to.equal(READY + 1);
    });

    it("backs off 5, 10, 20, then 30 seconds after failures in a row", () => {
      const t = READY + 5;
      const failed = answer("failed", t);
      expect([1, 2, 3, 4, 5, 9].map((n) => nextNudgeAt(job, failed, n, t)! - t)).to.deep.equal([5, 10, 20, 30, 30, 30]);
    });

    it("waits for the later of the backoff and the server's retryAt", () => {
      const t = READY + 5;
      expect(nextNudgeAt(job, answer("failed", t, { retryAt: t + 60 }), 1, t)).to.equal(t + 60);
      expect(nextNudgeAt(job, answer("failed", t, { retryAt: t + 2 }), 3, t)).to.equal(t + 20);
    });

    it("looks again ten seconds after a send or finding it done", () => {
      expect(AFTER_SENT_SECS).to.equal(10);
      for (const state of ["sent", "done"] as const) {
        expect(nextNudgeAt(job, answer(state, READY + 2), 0, READY + 2)).to.equal(READY + 12);
      }
    });

    it("stops 900 seconds after the price could exist", () => {
      expect(GIVE_UP_SECS).to.equal(900);
      const last = answer("failed", READY + 890);
      expect(nextNudgeAt(job, last, 4, READY + 890)).to.equal(null); // the backoff would land past the stop
      expect(nextNudgeAt(job, null, 0, READY + 899)).to.equal(READY + 899);
      expect(nextNudgeAt(job, null, 0, READY + 900)).to.equal(null);
    });

    it("gives a page that opened late its own fifteen minutes", () => {
      const since = READY + 3_600;
      const late: NudgeJob = { ...job, since };
      expect(nextNudgeAt(late, null, 0, since)).to.equal(since);
      expect(nextNudgeAt(late, null, 0, since + 899)).to.equal(since + 899);
      expect(nextNudgeAt(late, null, 0, since + 900)).to.equal(null);
    });

    it("stops when there is no job, the market is shut, or the server says never", () => {
      expect(nextNudgeAt(null, null, 0, READY)).to.equal(null);
      expect(nextNudgeAt({ kind: "start", shut: ["TSLA"] }, null, 0, READY)).to.equal(null);
      expect(nextNudgeAt({ kind: "start", never: ["TSLA"], refundAt: READY + 604_800 }, null, 0, READY)).to.equal(null);
      for (const state of ["not-found", "disabled", "refused", "never-priced"] as const) {
        expect(nextNudgeAt(job, answer(state, READY), 0, READY), state).to.equal(null);
      }
    });

    it("checks back slowly when the server sees a shut market the page does not", () => {
      expect(nextNudgeAt(job, answer("waiting-for-market", READY), 0, READY)).to.equal(READY + 30);
      expect(nextNudgeAt(job, answer("nothing-due", READY), 0, READY)).to.equal(READY + 10);
    });
  });

  describe("nudgeJobFor", () => {
    const PERP = "01".repeat(32);
    const EXCH = "03".repeat(32);
    const markets: MarketLookup = (feed) =>
      ({
        [PERP]: { symbol: "PERP", market: "US", perp: "xyz:PERP" },
        [EXCH]: { symbol: "EXCH", market: "US" },
      })[feed];
    const duel = (status: number, boundary: number, feed = PERP) => ({
      status,
      creatorFeed: feed,
      opponentFeed: PERP,
      creatorSource: SOURCE_SIGNED,
      opponentSource: SOURCE_SIGNED,
      acceptedTs: boundary - START_DELAY_SECS,
      endTs: boundary + 300,
    });

    it("gives an accepted fight a start at its bar's close", () => {
      const b = ny(14, 1, 56, 32);
      expect(nudgeJobFor(duel(STATUS_ACCEPTED, b), b, { lookup: markets, since: b })).to.deep.equal({
        kind: "start",
        readyAt: firstBarEnd(b) + BAR_SETTLE_SECS,
        since: b,
      });
    });

    it("knows a live fight's settle time before its bell, so the page is ready at it", () => {
      const b = ny(14, 1, 56, 32);
      const d = duel(STATUS_LIVE, b);
      const j = nudgeJobFor(d, b + 10, { lookup: markets });
      expect(j).to.deep.include({ kind: "settle", readyAt: firstBarEnd(d.endTs) + BAR_SETTLE_SECS });
      expect(nextNudgeAt(j, null, 0, b + 10)).to.equal(firstBarEnd(d.endTs) + BAR_SETTLE_SECS - 2);
    });

    it("has nothing for an open or finished fight", () => {
      expect(nudgeJobFor(duel(STATUS_OPEN, READY), READY, { lookup: markets })).to.equal(null);
      expect(nudgeJobFor(duel(STATUS_SETTLED, READY), READY, { lookup: markets })).to.equal(null);
    });

    it("dates a refund to when the page first saw it", () => {
      expect(nudgeJobFor(duel(STATUS_VOID, READY), READY + 50, { since: READY + 7 })).to.deep.equal({
        kind: "refund",
        readyAt: READY + 7,
        since: READY + 7,
      });
    });

    it("parks a side whose market is shut, and dates it to the reopening once it opens", () => {
      const b = ny(12, 14, 0); // Saturday
      const d = duel(STATUS_ACCEPTED, b, EXCH);
      expect(nudgeJobFor(d, ny(13, 12, 0), { lookup: markets })).to.deep.equal({ kind: "start", shut: ["EXCH"] });
      const monday = ny(14, 4, 7);
      const j = nudgeJobFor(d, monday, { lookup: markets, since: monday });
      // Due from 4:01:20 on Monday, when the exchange's first bar is final, not from "now".
      expect(j).to.deep.equal({ kind: "start", readyAt: ny(14, 4, 1, 20), since: monday });
    });

    /* A Pyth side whose boundary fell in Pyth's weekend gap has no price and
     * never will: the page asks the server nothing, on Sunday or on Monday. */
    it("gives a fight nothing will ever price no time to ask at, only when its refund opens", () => {
      const PYTH = "04".repeat(32);
      const lookup: MarketLookup = (feed) => (feed === PYTH ? { symbol: "TSLA", market: "US" } : markets(feed));
      const b = ny(12, 14, 0);
      const d = { ...duel(STATUS_ACCEPTED, b), creatorFeed: PYTH, creatorSource: SOURCE_PYTH };
      for (const now of [ny(13, 12, 0), ny(14, 9, 30)]) {
        const j = nudgeJobFor(d, now, { lookup });
        expect(j).to.deep.equal({ kind: "start", never: ["TSLA"], refundAt: d.acceptedTs + STALL_REFUND_SECS });
        expect(nextNudgeAt(j, null, 0, now)).to.equal(null);
      }
    });
  });
});
