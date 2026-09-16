/* What a price chart draws, as plain rules.
 *
 * FOR WATCHING ONLY. Nothing here touches a fight: a result is settled from the
 * start and bell prices the program recorded, and no line drawn on a chart is
 * an input to anything.
 *
 * A timeframe is a window and a bar size. The window decides how far back the
 * chart asks; the bar size keeps the number of points in a range a phone can
 * draw and an edge can cache (a week of one-minute bars would be ten thousand
 * points to send and to draw). */

export type TimeframeId = "1H" | "4H" | "1D" | "1W" | "1M";

export type Timeframe = {
  id: TimeframeId;
  label: string;
  /** How far back the window reaches. */
  secs: number;
  /** One bar, in seconds. */
  step: number;
  /** Time ticks along the bottom. */
  tick: number;
  /** Bars in the moving average, chosen so it covers a similar stretch each time. */
  maLen: number;
  /** What the caption calls the bars. */
  barWords: string;
};

export const TIMEFRAMES: Timeframe[] = [
  { id: "1H", label: "1H", secs: 3_600, step: 60, tick: 600, maLen: 15, barWords: "1-minute bars" },
  { id: "4H", label: "4H", secs: 4 * 3_600, step: 60, tick: 3_600, maLen: 30, barWords: "1-minute bars" },
  { id: "1D", label: "1D", secs: 86_400, step: 300, tick: 4 * 3_600, maLen: 24, barWords: "5-minute bars" },
  { id: "1W", label: "1W", secs: 7 * 86_400, step: 1_800, tick: 86_400, maLen: 24, barWords: "30-minute bars" },
  { id: "1M", label: "1M", secs: 30 * 86_400, step: 86_400, tick: 7 * 86_400, maLen: 10, barWords: "daily bars" },
];

export const DEFAULT_TIMEFRAME: TimeframeId = "1D";

export const timeframeOf = (id: string | null | undefined): Timeframe =>
  TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES.find((t) => t.id === DEFAULT_TIMEFRAME)!;

/** The bar sizes the bars route serves, and how far back each may be asked for. */
export const STEPS: Record<number, { yahoo: string; perp: string; maxRangeSecs: number; maxLookbackSecs: number }> = {
  60: { yahoo: "1m", perp: "1m", maxRangeSecs: 7 * 3_600, maxLookbackSecs: 29 * 86_400 },
  300: { yahoo: "5m", perp: "5m", maxRangeSecs: 2 * 86_400, maxLookbackSecs: 55 * 86_400 },
  1_800: { yahoo: "30m", perp: "30m", maxRangeSecs: 10 * 86_400, maxLookbackSecs: 55 * 86_400 },
  86_400: { yahoo: "1d", perp: "1d", maxRangeSecs: 400 * 86_400, maxLookbackSecs: 400 * 86_400 },
};

/* FIBONACCI RETRACEMENTS, FROM WHAT IS ON SCREEN.
 *
 * The high and low of the window, and the levels traders draw between them.
 * Drawn, not decided: they move as the window does, and they are a picture of
 * the range, not a forecast. 0% sits at the high and 100% at the low, the way
 * a retracement of a rise is read. */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export type FibLevel = { ratio: number; label: string; price: number; major: boolean };

export function fibLevels(high: number, low: number): FibLevel[] {
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return [];
  return FIB_RATIOS.map((ratio) => ({
    ratio,
    label: `${(ratio * 100).toFixed(ratio === 0 || ratio === 1 || ratio === 0.5 ? 0 : 1)}%`,
    price: high - (high - low) * ratio,
    major: ratio === 0 || ratio === 0.5 || ratio === 0.618 || ratio === 1,
  }));
}

/* THE AVERAGE PRICE EVERY SHARE ACTUALLY CHANGED HANDS AT.
 *
 * VWAP weights each bar by how much traded in it, so an hour nobody touched
 * counts for less than a minute the whole market went through. It is anchored
 * to the left edge of the window, which is what an "anchored VWAP" means: the
 * running average since the window began, not a session's own. Null until some
 * size has accumulated, so a stretch the market reported no size for draws
 * nothing rather than a line at zero.
 *
 * Each bar counts at its typical price, the average of its high, low and close,
 * which is the usual convention and closer to where the trading sat than the
 * close alone. */
export function vwap(
  high: number[],
  low: number[],
  close: number[],
  volume: (number | null)[],
): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  let value = 0;
  let size = 0;
  for (let i = 0; i < close.length; i++) {
    const v = volume[i];
    if (v != null && Number.isFinite(v) && v > 0) {
      value += ((high[i] + low[i] + close[i]) / 3) * v;
      size += v;
    }
    if (size > 0) out[i] = value / size;
  }
  return out;
}

/** True when a market reported any size at all over these bars. */
export const hasVolume = (volume: (number | null)[]) => volume.some((v) => v != null && v > 0);

/* A traded size in as few characters as a chart's axis has room for: 12.4M,
 * 806K, 1.24B. Whole units below a thousand, since a thin bar that traded
 * eleven shares should say eleven. */
export function volumeWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const scaled = n / size;
      return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
    }
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
}

/** A simple moving average over `period` bars; null until there are enough. */
export function sma(values: number[], period: number): (number | null)[] {
  if (period <= 1) return values.slice();
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
