/* What a chart draws: the timeframes it offers, the bar sizes the bars route
 * will serve for them, the retracement levels of a window, and a moving average.
 * None of it is an input to a fight; all of it has to be right on the screen. */

import { expect } from "chai";

import {
  DEFAULT_TIMEFRAME,
  fibLevels,
  hasVolume,
  sma,
  STEPS,
  TIMEFRAMES,
  timeframeOf,
  volumeWords,
  vwap,
} from "../src/lib/chart";
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

describe("vwap", () => {
  it("weighs each bar by what traded in it", () => {
    /* Two bars at a typical price of 10 and 20. The second traded three times
     * as much, so the running average leans to it: (10 + 3 * 20) / 4. */
    const out = vwap([10, 20], [10, 20], [10, 20], [1, 3]);
    expect(out[0]).to.equal(10);
    expect(out[1]).to.equal(17.5);
  });

  it("counts a bar at the average of its high, low and close", () => {
    expect(vwap([12], [6], [9], [2])[0]).to.equal(9);
  });

  it("draws nothing until something has traded", () => {
    expect(vwap([10, 11], [10, 11], [10, 11], [null, null])).to.deep.equal([null, null]);
    expect(vwap([10, 11], [10, 11], [10, 11], [0, 5])).to.deep.equal([null, 11]);
  });

  it("knows whether a market reported any size at all", () => {
    expect(hasVolume([null, null])).to.equal(false);
    expect(hasVolume([0, 0])).to.equal(false);
    expect(hasVolume([null, 3])).to.equal(true);
  });
});

describe("volume in words", () => {
  it("shortens a big number and keeps a small one whole", () => {
    expect(volumeWords(1_240_000_000)).to.equal("1.24B");
    expect(volumeWords(12_400_000)).to.equal("12.4M");
    expect(volumeWords(806_000)).to.equal("806K");
    expect(volumeWords(1_200)).to.equal("1.20K");
    expect(volumeWords(11)).to.equal("11");
    expect(volumeWords(0)).to.equal("0");
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

  it("builds a wide bucket the way a candle is built", () => {
    const exchange = {
      t: [B, B + 60, B + 120],
      o: [10, 11, 12],
      h: [14, 11, 13],
      l: [9, 10, 12],
      c: [11, 12, 13],
      v: [100, 50, 25],
    };
    const merged = mergeBars(exchange, { t: [], c: [] }, () => false, 300);
    expect(merged.t).to.deep.equal([B]);
    expect(merged.o).to.deep.equal([10], "the first bar's open");
    expect(merged.h).to.deep.equal([14], "the highest high inside it");
    expect(merged.l).to.deep.equal([9], "the lowest low inside it");
    expect(merged.c).to.deep.equal([13], "the last close");
    expect(merged.v).to.deep.equal([175], "every size added up");
  });

  it("prices a bar with no open, high or low at its close", () => {
    const merged = mergeBars({ t: [B], c: [42] }, { t: [], c: [] }, () => false);
    expect(merged.o).to.deep.equal([42]);
    expect(merged.h).to.deep.equal([42]);
    expect(merged.l).to.deep.equal([42]);
  });

  it("leaves an unreported size null rather than calling it zero", () => {
    const merged = mergeBars({ t: [B, B + 60], c: [10, 11], v: [null, 5] }, { t: [], c: [] }, () => false);
    expect(merged.v).to.deep.equal([null, 5]);
  });

  it("gives a bar that traded nothing no traded range", () => {
    /* A real after-hours TSLA bar: open and close at 355.99, a low of 335.48,
     * and a volume of zero. Nothing changed hands, so that low is a quote and
     * not a print, and letting it through squashed a whole day's scale. */
    const merged = mergeBars(
      { t: [B], o: [355.7495], h: [355.99], l: [335.4783], c: [355.99], v: [0] },
      { t: [], c: [] },
      () => false,
    );
    expect(merged.l).to.deep.equal([355.7495]);
    expect(merged.h).to.deep.equal([355.99]);
    expect(merged.v).to.deep.equal([0], "the zero itself is still reported");
  });

  it("keeps the range of a bar that traded, however wild", () => {
    const merged = mergeBars(
      { t: [B], o: [355], h: [356], l: [335], c: [356], v: [1_200] },
      { t: [], c: [] },
      () => false,
    );
    expect(merged.l).to.deep.equal([335], "somebody traded down there");
  });

  it("never lets a candle's body escape its own high and low", () => {
    /* A source that prints an open outside the range it also printed would draw
     * a body hanging off the wick. The bucket widens to hold it instead. */
    const merged = mergeBars({ t: [B], o: [20], h: [12], l: [11], c: [11.5] }, { t: [], c: [] }, () => false);
    expect(merged.h).to.deep.equal([20]);
    expect(merged.l).to.deep.equal([11]);
  });

  it("still buckets by the minute when nothing asks otherwise", () => {
    const merged = mergeBars({ t: [B, B + 30], c: [10, 11] }, { t: [], c: [] }, () => false);
    expect(merged.t).to.deep.equal([B]);
    expect(merged.c).to.deep.equal([11], "the later price in the minute wins");
  });
});
