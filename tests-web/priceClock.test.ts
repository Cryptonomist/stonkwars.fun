/* The price clock's promise: it names the moment a fight's price can first
 * exist, never a moment before it, and says "shut" only when no market can
 * price a side at all. */

import { expect } from "chai";

import {
  SOURCE_PYTH,
  SOURCE_SIGNED,
  STALL_REFUND_SECS,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
} from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS } from "../src/lib/oracle";
import {
  firstBarEnd,
  jobFor,
  PYTH_GRACE_SECS,
  readyAt,
  type ClockDuel,
  type MarketLookup,
} from "../src/lib/priceClock";
import { byTicker, quoteSymbolFor } from "../src/lib/stocks";
import history from "./fixtures/settler-ops.json";

const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/** A New York wall-clock time in September 2026: the 11th is a Friday, the
 *  12th and 13th the weekend, the 14th a Monday, the 15th a Tuesday. */
const ny = (day: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(2026, 9, day, hh, mm, ss) / 1000);

type Side = { feed: string; source: number };

/** A duel whose start boundary is `boundary`. */
const starting = (a: Side, b: Side, boundary: number): ClockDuel => ({
  creatorFeed: a.feed,
  creatorSource: a.source,
  opponentFeed: b.feed,
  opponentSource: b.source,
  acceptedTs: boundary - START_DELAY_SECS,
  endTs: boundary + 3_600,
});

/** A duel whose bell is `endTs`. */
const settling = (a: Side, b: Side, endTs: number): ClockDuel => ({ ...starting(a, b, endTs - 3_600), endTs });

/* Markets of each kind, so the rules can be read without depending on which
 * real stock has which market this week. The real roster is used where the
 * case is a real fight. */
const FEED = {
  perp: "01".repeat(32),
  pool: "02".repeat(32),
  exchange: "03".repeat(32),
  hk: "04".repeat(32),
  crypto: "05".repeat(32),
  unlisted: "06".repeat(32),
};
const markets: MarketLookup = (feed) =>
  ({
    [FEED.perp]: { symbol: "PERP", market: "US", perp: "xyz:PERP" },
    [FEED.pool]: { symbol: "POOL", market: "US", pool: "somepool" },
    [FEED.exchange]: { symbol: "EXCH", market: "US" },
    [FEED.hk]: { symbol: "0700.HK", market: "HK" },
  })[feed];

const signed = (feed: string): Side => ({ feed, source: SOURCE_SIGNED });
const pythFeed = (feed: string): Side => ({ feed, source: SOURCE_PYTH });
const real = (ticker: string, source = SOURCE_SIGNED): Side => ({ feed: byTicker(ticker)!.feed, source });

