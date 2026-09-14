import { expect } from "chai";

import { fighterFrom, formBar, powerBar, tale, POWER_CEILING } from "../src/lib/fighterStats";

/** A month of closes that move by exactly `pct` percent each session. */
const steady = (pct: number, n = 22, start = 100) => {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + pct / 100));
  return out;
};

describe("reading a stock as a fighter", () => {
  it("measures power as the average daily move, either direction", () => {
    expect(fighterFrom(steady(1))!.power).to.be.closeTo(1, 1e-9);
    expect(fighterFrom(steady(-1))!.power).to.be.closeTo(1, 1e-9); // falling hits just as hard
    const choppy = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100];
    expect(fighterFrom(choppy)!.power).to.be.above(1.9).and.below(2.1);
  });

  it("measures form over the last five sessions, not the whole month", () => {
    // A month that climbed hard, then gave a little back in the last week.
    const rise = steady(5, 17);
    const closes = [...rise, ...steady(-1, 6, rise[rise.length - 1]).slice(1)];
    const f = fighterFrom(closes)!;
    expect(closes[closes.length - 1] / closes[0]).to.be.above(2); // the month more than doubled
    expect(f.form).to.be.closeTo(-4.90099501, 1e-6); // five sessions at -1%, compounded
  });

  it("places room between the month's low and its high", () => {
    expect(fighterFrom(steady(1))!.room).to.be.closeTo(100, 1e-9); // ends at its high
    expect(fighterFrom(steady(-1))!.room).to.be.closeTo(0, 1e-9);
    const flat = Array(22).fill(50);
    expect(fighterFrom(flat)!.room).to.equal(50); // no range at all: call it the middle
  });

  it("counts a streak back from the latest session, and stops at a reversal", () => {
    // 22 closes are 21 moves, and every one of them went the same way.
    expect(fighterFrom(steady(1))!.streak).to.equal(21);
    expect(fighterFrom(steady(-1))!.streak).to.equal(-21);
    const turned = [...steady(1, 20), 90];
    expect(fighterFrom(turned)!.streak).to.equal(-1);
  });

  it("refuses to make stats out of too little, or out of nonsense", () => {
    expect(fighterFrom([100, 101, 102])).to.equal(null);
    expect(fighterFrom([])).to.equal(null);
    // Gaps and bad values are dropped; what is left must still be enough.
    expect(fighterFrom([100, null, 101, undefined, 0, -5, 102])).to.equal(null);
    const withGaps = [...steady(1, 12), null, null] as (number | null)[];
    expect(fighterFrom(withGaps)).to.not.equal(null);
  });
});

describe("the bars", () => {
  it("fills power up to the ceiling and no further", () => {
    expect(powerBar(POWER_CEILING / 2)).to.be.closeTo(0.5, 1e-9);
    expect(powerBar(POWER_CEILING * 10)).to.equal(1);
  });

  it("fills form by size, whichever way it went", () => {
    expect(formBar(5)).to.equal(formBar(-5));
    expect(formBar(100)).to.equal(1);
  });
});

describe("the read on the matchup", () => {
  it("calls near-equal power evenly matched", () => {
    const a = fighterFrom(steady(1))!;
    const b = fighterFrom(steady(-1.05))!;
    expect(tale(a, b, "AAPL", "MSFT")).to.contain("Evenly matched");
  });

  it("names the stock that swings harder by ticker, whichever corner it is in", () => {
    const big = fighterFrom(steady(3))!;
    const small = fighterFrom(steady(0.2))!;
    expect(tale(big, small, "HOOD", "AMZN")).to.match(/^HOOD swings [\d.]+ points a day harder than AMZN\./);
    // The taker's corner is the second one: the sentence must not flip for them.
    expect(tale(small, big, "AMZN", "HOOD")).to.match(/^HOOD swings [\d.]+ points a day harder than AMZN\./);
  });
});
