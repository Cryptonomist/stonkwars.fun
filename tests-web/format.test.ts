import { expect } from "chai";

import { ago, etDay, etShort, etWhen, hm, pct, pctPair, points, until } from "../src/lib/format";
import { nyToMs } from "../src/lib/market";

const et = (y: number, m: number, d: number, hh: number, mm: number) => Math.floor(nyToMs(y, m, d, hh, mm, 0) / 1000);

/* Two decimals suit a trading day and lie on a quiet weekend. One settled
 * fight had its sides at -0.0108% and -0.0046%, which at two decimals reads
 * "-0.01%" against "-0.00%": a move that happened, printed as nothing, beside
 * the words "winner takes both". */

describe("a move on an ordinary day", () => {
  it("keeps two decimals and its sign", () => {
    expect(pct(3.121)).to.equal("+3.12%");
    expect(pct(-0.85)).to.equal("-0.85%");
    expect(pct(12)).to.equal("+12.00%");
  });

  it("prints a real zero as zero, because there it is true", () => {
    expect(pct(0)).to.equal("0.00%");
  });
});

describe("a move on a dead weekend", () => {
  it("widens rather than rounding a real move away", () => {
    expect(pct(-0.0046)).to.equal("-0.0046%");
    expect(pct(-0.0108)).to.equal("-0.011%");
  });

  it("widens only as far as it has to", () => {
    expect(pct(-0.004)).to.equal("-0.004%");
    expect(pct(0.09)).to.equal("+0.09%");
  });

  it("gives up rather than printing a hundred zeros", () => {
    // Smaller than any price feed resolves; six decimals is the floor.
    expect(pct(1e-12)).to.equal("0.00%");
  });

  it("never loses the sign of something that moved", () => {
    for (const n of [-0.0046, -0.0001, -1e-6]) expect(pct(n)).to.match(/^-/);
    for (const n of [0.0046, 0.0001, 1e-6]) expect(pct(n)).to.match(/^\+/);
  });
});

describe("two moves side by side", () => {
  it("widens both together when they would print the same", () => {
    // A settled fight read "-0.051% COOKED" against "W -0.051%".
    expect(pct(-0.05112)).to.equal(pct(-0.05061));
    expect(pctPair(-0.05112, -0.05061)).to.deep.equal(["-0.0511%", "-0.0506%"]);
  });

  it("leaves moves that already differ exactly as pct prints them", () => {
    expect(pctPair(1.2, 0.8)).to.deep.equal(["+1.20%", "+0.80%"]);
    expect(pctPair(-0.0108, -0.0046)).to.deep.equal(["-0.011%", "-0.0046%"]);
  });

  it("does not invent a difference between equal moves", () => {
    expect(pctPair(0.5, 0.5)).to.deep.equal(["+0.50%", "+0.50%"]);
  });

  it("stops at six decimals", () => {
    expect(pctPair(0.12345671, 0.12345674)).to.deep.equal(["+0.123457%", "+0.123457%"]);
  });
});

describe("the margin between two moves", () => {
  it("reads plainly when the fight was not close", () => {
    expect(points(1.23)).to.equal("1.23");
    expect(points(-1.23)).to.equal("1.23");
  });

  it("shows the margin that actually decided a quiet fight", () => {
    // -0.0108 against -0.0046: the gap is 0.0062, not "0.01".
    expect(points(-0.0108 - -0.0046)).to.equal("0.0062");
  });
});

/* Every age on a board is a claim about when something happened on chain, so
 * the buckets are pinned, and so is the absence of dashes: a range reads
 * "4:21 to 4:27 PM ET", never with an en dash. */