describe("price clock", () => {
  it("finds the end of the bar a boundary falls in", () => {
    expect(firstBarEnd(120)).to.equal(180); // on the minute: that minute's bar
    expect(firstBarEnd(121)).to.equal(180);
    expect(firstBarEnd(179)).to.equal(180);
  });

  describe("bar-priced sides", () => {
    /* AAPL v MSFT (Av9kkw), accepted on a Sunday night. The page asked for a
     * signature at 01:56:54; the price could not exist before 01:57:20. */
    it("puts a perp start at 01:56:32 at 01:57:20", () => {
      const b = utc("2026-09-14T01:56:32Z");
      const d = starting(real("AAPL"), real("MSFT"), b);
      expect(readyAt(d, "start", b)).to.deep.equal({ at: utc("2026-09-14T01:57:20Z"), why: "minute-close" });
    });

    it("puts a bell at 02:12:00 at 02:13:20, a whole bar later", () => {
      const end = utc("2026-09-14T02:12:00Z");
      const d = settling(signed(FEED.perp), signed(FEED.perp), end);
      expect(readyAt(d, "settle", end + 5, markets)).to.deep.equal({ at: utc("2026-09-14T02:13:20Z"), why: "minute-close" });
    });

    /* Accepting at :58 puts the boundary on the next minute, which starts a
     * fresh bar: the unluckiest second to accept, and the clock must say so
     * rather than promise the bar that was already closing. */
    it("makes an accept at :58 wait 62s for its bar, plus the settle time", () => {
      const accepted = utc("2026-09-14T02:20:58Z");
      const d = { ...starting(signed(FEED.perp), signed(FEED.perp), 0), acceptedTs: accepted };
      expect((readyAt(d, "start", accepted, markets) as { at: number }).at).to.equal(accepted + 62 + BAR_SETTLE_SECS);

      const early = utc("2026-09-14T02:20:05Z");
      const e = { ...d, acceptedTs: early };
      expect((readyAt(e, "start", early, markets) as { at: number }).at).to.equal(early + 55 + BAR_SETTLE_SECS);
    });

    it("reads the exchange's own bar in session, at the same rule", () => {
      const b = ny(15, 12, 0, 30);
      const d = starting(signed(FEED.exchange), signed(FEED.exchange), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: firstBarEnd(b) + BAR_SETTLE_SECS, why: "minute-close" });
    });

    it("gives a pool its window as soon as the boundary has settled", () => {
      const b = ny(12, 14, 3, 17);
      const d = starting(signed(FEED.pool), signed(FEED.pool), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: b + BAR_SETTLE_SECS, why: "pool-window" });
    });

    it("waits for the later of two sides", () => {
      const b = ny(12, 14, 3, 17);
      const d = starting(signed(FEED.pool), signed(FEED.perp), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: firstBarEnd(b) + BAR_SETTLE_SECS, why: "minute-close" });
    });

    it("calls a stock with neither perp nor pool shut at a weekend, and due at its first bar once its session runs", () => {
      const b = ny(12, 14, 0);
      const d = starting(signed(FEED.exchange), signed(FEED.perp), b);
      expect(readyAt(d, "start", ny(13, 10, 0), markets)).to.deep.equal({ shut: ["EXCH"] });
      expect(readyAt(d, "start", ny(14, 3, 59, 59), markets)).to.deep.equal({ shut: ["EXCH"] });
      // Monday's first bar, 4:00 to 4:01, is final at 4:01:20, whatever the clock says now.
      const first = { at: ny(14, 4, 1, 20), why: "minute-close" };
      for (const now of [ny(14, 4, 0), ny(14, 4, 0, 5), ny(14, 12, 0)]) {
        expect(readyAt(d, "start", now, markets)).to.deep.equal(first);
      }
    });

    /* NFLX-like, no perp or pool, accepted on a Saturday. Monday's session
     * priced it and nobody cranked it (the settler was down all day). At 9pm
     * Monday the exchange is shut again, but the price has existed since 4:01
     * that morning: the fight is due, not parked until Tuesday. */
    it("keeps a side due once its price has appeared, after its session has shut again", () => {
      const b = ny(12, 12, 0);
      const d = starting(signed(FEED.exchange), signed(FEED.exchange), b);
      expect(readyAt(d, "start", ny(14, 21, 0), markets)).to.deep.equal({ at: ny(14, 4, 1, 20), why: "minute-close" });
      expect(readyAt(d, "start", ny(15, 2, 0), markets)).to.deep.equal({ at: ny(14, 4, 1, 20), why: "minute-close" });
    });

    it("never parks a listing whose sessions it does not model, or a feed off the roster", () => {
      const b = ny(12, 14, 0);
      const d = starting(signed(FEED.hk), signed(FEED.unlisted), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: firstBarEnd(b) + BAR_SETTLE_SECS, why: "minute-close" });
    });
  });

  /* Pyth prints US equities 24/5 (market.ts, pythSpanAt): a Pyth side is
   * priced a moment after any boundary inside that, and never at all outside
   * it. It never waits for an opening, so it is never "shut". */
  describe("Pyth sides", () => {
    const tsla = () => real("TSLA", SOURCE_PYTH);
    /* Against a feed off the roster, which prices a few seconds after any
     * boundary, so the clock's answer is TSLA's own: a signed side's bar would
     * be the later of the two and hide it. */
    const alone = (b: number) => starting(tsla(), pythFeed(FEED.crypto), b);
    const inGrace = (b: number) => ({ at: b + PYTH_GRACE_SECS, why: "pyth" });
    const never = (d: ClockDuel, which: "start" | "settle", tickers = ["TSLA"]) => ({
      never: tickers,
      refundAt: (which === "start" ? d.acceptedTs : d.endTs) + STALL_REFUND_SECS,
    });

    it("gives Pyth a few seconds past a boundary in session", () => {
      const b = ny(15, 11, 0, 10);
      const d = starting(real("TSLA", SOURCE_PYTH), real("QQQ", SOURCE_PYTH), b);
      expect(readyAt(d, "start", b)).to.deep.equal({ at: b + PYTH_GRACE_SECS, why: "pyth" });
    });

    /* The old clock parked these until the opening bell, and a fight taken at
     * 8am on a Monday sat there while Pyth was printing every second. */
    it("prices a Pyth side at once in pre-market, after-hours and on a weekday night", () => {
      // Thu 10 Sep 3:59:59 AM New York is 07:59:59 UTC, one of the moments Hermes was asked about.
      for (const b of [ny(14, 8, 0), ny(11, 19, 11, 35), ny(15, 22, 0), ny(10, 3, 59, 59), utc("2026-09-10T07:59:59Z")]) {
        expect(readyAt(alone(b), "start", b), new Date(b * 1000).toISOString()).to.deep.equal(inGrace(b));
      }
      // Against NVDA's perp the fight waits on NVDA's bar, as ever, and TSLA never makes it shut.
      const b = ny(15, 22, 0, 10);
      expect(readyAt(starting(tsla(), real("NVDA"), b), "start", b)).to.deep.equal({
        at: firstBarEnd(b) + BAR_SETTLE_SECS,
        why: "minute-close",
      });
    });

    it("never calls a side shut whose boundary is in session, even before the boundary", () => {
      const b = ny(15, 15, 59, 30); // a bell
      const d = settling(real("TSLA", SOURCE_PYTH), real("QQQ", SOURCE_PYTH), b);
      expect(readyAt(d, "settle", b - 30)).to.deep.equal({ at: b + PYTH_GRACE_SECS, why: "pyth" });
    });

    /* Friday's last print is 7:59:59 PM. A boundary before it is priced by the
     * print after it, so a fight already there is cranked; the pages refuse
     * the last minute (stocks.test.ts), which is a margin, not a gap. */
    it("prices a Friday boundary to the last second, and calls the weekend never", () => {
      // TSLA's boundary at Fri 7:58:59 PM, the last minute, and the last second.
      for (const b of [ny(11, 19, 58, 59), ny(11, 19, 59, 30), ny(11, 19, 59, 59)]) {
        expect(readyAt(alone(b), "start", b), new Date(b * 1000).toISOString()).to.deep.equal(inGrace(b));
      }
      // Friday 8 PM, Saturday, and the last second before Sunday's reopening.
      for (const b of [ny(11, 20, 0), ny(12, 12, 0), ny(13, 19, 59, 59)]) {
        const d = alone(b);
        expect(readyAt(d, "start", b), new Date(b * 1000).toISOString()).to.deep.equal(never(d, "start"));
      }
    });

    /* The first print after the gap claims a previous print one second before
     * it, and VOO's first was 8:00:01: a boundary in the first minute is never
     * priced. */
    it("calls a boundary in Sunday's first minute never, and prices one from 8:01", () => {
      for (const b of [ny(13, 20, 0), ny(13, 20, 0, 1), ny(13, 20, 0, 30), ny(13, 20, 0, 59)]) {
        const d = alone(b);
        expect(readyAt(d, "start", b), new Date(b * 1000).toISOString()).to.deep.equal(never(d, "start"));
      }
      const b = ny(13, 20, 1, 0);
      expect(readyAt(alone(b), "start", b)).to.deep.equal(inGrace(b));
    });

    it("knows Labor Day had no Sunday night: never on Sunday 6 Sep, priced from Monday 7 Sep 8:01 PM", () => {
      for (const b of [ny(6, 21, 0), ny(7, 12, 0), ny(7, 20, 0, 30)]) {
        const d = alone(b);
        expect(readyAt(d, "start", ny(8, 12, 0)), new Date(b * 1000).toISOString()).to.deep.equal(never(d, "start"));
      }
      const b = ny(7, 20, 1);
      expect(readyAt(alone(b), "start", b)).to.deep.equal(inGrace(b));
    });

    /* The decision is the boundary's alone: a Pyth side is never "shut", so
     * nothing a clock does later turns never into due or due into never. */
    it("gives the same answer for a Pyth boundary whenever it is asked", () => {
      const dark = alone(ny(12, 12, 0));
      const lit = alone(ny(14, 22, 0));
      for (const now of [ny(12, 12, 0), ny(13, 20, 5), ny(14, 9, 30), ny(15, 2, 0), ny(30, 12, 0)]) {
        expect(readyAt(dark, "start", now)).to.deep.equal(never(dark, "start"));
        expect(readyAt(lit, "start", now)).to.deep.equal(inGrace(ny(14, 22, 0)));
      }
    });

    /* 4yf7Hpjh33t8qJ4TqwnQSM5s2Pr6SCH3712MbT4yono5, as devnet holds it on 14
     * Sep: TSLA by Pyth v NVDA signed, accepted_ts 1789179709 (Friday 11 Sep
     * 10:21:49 PM New York), never started. Its start fell two hours into the
     * weekend gap. Nothing will ever price it, whenever anyone looks, and the
     * stall refund opens a week after the accept: Friday 18 Sep, 10:21:49 PM. */
    it("reads the live stuck fight 4yf7 as never priced, refundable a week after its accept", () => {
      const d: ClockDuel = {
        creatorFeed: byTicker("TSLA")!.feed,
        creatorSource: SOURCE_PYTH,
        opponentFeed: byTicker("NVDA")!.feed,
        opponentSource: SOURCE_SIGNED,
        acceptedTs: 1_789_179_709,
        endTs: 0,
      };
      expect(STALL_REFUND_SECS).to.equal(7 * 86_400);
      const refundAt = utc("2026-09-19T02:21:49Z");
      expect(refundAt).to.equal(ny(18, 22, 21, 49));
      for (const now of [d.acceptedTs + 2, ny(13, 12, 0), ny(14, 9, 30, 5), ny(15, 12, 0), refundAt + 1]) {
        expect(readyAt(d, "start", now)).to.deep.equal({ never: ["TSLA"], refundAt });
      }
    });

    it("counts a live fight's refund from its bell, when the bell fell where Pyth is dark", () => {
      const d = settling(tsla(), real("NVDA"), ny(12, 9, 0));
      expect(readyAt(d, "settle", ny(12, 9, 5))).to.deep.equal({ never: ["TSLA"], refundAt: d.endTs + STALL_REFUND_SECS });
    });

    it("says never over shut, and lists every side nothing will price once", () => {
      const b = ny(12, 11, 0);
      expect(readyAt(starting(tsla(), signed(FEED.exchange), b), "start", b, (feed) => markets(feed) ?? quoteSymbolFor(feed))).to.deep.equal(
        never(starting(tsla(), signed(FEED.exchange), b), "start"),
      );
      const d = starting(tsla(), tsla(), b);
      expect(readyAt(d, "start", b)).to.deep.equal(never(d, "start"));
      const both = starting(tsla(), real("QQQ", SOURCE_PYTH), b);
      expect(readyAt(both, "start", b)).to.deep.equal(never(both, "start", ["TSLA", "QQQ"]));
    });

    it("never parks a Pyth feed off the roster, which is crypto and prints all weekend", () => {
      const b = ny(12, 3, 0);
      const d = starting(pythFeed(FEED.crypto), pythFeed(FEED.crypto), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: b + PYTH_GRACE_SECS, why: "pyth" });
    });
  });

  /* EVERY START AND SETTLE THE CHAIN HAS, CHECKED AGAINST THE CLOCK.
   *
   * 51 operations on devnet from 09-11 to 09-14, with the price source each
   * side used then and the moment its price became available (the signed
   * quote's publish time plus the settle time). The clock must name exactly
   * that moment, and nothing may have landed before it.
   *
   * The rows name a side's source, not its feed, so each side here is a market
   * of that kind. Every Pyth side in them is priced by test BTC, which the
   * roster does not list; the "test-crypto" sides were signed quotes for test
   * ETH and SOL, which it does not list either. */
  describe("against the chain's history", () => {
    const sideFor = (src: string): Side => {
      if (src === "pyth") return pythFeed(FEED.crypto);
      if (src === "perp?") return signed(FEED.perp);
      if (src === "pool") return signed(FEED.pool);
      if (src === "exchange") return signed(FEED.exchange);
      if (src.startsWith("test-crypto")) return signed(FEED.unlisted);
      throw new Error(`unknown source in fixture: ${src}`);
    };

    it("has the rows it expects", () => {
      expect(history.length).to.equal(51);
    });

    for (const row of history) {
      it(`${row.duel} ${row.kind} (${row.ny} New York, ${row.srcs.join(" v ")})`, () => {
        const [a, b] = row.srcs.map(sideFor);
        const which = row.kind as "start" | "settle";
        const d = which === "start" ? starting(a, b, row.boundary) : settling(a, b, row.boundary);
        const got = readyAt(d, which, row.boundary, markets);
        expect(got).to.have.property("at", row.avail);
        expect(row.landed).to.be.at.least((got as { at: number }).at);
      });
    }
  });

  describe("jobFor", () => {
    const base = { acceptedTs: 1_000, endTs: 2_000 };

    it("starts an accepted fight, at its start boundary", () => {
      expect(jobFor({ ...base, status: STATUS_ACCEPTED }, 1_001)).to.deep.equal({
        kind: "start",
        boundary: 1_000 + START_DELAY_SECS,
      });
    });

    it("settles a live fight once the bell has rung, and not before", () => {
      expect(jobFor({ ...base, status: STATUS_LIVE }, 1_999)).to.equal(null);
      expect(jobFor({ ...base, status: STATUS_LIVE }, 2_000)).to.deep.equal({ kind: "settle", boundary: 2_000 });
    });

    it("refunds a void fight now", () => {
      expect(jobFor({ ...base, status: STATUS_VOID }, 5_000)).to.deep.equal({ kind: "refund", boundary: 5_000 });
    });

    it("has nothing to do for an open, settled or refunded fight", () => {
      for (const status of [STATUS_OPEN, STATUS_SETTLED, STATUS_REFUNDED]) {
        expect(jobFor({ ...base, status }, 9_999)).to.equal(null);
      }
    });
  });
});
