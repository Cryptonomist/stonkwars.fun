/* What a chart draws: the timeframes it offers, the bar sizes the bars route
 * will serve for them, the retracement levels of a window, and a moving average.
 * None of it is an input to a fight; all of it has to be right on the screen. */

import { expect } from "chai";

import { DEFAULT_TIMEFRAME, fibLevels, sma, STEPS, TIMEFRAMES, timeframeOf } from "../src/lib/chart";
import { mergeBars } from "../src/lib/livePrice";

describe("chart timeframes", () => {
  it("offers windows from an hour to a month, each with a bar size the route serves", () => {
    expect(TIMEFRAMES.map((t) => t.id)).to.deep.equal(["1H", "4H", "1D", "1W", "1M"]);
    for (const tf of TIMEFRAMES) {
      const rule = STEPS[tf.step];
      expect(rule, `${tf.id} step ${tf.step}`).to.not.equal(undefined);
      expect(tf.secs, `${tf.id} window fits the step's range`).to.be.at.most(rule.maxRangeSecs);
      expect(tf.secs, `${tf.id} window is inside the lookback`).to.be.at.most(rule.maxLookbackSecs);
      const points = tf.secs / tf.step;
      expect(points, `${tf.id} draws a sane number of points`).to.be.within(20, 400);
      expect(tf.maLen, `${tf.id} moving average fits its window`).to.be.below(points);
    }
  });

  it("falls back to the default for anything it does not know", () => {
    expect(timeframeOf("1W").id).to.equal("1W");
    expect(timeframeOf("nope").id).to.equal(DEFAULT_TIMEFRAME);
    expect(timeframeOf(null).id).to.equal(DEFAULT_TIMEFRAME);
  });
});

describe("fib levels", () => {
  it("runs from the high at 0% to the low at 100%", () => {
    const l = fibLevels(120, 100);
    expect(l.map((x) => x.label)).to.deep.equal(["0%", "23.6%", "38.2%", "50%", "61.8%", "78.6%", "100%"]);
    expect(l[0].price).to.equal(120);
    expect(l[l.length - 1].price).to.equal(100);
    expect(l.find((x) => x.ratio === 0.5)!.price).to.equal(110);
    expect(l.find((x) => x.ratio === 0.618)!.price).to.be.closeTo(107.64, 1e-9);
    expect(l.filter((x) => x.major).map((x) => x.ratio)).to.deep.equal([0, 0.5, 0.618, 1]);
  });

  it("draws nothing without a range", () => {
    expect(fibLevels(100, 100)).to.deep.equal([]);
    expect(fibLevels(90, 100)).to.deep.equal([]);
    expect(fibLevels(Number.NaN, 100)).to.deep.equal([]);
  });
});

describe("moving average", () => {
  it("waits for enough bars, then averages the last ones", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).to.deep.equal([null, null, 2, 3, 4]);
    expect(sma([10, 20], 5)).to.deep.equal([null, null]);
    expect(sma([5, 5, 5], 1)).to.deep.equal([5, 5, 5]);
  });
});

describe("bars in wider buckets", () => {
  /* A time on both a minute and a five-minute boundary, so a bucket's start is
   * the number the test can name. */
  const B = 1_700_000_100;
  const closed = (t: number) => t >= B + 300;

  it("buckets to the step and keeps the last price in each bucket", () => {
    const exchange = { t: [B, B + 60, B + 120], c: [10, 11, 12] };
    const perp = { t: [B + 300, B + 360], c: [20, 21] };
    const merged = mergeBars(exchange, perp, closed, 300);
    expect(merged.t).to.deep.equal([B, B + 300]);
    expect(merged.c).to.deep.equal([12, 21]);
    expect(merged.src).to.deep.equal(["exchange", "perp"]);
  });

  it("still buckets by the minute when nothing asks otherwise", () => {
    const merged = mergeBars({ t: [B, B + 30], c: [10, 11] }, { t: [], c: [] }, () => false);
    expect(merged.t).to.deep.equal([B]);
    expect(merged.c).to.deep.equal([11], "the later price in the minute wins");
  });
});
