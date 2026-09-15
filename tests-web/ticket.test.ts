import { expect } from "chai";

import { nextBell, nyToMs, session, weekBell } from "../src/lib/market";
import { stakeForDollars, stakeValue } from "../src/lib/pricemath";
import { MIN_OFFHOURS_ROUND_SECS } from "../src/lib/composite";
import { mixedHoursAt, pricedAt, STAKE_DECIMALS, tooShortOffHours, tradesAroundTheClock } from "../src/lib/stocks";
import {
  allDayPair,
  ctaStep,
  defaultPair,
  roundChoices,
  shortestRoundAtLeast,
  ticketFromParams,
  winPreview,
} from "../src/lib/ticket";

/** A New York wall-clock time, in unix seconds. */
const ny = (y: number, m: number, d: number, hh: number, mm: number) => Math.floor(nyToMs(y, m, d, hh, mm) / 1000);

/* September 2026: the 12th is a Saturday, the 14th a Monday, the 18th a
 * Friday. */
const SATURDAY_NOON = ny(2026, 9, 12, 12, 0);
const MONDAY_2PM = ny(2026, 9, 14, 14, 0);
const MONDAY_9PM = ny(2026, 9, 14, 21, 0);
const MONDAY_6AM = ny(2026, 9, 14, 6, 0);

/* A roster with the usual pair missing, so the fallback has something to do:
 * VOO is priced by Pyth and never fights around the clock, the rest do. */
const NO_AAPL = ["VOO", "NVDA", "SPY", "MSFT"];

describe("the pair /new opens on", () => {
  it("is two stocks that trade around the clock when the exchange is shut", () => {
    expect(session(SATURDAY_NOON * 1000)).to.equal("closed");
    const [a, b] = defaultPair(SATURDAY_NOON);
    expect(a).to.not.equal(b);
    expect(tradesAroundTheClock(a)).to.equal(true);
    expect(tradesAroundTheClock(b)).to.equal(true);
  });

  it("opens a weekend fight with no warning: neither side waits and the pair can be made", () => {
    const [a, b] = defaultPair(SATURDAY_NOON);
    for (const secs of [300, 900, 3_600]) {
      expect(pricedAt(a, SATURDAY_NOON + secs)).to.not.equal("waits");
      expect(pricedAt(b, SATURDAY_NOON + secs)).to.not.equal("waits");
      expect(mixedHoursAt(a, b, SATURDAY_NOON, { durationSecs: secs, endTs: 0 })).to.equal(null);
    }
  });

  it("is AAPL against NVDA on a weekday afternoon, the shipped default", () => {
    expect(defaultPair(MONDAY_2PM)).to.deep.equal(["AAPL", "NVDA"]);
  });

  it("stays AAPL against NVDA at night and before the open, because both trade around the clock", () => {
    expect(defaultPair(MONDAY_9PM)).to.deep.equal(["AAPL", "NVDA"]);
    expect(defaultPair(MONDAY_6AM)).to.deep.equal(["AAPL", "NVDA"]);
  });

  it("falls back to the first two around-the-clock stocks when shut, and the first two otherwise", () => {
    expect(defaultPair(SATURDAY_NOON, NO_AAPL)).to.deep.equal(["NVDA", "SPY"]);
    expect(defaultPair(MONDAY_2PM, NO_AAPL)).to.deep.equal(["VOO", "NVDA"]);
  });
});

describe("use two 24/7 stocks", () => {
  it("keeps a side that already trades around the clock and replaces the one that waits", () => {
    expect(allDayPair(["MSFT", "VOO"])).to.deep.equal(["MSFT", "AAPL"]);
    expect(allDayPair(["VOO", "AAPL"])).to.deep.equal(["NVDA", "AAPL"]);
    // TSLA is the oracle's for a new fight and pinned in venues247.json, so it stays.
    expect(allDayPair(["TSLA", "VOO"])).to.deep.equal(["TSLA", "AAPL"]);
    // Asked about a moment before the cutover, a pool-priced stock still counts; from it, it does not.
    const saturdayAfter = ny(2026, 9, 19, 12, 0);
    expect(allDayPair(["KO", "VOO"], SATURDAY_NOON)).to.deep.equal(["KO", "AAPL"]);
    expect(allDayPair(["KO", "VOO"], saturdayAfter)).to.deep.equal(["AAPL", "NVDA"]);
  });

  it("never puts one stock in both corners", () => {
    const [a, b] = allDayPair(["NVDA", "NVDA"]);
    expect(a).to.not.equal(b);
    expect(tradesAroundTheClock(a) && tradesAroundTheClock(b)).to.equal(true);
  });
});

