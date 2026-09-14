/* The race chart's path. Its ends must be the chain's two prices exactly, its
 * middle only real bars and polls, and the minutes it asks for must be ones the
 * bars route will answer. */

import { expect } from "chai";

import { movePct } from "../src/lib/pricemath";
import {
  appendLive,
  barsToPoints,
  barsWindow,
  mergePoints,
  pinEndpoints,
  toPercentSeries,
  valueAt,
  WINDOW_SECS,
  xDomain,
  yHalfRange,
} from "../src/lib/raceSeries";

const T0 = 1_789_000_000;

describe("race series", () => {
  it("turns prices into moves from the start, and drops what is not a price", () => {
    const s = toPercentSeries(
      [
        { t: T0, price: 100 },
        { t: T0 + 60, price: 101 },
        { t: T0 + 120, price: 0 },
        { t: T0 + 180, price: Number.NaN },
        { t: T0 + 240, price: 99.5 },
      ],
      100,
    );
    expect(s.map((p) => p.t)).to.deep.equal([T0, T0 + 60, T0 + 240]);
    expect(s[1].v).to.be.closeTo(1, 1e-12);
    expect(s[2].v).to.be.closeTo(-0.5, 1e-12);
    expect(toPercentSeries([{ t: T0, price: 1 }], 0)).to.deep.equal([]);
  });

  it("merges bars and polls in time order, one point a second, the later list winning", () => {
    const bars = [
      { t: T0 + 120, price: 2 },
      { t: T0 + 60, price: 1 },
    ];
    const polls = [
      { t: T0 + 90, price: 1.5 },
      { t: T0 + 120, price: 2.2 },
    ];
    expect(mergePoints(bars, polls)).to.deep.equal([
      { t: T0 + 60, price: 1 },
      { t: T0 + 90, price: 1.5 },
      { t: T0 + 120, price: 2.2 },
    ]);
  });

  it("pins a settled path to the on-chain start and bell exactly", () => {
    const start = { price: BigInt(18_234_000_000), expo: -8 };
    const end = { price: BigInt(18_310_000_000), expo: -8 };
    const startTs = T0;
    const endTs = T0 + 360;
    // Bars run a little past both ends, as a minute bar does.
    const bars = barsToPoints({ t: [T0 - 60, T0, T0 + 120, T0 + 300], c: [182.3, 182.5, 182.9, 183.0] });
    const series = toPercentSeries(bars, 182.34);
    const pinned = pinEndpoints(series, { t: startTs, v: 0 }, { t: endTs, v: movePct(start, end) });

    expect(pinned[0]).to.deep.equal({ t: startTs, v: 0 });
    expect(pinned[pinned.length - 1]).to.deep.equal({ t: endTs, v: movePct(start, end) });
    // The bar that closed at the start and the one that closed at the bell gave way to the chain's.
    expect(pinned.map((p) => p.t)).to.deep.equal([startTs, T0 + 60, T0 + 180, endTs]);
    expect(pinned.every((p, i) => i === 0 || p.t > pinned[i - 1].t)).to.equal(true);
  });

  it("pins only the start while the round runs, and only the bell when the window starts later", () => {
    const s = [
      { t: T0 + 10, v: 0.1 },
      { t: T0 + 20, v: 0.2 },
    ];
    expect(pinEndpoints(s, { t: T0, v: 0 }, null)).to.deep.equal([{ t: T0, v: 0 }, ...s]);
    expect(pinEndpoints(s, null, { t: T0 + 20, v: 0.25 })).to.deep.equal([s[0], { t: T0 + 20, v: 0.25 }]);
  });

  it("draws a bar's close at the end of its minute and skips empty minutes", () => {
    expect(barsToPoints({ t: [T0, T0 + 60], c: [10, null] })).to.deep.equal([{ t: T0 + 60, price: 10 }]);
    expect(barsToPoints(null)).to.deep.equal([]);
  });

  describe("barsWindow", () => {
    it("asks for nothing under five minutes, before the start, or past the bars' reach", () => {
      expect(barsWindow({ startTs: T0, endTs: T0 + 240 }, T0 + 1_000)).to.equal(null);
      expect(barsWindow({ startTs: 0, endTs: T0 + 600 }, T0)).to.equal(null);
      expect(barsWindow({ startTs: T0, endTs: T0 + 600 }, T0 + 30 * 86_400)).to.equal(null);
    });

    it("asks for the whole of a finished round, up to the bell", () => {
      expect(barsWindow({ startTs: T0, endTs: T0 + 360 }, T0 + 5_000)).to.deep.equal({ from: T0, to: T0 + 360 });
    });

    it("rounds a live round's end up to the minute, so the URL holds for a minute", () => {
      const start = T0 - (T0 % 60) + 20; // 20 seconds past a minute
      const w = barsWindow({ startTs: start, endTs: start + 3_600 }, start + 70)!;
      expect(w.from).to.equal(start);
      expect(w.to % 60).to.equal(0);
      expect(w.to).to.equal(start - 20 + 120);
      // Later in the same minute, the same URL.
      expect(barsWindow({ startTs: start, endTs: start + 3_600 }, start + 95)).to.deep.equal(w);
      // Too little of the round has passed for a bar.
      expect(barsWindow({ startTs: start, endTs: start + 3_600 }, start + 30)).to.equal(null);
    });

    it("never asks for more than six hours, which the route refuses", () => {
      const w = barsWindow({ startTs: T0, endTs: T0 + 3 * 86_400 }, T0 + 86_400 + 17)!;
      expect(w.to - w.from).to.be.at.most(WINDOW_SECS);
      expect(w.to - w.from).to.equal(WINDOW_SECS);
    });
  });

  it("spans a short round start to bell, and a long one's last six hours", () => {
    expect(xDomain({ startTs: T0, endTs: T0 + 300 }, T0 + 10)).to.deep.equal([T0, T0 + 300]);
    expect(xDomain({ startTs: T0, endTs: T0 + 86_400 }, T0 + 50_000)).to.deep.equal([T0 + 50_000 - WINDOW_SECS, T0 + 50_000]);
    expect(xDomain({ startTs: T0, endTs: T0 + 86_400 }, T0 + 99_999)).to.deep.equal([T0 + 86_400 - WINDOW_SECS, T0 + 86_400]);
  });

  it("keeps the y axis symmetric with headroom, and never zero", () => {
    expect(yHalfRange([[{ t: 0, v: -0.5 }], [{ t: 0, v: 0.2 }]])).to.be.closeTo(0.55, 1e-12);
    expect(yHalfRange([[{ t: 0, v: 0 }]])).to.be.greaterThan(0);
  });

  it("reads a side's value at a moment from the latest point before it", () => {
    const s = [
      { t: 10, v: 1 },
      { t: 20, v: 2 },
      { t: 30, v: 3 },
    ];
    expect(valueAt(s, 5)).to.equal(null);
    expect(valueAt(s, 10)).to.equal(1);
    expect(valueAt(s, 29)).to.equal(2);
    expect(valueAt(s, 99)).to.equal(3);
  });

  it("adds a live price once per publish time", () => {
    const a = appendLive([], { t: 5, price: 1 });
    expect(appendLive(a, { t: 5, price: 2 })).to.equal(a);
    expect(appendLive(a, { t: 3, price: 2 })).to.deep.equal([
      { t: 3, price: 2 },
      { t: 5, price: 1 },
    ]);
    expect(appendLive(appendLive(a, { t: 6, price: 1 }, 2), { t: 7, price: 1 }, 2).map((p) => p.t)).to.deep.equal([6, 7]);
  });
});
