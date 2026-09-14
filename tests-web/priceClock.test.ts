/* The price clock's promise: it names the moment a fight's price can first
 * exist, never a moment before it, and says "shut" only when no market can
 * price a side at all. */

import { expect } from "chai";

import {
  SOURCE_PYTH,
  SOURCE_SIGNED,
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
import { byTicker } from "../src/lib/stocks";
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

    it("calls a stock with neither perp nor pool shut at a weekend, and due once its session runs", () => {
      const b = ny(12, 14, 0);
      const d = starting(signed(FEED.exchange), signed(FEED.perp), b);
      expect(readyAt(d, "start", ny(13, 10, 0), markets)).to.deep.equal({ shut: ["EXCH"] });
      const monday = ny(14, 4, 0, 5);
      expect(readyAt(d, "start", monday, markets)).to.deep.equal({ at: monday, why: "minute-close" });
    });

    it("never parks a listing whose sessions it does not model, or a feed off the roster", () => {
      const b = ny(12, 14, 0);
      const d = starting(signed(FEED.hk), signed(FEED.unlisted), b);
      expect(readyAt(d, "start", b, markets)).to.deep.equal({ at: firstBarEnd(b) + BAR_SETTLE_SECS, why: "minute-close" });
    });
  });

  describe("Pyth sides", () => {
    it("gives Pyth a few seconds past a boundary in session", () => {
      const b = ny(15, 11, 0, 10);
      const d = starting(real("TSLA", SOURCE_PYTH), real("QQQ", SOURCE_PYTH), b);
      expect(readyAt(d, "start", b)).to.deep.equal({ at: b + PYTH_GRACE_SECS, why: "pyth" });
    });

    it("parks a Pyth stock at a weekend, naming it, and wakes it when the market does", () => {
      const b = ny(12, 11, 0, 10);
      const d = starting(real("TSLA", SOURCE_PYTH), real("NVDA"), b);
      expect(readyAt(d, "start", ny(13, 23, 0))).to.deep.equal({ shut: ["TSLA"] });
      const monday = ny(14, 9, 30, 1);
      expect(readyAt(d, "start", monday)).to.deep.equal({ at: monday, why: "pyth" });
    });

    /* Pyth's regular US equity feeds print from 9:30 to 4 only; extended
     * hours are separate feeds the roster does not use. A boundary in
     * after-hours or pre-market waits for the open, not for 4am. */
    it("parks a Pyth stock in after-hours and pre-market until the opening bell", () => {
      const b = ny(11, 19, 11, 35);
      const d = starting(real("TSLA", SOURCE_PYTH), real("TSLA", SOURCE_PYTH), b);
      expect(readyAt(d, "start", b)).to.deep.equal({ shut: ["TSLA"] });
      expect(readyAt(d, "start", ny(14, 4, 0, 5))).to.deep.equal({ shut: ["TSLA"] });
      expect(readyAt(d, "start", ny(14, 9, 29, 59))).to.deep.equal({ shut: ["TSLA"] });
      const open = ny(14, 9, 30, 0);
      expect(readyAt(d, "start", open)).to.deep.equal({ at: open, why: "pyth" });
    });

    /* 4yf7, TSLA (Pyth) v NVDA, accepted on a Saturday: parked through the
     * weekend with no call anywhere, and due at Monday's open. */
    it("parks a 4yf7-like fight all weekend", () => {
      const b = ny(12, 22, 14, 0);
      const d = starting(real("TSLA", SOURCE_PYTH), real("NVDA"), b);
      for (const now of [b, ny(13, 12, 0), ny(14, 3, 59), ny(14, 8, 0)]) {
        expect(readyAt(d, "start", now)).to.deep.equal({ shut: ["TSLA"] });
      }
      const open = ny(14, 9, 30, 2);
      expect(readyAt(d, "start", open)).to.deep.equal({ at: open, why: "pyth" });
    });

    it("lists every shut side once", () => {
      const b = ny(12, 11, 0);
      const d = starting(real("TSLA", SOURCE_PYTH), real("TSLA", SOURCE_PYTH), b);
      expect(readyAt(d, "start", b)).to.deep.equal({ shut: ["TSLA"] });
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