describe("how long ago", () => {
  const NOW = et(2026, 9, 13, 20, 30);

  it("calls the last ten seconds now", () => {
    expect(ago(NOW, NOW)).to.equal("now");
    expect(ago(NOW - 9, NOW)).to.equal("now");
    expect(ago(NOW + 30, NOW)).to.equal("now"); // a clock a little ahead of the chain
  });

  it("counts seconds, minutes, hours and days", () => {
    expect(ago(NOW - 45, NOW)).to.equal("45s ago");
    expect(ago(NOW - 12 * 60 - 59, NOW)).to.equal("12m ago");
    expect(ago(NOW - 3 * 3_600, NOW)).to.equal("3h ago");
    expect(ago(NOW - 2 * 86_400, NOW)).to.equal("2d ago");
    expect(ago(NOW - 6 * 86_400 - 3_600, NOW)).to.equal("6d ago");
  });

  it("gives a date in New York once it is a week old", () => {
    expect(ago(et(2026, 9, 3, 23, 30), NOW)).to.equal("Sep 3");
    // 1:30 AM UTC on the 4th is still the 3rd in New York.
    expect(ago(Math.floor(Date.parse("2026-09-04T01:30:00Z") / 1000), NOW)).to.equal("Sep 3");
  });
});

describe("how long until", () => {
  const NOW = et(2026, 9, 13, 20, 30);

  it("counts down in the largest whole unit", () => {
    expect(until(NOW + 45, NOW)).to.equal("in 45s");
    expect(until(NOW + 12 * 60 + 30, NOW)).to.equal("in 12m");
    expect(until(NOW + 3 * 3_600 + 59, NOW)).to.equal("in 3h");
    expect(until(NOW + 6 * 86_400 + 100, NOW)).to.equal("in 6d");
  });

  it("does not count down past zero", () => {
    expect(until(NOW, NOW)).to.equal("now");
    expect(until(NOW - 5, NOW)).to.equal("now");
  });

  it("gives a queued fight's wait in two units, rounded down", () => {
    expect(hm(45)).to.equal("45s");
    expect(hm(12 * 60 + 59)).to.equal("12m");
    expect(hm(6 * 3_600 + 12 * 60 + 59)).to.equal("6h 12m");
    expect(hm(86_400 + 19 * 3_600 + 3_599)).to.equal("1d 19h");
    expect(hm(-5)).to.equal("0s");
  });

  it("names a moment this week as short as a chip needs", () => {
    expect(etShort(et(2026, 9, 14, 4, 0))).to.equal("Mon 4 AM");
    expect(etShort(et(2026, 9, 13, 20, 1))).to.equal("Sun 8:01 PM");
  });
});

describe("a round on the market's clock", () => {
  it("writes one day once", () => {
    expect(etWhen(et(2026, 9, 12, 16, 21), et(2026, 9, 12, 16, 27))).to.equal("Sat, Sep 12, 4:21 to 4:27 PM ET");
  });

  it("names both halves of the day when a round crosses noon", () => {
    expect(etWhen(et(2026, 9, 11, 11, 30), et(2026, 9, 11, 13, 5))).to.equal("Fri, Sep 11, 11:30 AM to 1:05 PM ET");
  });

  it("writes both days when a round runs over a weekend", () => {
    expect(etWhen(et(2026, 9, 11, 15, 0), et(2026, 9, 14, 9, 30))).to.equal(
      "Fri, Sep 11 3:00 PM to Mon, Sep 14 9:30 AM ET",
    );
  });

  it("uses no dashes of any length", () => {
    const out = [etWhen(et(2026, 9, 12, 16, 21), et(2026, 9, 14, 9, 30)), etDay(et(2026, 9, 18, 22, 22)), ago(0, 1e9), until(1e9, 0)].join(" ");
    expect(out).to.not.match(/[\u2013\u2014]/);
  });
});

describe("a moment days away", () => {
  it("carries its date", () => {
    expect(etDay(et(2026, 9, 18, 22, 22))).to.equal("Fri, Sep 18, 10:22 PM ET");
    expect(etDay(et(2026, 11, 2, 9, 5))).to.equal("Mon, Nov 2, 9:05 AM ET");
  });
});
