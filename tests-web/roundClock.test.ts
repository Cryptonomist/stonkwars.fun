/* The round clock's promises: it counts down to the moment a fight's price can
 * exist and says what it waits on, it never offers the manual button before
 * the settler has had MANUAL_FALLBACK_SECS past that moment, and it reads the
 * server's time when the nudge has measured the skew. */

import { expect } from "chai";

import {
  SOURCE_PYTH,
  SOURCE_SIGNED,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_SETTLED,
} from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import { firstBarEnd, MANUAL_FALLBACK_SECS, PYTH_GRACE_SECS, type MarketLookup } from "../src/lib/priceClock";
import { MANUAL_SETTLE, MANUAL_START, roundClock, type RoundClockDuel } from "../src/lib/roundClock";

const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const ny = (day: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(2026, 9, day, hh, mm, ss) / 1000);

const FEED = {
  perp: "01".repeat(32),
  pool: "02".repeat(32),
  exchange: "03".repeat(32),
  crypto: "05".repeat(32),
};
const markets: MarketLookup = (feed) =>
  ({
    [FEED.perp]: { symbol: "PERP", market: "US", perp: "xyz:PERP" },
    [FEED.pool]: { symbol: "POOL", market: "US", pool: "somepool" },
    [FEED.exchange]: { symbol: "EXCH", market: "US" },
  })[feed];

const fight = (status: number, boundary: number, feed = FEED.perp, source = SOURCE_SIGNED): RoundClockDuel => ({
  status,
  creatorFeed: feed,
  opponentFeed: feed,
  creatorSource: source,
  opponentSource: source,
  acceptedTs: boundary - START_DELAY_SECS,
  endTs: boundary + 300,
});