describe("the win preview", () => {
  /* Two real-looking quotes at Pyth-style exponents. */
  const q1 = { price: "33120000000", expo: -8 }; // $331.20
  const q2 = { price: "18145000000", expo: -8 }; // $181.45

  it("pays back the stake and the other side's, exactly as stakeForDollars sizes them", () => {
    const cents = BigInt(2_500);
    const a1 = stakeForDollars(cents, q1, STAKE_DECIMALS);
    const a2 = stakeForDollars(cents, q2, STAKE_DECIMALS);
    const w = winPreview(a1, a2, "AAPL", "NVDA", q2);
    expect(w.keep).to.equal("0.0755 AAPLx");
    expect(w.take).to.equal("0.1378 NVDAx");
    expect(w.takeUsd).to.equal(stakeValue(a2, STAKE_DECIMALS, q2));
    expect(w.takeUsd!).to.be.within(24.99, 25);
  });

  it("keeps the token's own case", () => {
    const w = winPreview(BigInt(1), BigInt(1), "NVDA", "AAPL", undefined);
    expect(w.keep).to.match(/NVDAx$/);
    expect(w.take).to.match(/AAPLx$/);
    expect(w.takeUsd).to.equal(null);
  });
});

describe("the round chips", () => {
  it("offer five timed rounds and two bells, each bell with its end in ET", () => {
    const chips = roundChoices(MONDAY_2PM);
    expect(chips.map((c) => c.id)).to.deep.equal(["5m", "15m", "1h", "12h", "24h", "bell", "week"]);
    expect(chips.slice(0, 5).every((c) => c.sub === "after a taker")).to.equal(true);
    expect(chips.map((c) => c.secs ?? null)).to.deep.equal([300, 900, 3_600, 43_200, 86_400, null, null]);
    expect(chips[5].endTs).to.equal(nextBell(MONDAY_2PM * 1000));
    expect(chips[6].endTs).to.equal(weekBell(MONDAY_2PM * 1000));
    expect(chips[5].sub).to.match(/^Mon 3:59\sPM ET$/);
    expect(chips[6].sub).to.match(/^Fri 3:59\sPM ET$/);
  });

  /* After the cutover the default pair is priced by its 24/7 markets at
   * night, and a round that short would be refused; the shortest chip that is
   * long enough is the 12 hours. */
  it("offer only rounds long enough for 24/7 prices when those would price the fight", () => {
    const saturday = ny(2026, 9, 19, 12, 0);
    const [a, b] = ["AAPL", "NVDA"];
    const refused = roundChoices(saturday).filter((c) => {
      const endTs = c.secs ? 0 : (c.endTs ?? 0);
      return tooShortOffHours(a, b, saturday, { durationSecs: c.secs ?? 0, endTs });
    });
    expect(refused.map((c) => c.id)).to.deep.equal(["5m", "15m", "1h"]);
    expect(shortestRoundAtLeast(MIN_OFFHOURS_ROUND_SECS)).to.equal("12h");
    // In session nothing is refused, and before the cutover the perps keep every round.
    expect(roundChoices(MONDAY_2PM).filter((c) => tooShortOffHours(a, b, MONDAY_2PM, { durationSecs: c.secs ?? 0, endTs: c.secs ? 0 : c.endTs! }))).to.deep.equal([]);
    expect(roundChoices(SATURDAY_NOON).filter((c) => tooShortOffHours(a, b, SATURDAY_NOON, { durationSecs: c.secs ?? 0, endTs: c.secs ? 0 : c.endTs! }))).to.deep.equal([]);
  });
});

describe("the next step", () => {
  it("asks to connect before anything else", () => {
    expect(ctaStep({ connected: false, hasAccount: false, short: true, ready: false })).to.equal("connect");
  });

  it("offers shares to a wallet with no account for the stock, or too few shares", () => {
    expect(ctaStep({ connected: true, hasAccount: false, short: false, ready: false })).to.equal("faucet");
    expect(ctaStep({ connected: true, hasAccount: true, short: true, ready: false })).to.equal("faucet");
  });

  it("stakes when everything is in order, and waits otherwise", () => {
    expect(ctaStep({ connected: true, hasAccount: true, short: false, ready: true })).to.equal("stake");
    expect(ctaStep({ connected: true, hasAccount: true, short: false, ready: false })).to.equal("wait");
  });
});

describe("a rematch link", () => {
  const params = (q: string) => {
    const u = new URLSearchParams(q);
    return (k: string) => u.get(k);
  };

  it("pre-fills both fighters, the stake and the invite", () => {
    const wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(ticketFromParams(params(`p1=NVDA&p2=AAPL&usd=50&invite=${wallet}`), MONDAY_2PM)).to.deep.equal({
      p1: "NVDA",
      p2: "AAPL",
      usd: 50,
      invite: wallet,
    });
  });

  it("drops what does not hold and fills a missing corner without doubling a stock", () => {
    expect(ticketFromParams(params("p1=NOPE&usd=abc"), SATURDAY_NOON)).to.deep.equal({
      p1: "AAPL",
      p2: "NVDA",
      usd: 25,
      invite: "",
    });
    expect(ticketFromParams(params("p2=AAPL"), MONDAY_2PM).p1).to.equal("NVDA");
    expect(ticketFromParams(params("p1=MSFT&p2=MSFT"), MONDAY_2PM)).to.include({ p1: "MSFT", p2: "AAPL" });
    expect(ticketFromParams(params("usd=999999"), MONDAY_2PM).usd).to.equal(10_000);
  });
});
