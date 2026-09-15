/* The fight page's time words. "Prices from" must be the second the round
 * clock will count down to once the market opens, never a second answer of its
 * own, and a pair that trades around the clock never waits at all. */

import { expect } from "chai";

import {
  OUTCOME_CREATOR,
  OUTCOME_TIE,
  SOURCE_PYTH,
  SOURCE_SIGNED,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
} from "../src/lib/duel";
import { leadWords, pricesFrom, roundWords, tabTitle } from "../src/lib/fightClock";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import { firstBarEnd, PYTH_GRACE_SECS, type MarketLookup } from "../src/lib/priceClock";
import { LANDING_SECS, roundClock, type RoundClockDuel } from "../src/lib/roundClock";

const ny = (day: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(2026, 9, day, hh, mm, ss) / 1000);

const FEED = {
  perp: "01".repeat(32),
  pool: "02".repeat(32),
  exchange: "03".repeat(32),
  pyth: "04".repeat(32),
};
const markets: MarketLookup = (feed) =>
  ({
    [FEED.perp]: { symbol: "PERP", market: "US", perp: "xyz:PERP" },
    [FEED.pool]: { symbol: "POOL", market: "US", pool: "somepool" },
    [FEED.exchange]: { symbol: "EXCH", market: "US" },
    [FEED.pyth]: { symbol: "PYTH", market: "US" },
  })[feed];

const fight = (
  status: number,
  boundary: number,
  creator: { feed: string; source: number },
  opponent = creator,
): RoundClockDuel => ({
  status,
  creatorFeed: creator.feed,
  opponentFeed: opponent.feed,
  creatorSource: creator.source,
  opponentSource: opponent.source,
  acceptedTs: boundary - START_DELAY_SECS,
  endTs: boundary + 300,
});

const EXCH = { feed: FEED.exchange, source: SOURCE_SIGNED };
const PERP = { feed: FEED.perp, source: SOURCE_SIGNED };
const POOL = { feed: FEED.pool, source: SOURCE_SIGNED };
const PYTH = { feed: FEED.pyth, source: SOURCE_PYTH };