describe("round clock", () => {
  // Sunday night: every US stock is priced by its perp or pool.
  const B = utc("2026-09-14T01:56:32Z");
  const READY = firstBarEnd(B) + BAR_SETTLE_SECS; // 01:57:20

  describe("accepted", () => {
    const d = fight(STATUS_ACCEPTED, B);
    const at = (t: number, nudge?: Parameters<typeof roundClock>[2]) => roundClock(d, t, nudge, markets);

    it("counts down to the minute's close, plus the seconds a crank takes to land", () => {
      expect(at(READY + 2 - 41)).to.deep.equal({
        line: "Round starts in 41s, when this minute's price closes",
        secondsLeft: 41,
        manual: null,
      });
      expect(at(B).line).to.equal("Round starts in 50s, when this minute's price closes");
    });

    it("counts down to a pool's window", () => {
      const p = fight(STATUS_ACCEPTED, B, FEED.pool);
      expect(roundClock(p, B + 10, null, markets).line).to.equal("Round starts in 12s, when the pool's last minutes are in");
    });

    it("promises a Pyth side a few seconds", () => {
      const p = fight(STATUS_ACCEPTED, B, FEED.crypto, SOURCE_PYTH);
      expect(roundClock(p, B + 1, null, markets).line).to.equal("Round starts in a few seconds, at Pyth's first price");
      expect(roundClock(p, B + PYTH_GRACE_SECS + 2, null, markets).line).to.equal("Locking the start prices");
    });

    it("keeps the existing wording while a side's market is shut", () => {
      const sat = ny(12, 14, 0);
      const p = fight(STATUS_ACCEPTED, sat, FEED.exchange);
      expect(roundClock(p, ny(13, 12, 0), null, markets)).to.deep.equal({
        line: "Fight on · waiting for the market that prices it to open",
        secondsLeft: null,
        manual: null,
      });
    });

    it("says it is locking from the price until the settler is late, and says so when a nudge failed", () => {
      expect(at(READY + 2)).to.deep.equal({ line: "Locking the start prices", secondsLeft: null, manual: null });
      expect(at(READY + MANUAL_FALLBACK_SECS - 1).manual).to.equal(null);
      expect(at(READY + 30, { state: "failed", failures: 1 }).line).to.equal("Locking the start prices · retrying");
      expect(at(READY + 30, { state: "asking", failures: 2 }).line).to.equal("Locking the start prices · retrying");
    });

    it("offers the manual start only 180 seconds after the price exists", () => {
      expect(MANUAL_FALLBACK_SECS).to.equal(180);
      // The old page offered it at the accept plus about 22 seconds.
      for (let t = d.acceptedTs; t < READY + 180; t += 7) expect(at(t).manual, `at +${t - READY}`).to.equal(null);
      expect(at(READY + 180)).to.deep.equal({
        line: "The settler is late. Anyone can lock the start prices.",
        secondsLeft: null,
        manual: MANUAL_START,
      });
    });

    it("explains what signing the manual start does and costs", () => {
      expect(MANUAL_START.label).to.equal("Lock the start prices yourself");
      expect(MANUAL_START.explain).to.equal(
        "Your wallet signs one transaction (three if a side is priced by Pyth). It posts the market's prices for this moment and starts the round. Network fee about 0.00002 SOL. The prices and the result are the same whoever posts them.",
      );
    });

    it("reads the server's clock when the nudge measured a skew", () => {
      // This device is 5 seconds slow: its READY + 175 is the server's READY + 180.
      expect(at(READY + 175).manual).to.equal(null);
      expect(at(READY + 175, { skew: 5 }).manual).to.equal(MANUAL_START);
      expect(at(READY + 2 - 41 - 5, { skew: 5 }).secondsLeft).to.equal(41);
    });

    it("dates a side that waited for its market to the reopening, so the button still comes", () => {
      const sat = ny(12, 14, 0);
      const p = fight(STATUS_ACCEPTED, sat, FEED.exchange);
      // The exchange's day starts at 4:00 on Monday; readyAt alone would say "now" forever.
      expect(roundClock(p, ny(14, 4, 2), null, markets)).to.deep.equal({ line: "Locking the start prices", secondsLeft: null, manual: null });
      expect(roundClock(p, ny(14, 4, 2, 59), null, markets).manual).to.equal(null);
      expect(roundClock(p, ny(14, 4, 3), null, markets).manual).to.equal(MANUAL_START);
    });

    it("says nothing on the server render, where the page's clock is 0", () => {
      expect(at(0)).to.deep.equal({ line: "", secondsLeft: null, manual: null });
    });
  });

  describe("live", () => {
    // A bell on the minute, so the result waits a whole bar: 80 seconds.
    const d = { ...fight(STATUS_LIVE, B), endTs: utc("2026-09-14T02:12:00Z") };
    const END_READY = firstBarEnd(d.endTs) + BAR_SETTLE_SECS;
    const at = (t: number, nudge?: Parameters<typeof roundClock>[2]) => roundClock(d, t, nudge, markets);

    it("counts to the bell with no button", () => {
      expect(at(d.endTs - 90)).to.deep.equal({ line: "Round live", secondsLeft: 90, manual: null });
    });

    it("says what the result waits on after the bell", () => {
      expect(at(END_READY + 2 - 58)).to.deep.equal({
        line: "Bell rang. Result in 58s, when the minute after the bell is final",
        secondsLeft: 58,
        manual: null,
      });
    });

    it("settles, then offers the manual settle 180 seconds after the price exists", () => {
      expect(at(END_READY + 2).line).to.equal("Settling");
      expect(at(END_READY + 40, { state: "failed", failures: 1 }).line).to.equal("Settling · retrying");
      expect(at(END_READY + 179).manual).to.equal(null);
      expect(at(END_READY + 180)).to.deep.equal({
        line: "The settler is late. Anyone can settle it.",
        secondsLeft: null,
        manual: MANUAL_SETTLE,
      });
    });

    it("tells a settler about the rent a payout account can cost", () => {
      expect(MANUAL_SETTLE.label).to.equal("Settle it yourself");
      expect(MANUAL_SETTLE.explain).to.include(
        "plus about 0.002 SOL of account rent for each player who has no account for a stock they receive",
      );
    });

    it("keeps the existing wording after a bell whose market is shut", () => {
      const fri = ny(11, 19, 0) - 300; // a bell at 7pm on a Friday
      const p = { ...fight(STATUS_LIVE, fri, FEED.exchange), endTs: ny(11, 20, 30) };
      expect(roundClock(p, ny(12, 9, 0), null, markets).line).to.equal("Bell rung · waiting for the market that prices it to open");
    });
  });

  it("has nothing to say about an open or finished fight", () => {
    for (const status of [STATUS_OPEN, STATUS_SETTLED]) {
      expect(roundClock(fight(status, B), B + 1_000, null, markets)).to.deep.equal({ line: "", secondsLeft: null, manual: null });
    }
  });

  it("uses no em dash anywhere a visitor reads", () => {
    for (const text of [MANUAL_START.label, MANUAL_START.explain, MANUAL_SETTLE.label, MANUAL_SETTLE.explain]) {
      expect(text).to.not.include("\u2014");
    }
  });
});