describe("fight clock", () => {
  describe("pricesFrom", () => {
    // Saturday 12 September 2026, 2pm New York: every exchange is shut.
    const SAT = ny(12, 14, 0);

    it("gives an oracle-priced stock with no perp Monday's pre-market bar", () => {
      const d = fight(STATUS_ACCEPTED, SAT, EXCH, PERP);
      const at = firstBarEnd(ny(14, 4, 0)) + BAR_SETTLE_SECS + LANDING_SECS; // 4:01:22
      expect(pricesFrom(d, ny(12, 15, 0), markets)).to.deep.equal({ which: "start", at });
      expect(at).to.equal(ny(14, 4, 1, 22));
    });

    /* A Pyth side never waits for an opening (priceClock.ts): inside Pyth's
     * hours it prices a few seconds after its boundary, and in its dark hours
     * it never prices at all, which is no time to count down to. It used to be
     * given Monday's opening bell. */
    it("never waits on a Pyth side: it prices at once in Pyth's hours, and never in its dark ones", () => {
      expect(pricesFrom(fight(STATUS_ACCEPTED, SAT, PYTH, PERP), ny(13, 9, 0), markets)).to.equal(null);
      expect(pricesFrom(fight(STATUS_ACCEPTED, SAT, PYTH, EXCH), ny(13, 9, 0), markets)).to.equal(null);
      // A Monday night before the cutover: only the exchange-only side waits, for Tuesday's 4am bar.
      const mon = ny(14, 22, 0);
      expect(pricesFrom(fight(STATUS_ACCEPTED, mon, PYTH, PERP), mon + 1, markets)).to.equal(null);
      expect(pricesFrom(fight(STATUS_ACCEPTED, mon, PYTH, EXCH), mon + 1, markets)).to.deep.equal({
        which: "start",
        at: ny(15, 4, 1, 22),
      });
      expect(ny(15, 4, 1, 22)).to.be.above(mon + PYTH_GRACE_SECS + LANDING_SECS);
    });

    it("does not wait for a pair that trades around the clock", () => {
      expect(pricesFrom(fight(STATUS_ACCEPTED, SAT, PERP, POOL), SAT + 5, markets)).to.equal(null);
    });

    it("hands over to the round clock's countdown at the same second", () => {
      const d = fight(STATUS_ACCEPTED, SAT, EXCH, PERP);
      const target = pricesFrom(d, ny(13, 20, 0), markets)!.at;
      // Saturday: no countdown from the round clock, only the wait.
      expect(roundClock(d, ny(13, 20, 0), null, markets).secondsLeft).to.equal(null);
      // Monday, the moment the pre-market opens: the round clock counts to the same second.
      const open = ny(14, 4, 0);
      expect(pricesFrom(d, open, markets)).to.equal(null);
      expect(open + roundClock(d, open, null, markets).secondsLeft!).to.equal(target);
    });

    it("waits for the bell's price when a live fight's bell rang while shut", () => {
      const fri = ny(11, 20, 30);
      const d = { ...fight(STATUS_LIVE, fri - 300, EXCH), endTs: fri };
      expect(pricesFrom(d, ny(12, 10, 0), markets)).to.deep.equal({
        which: "settle",
        at: ny(14, 4, 1, 22),
      });
      // Before the bell nothing waits: the round is running.
      expect(pricesFrom(d, fri - 10, markets)).to.equal(null);
    });

    it("says nothing on the server render or for an open challenge", () => {
      expect(pricesFrom(fight(STATUS_ACCEPTED, SAT, EXCH), 0, markets)).to.equal(null);
      expect(pricesFrom(fight(STATUS_OPEN, SAT, EXCH), SAT + 60, markets)).to.equal(null);
    });
  });

  describe("words", () => {
    it("names the round", () => {
      expect(roundWords({ durationSecs: 360, endTs: 0 })).to.equal("6 min round");
      expect(roundWords({ durationSecs: 0, endTs: ny(14, 16, 0) })).to.equal("Ends at the first price after Mon 4:00 PM ET");
    });

    it("says who leads, in percentage points, and never prints a real lead as zero", () => {
      expect(leadWords("NVDA", "AAPL", 0.42, 0.3)).to.equal("NVDA leads by 0.12 percentage points");
      expect(leadWords("NVDA", "AAPL", -0.0108, -0.0046)).to.equal("AAPL leads by 0.0062 percentage points");
      expect(leadWords("NVDA", "AAPL", 0.1, 0.1)).to.equal("Dead even");
      expect(leadWords("AAPL", "AAPL", 0.2, 0.1)).to.equal("Challenger leads by 0.10 percentage points");
      expect(leadWords("NVDA", "AAPL", null, 0.1)).to.equal(null);
    });

    it("titles the tab with the live score and the clock", () => {
      const now = ny(14, 10, 0);
      const live = { status: STATUS_LIVE, outcome: 0, expiresTs: 0, endTs: now + 252 };
      expect(tabTitle({ d: live, t1: "NVDA", t2: "AAPL", m1: 0.42, m2: -0.1, now, secondsLeft: 252 })).to.equal(
        "NVDA +0.42% vs AAPL -0.10% · 4:12",
      );
      expect(tabTitle({ d: live, t1: "NVDA", t2: "AAPL", m1: null, m2: -0.1, now, secondsLeft: 252 })).to.equal(
        "NVDA vs AAPL · 4:12",
      );
      const done = { ...live, status: STATUS_SETTLED, outcome: OUTCOME_CREATOR };
      expect(tabTitle({ d: done, t1: "NVDA", t2: "AAPL", m1: 1, m2: 0, now, secondsLeft: null })).to.equal("NVDA vs AAPL · Final");
      const open = { ...live, status: STATUS_OPEN, expiresTs: now + 60 };
      expect(tabTitle({ d: open, t1: "NVDA", t2: "AAPL", m1: null, m2: null, now, secondsLeft: null })).to.equal("NVDA vs AAPL · Open");
      const heat = { ...live, status: STATUS_REFUNDED, outcome: OUTCOME_TIE };
      expect(tabTitle({ d: heat, t1: "NVDA", t2: "AAPL", m1: 0, m2: 0, now, secondsLeft: null })).to.equal(
        "NVDA vs AAPL · Dead heat",
      );
    });
  });
});
