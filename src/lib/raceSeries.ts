/* The race chart's arithmetic: two stocks' paths, as percent from each one's
 * on-chain start, apart from the drawing so it can be tested.
 *
 * FOR WATCHING ONLY. The path comes from one-minute market bars (/api/bars)
 * and the live prices the page polls. The program never sees either: it
 * decides on the start and bell prices a crank posted. So the chart pins its
 * ends to exactly those two prices, and a settled chart can never end anywhere
 * the result did not.
 *
 * Pure: unix seconds and dollars in, points out. */

/** A price in dollars at a unix second. */
export type PricePt = { t: number; price: number };
/** A move in percent from the side's start, at a unix second. */
export type PctPt = { t: number; v: number };

/** A round shorter than this is over before minute bars say anything. */
export const MIN_BARS_ROUND_SECS = 5 * 60;
/** The most the bars route answers in one request, and so the most the chart shows. */
export const WINDOW_SECS = 6 * 3_600;
/** Minute bars reach back this far and no further (oracle.ts MAX_LOOKBACK_SECS). */
export const BARS_LOOKBACK_SECS = 29 * 86_400;
/** Live points kept per side, for a long round watched for hours. */
export const MAX_LIVE_POINTS = 1_500;

/** Each price as a move from `start`. A start of zero, or a price that is not
 *  a price, gives nothing rather than a point at a made-up height. */
export function toPercentSeries(points: readonly PricePt[], start: number): PctPt[] {
  if (!(start > 0) || !Number.isFinite(start)) return [];
  const out: PctPt[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.t) || !(p.price > 0) || !Number.isFinite(p.price)) continue;
    out.push({ t: p.t, v: ((p.price - start) / start) * 100 });
  }
  return out;
}

/** Several lists of prices as one, in time order, one point per second. Where
 *  two lists have the same second the later list wins: a live poll is the
 *  fresher read of that moment than a bar. */
export function mergePoints(...lists: readonly (readonly PricePt[])[]): PricePt[] {
  const bySecond = new Map<number, PricePt>();
  for (const list of lists) for (const p of list) if (Number.isFinite(p.t)) bySecond.set(p.t, p);
  return [...bySecond.values()].sort((a, b) => a.t - b.t);
}

/* THE ENDS ARE THE CHAIN'S. Everything at or before the start and at or after
 * the bell is dropped, and the on-chain points take those places, so the first
 * value is exactly 0 and the last exactly the move the program measured. Either
 * end can be absent: no end before the bell, and no start when the window
 * shows only the last six hours of a longer round. */
export function pinEndpoints(series: readonly PctPt[], start: PctPt | null, end?: PctPt | null): PctPt[] {
  const inside = series.filter((p) => (!start || p.t > start.t) && (!end || p.t < end.t));
  return [...(start ? [start] : []), ...inside, ...(end ? [end] : [])];
}

/* Bars in /api/bars are stamped with the minute they open, and a bar's close
 * is the price at the end of that minute, so each is drawn a minute later. */
export function barsToPoints(body: { t?: number[]; c?: (number | null)[] } | null | undefined): PricePt[] {
  const out: PricePt[] = [];
  if (!body?.t || !body.c) return out;
  for (let i = 0; i < body.t.length; i++) {
    const c = body.c[i];
    if (typeof c === "number" && c > 0) out.push({ t: body.t[i] + 60, price: c });
  }
  return out;
}

export type RoundTimes = { startTs: number; endTs: number };

/* WHICH MINUTES TO ASK FOR, or null when there is nothing to ask.
 *
 * Up to the bell, or up to now while the round runs; at most the last six hours
 * of it; and not at all for a round under five minutes, one not started, or
 * one older than the bars reach. "to" is rounded up to the minute so the URL
 * stays the same for a whole minute and a CDN can answer it, and "from" never
 * sits more than six hours before it, which the route refuses. */
export function barsWindow(d: RoundTimes, now: number): { from: number; to: number } | null {
  if (!d.startTs || !now || d.endTs - d.startTs < MIN_BARS_ROUND_SECS) return null;
  const last = Math.min(now, d.endTs);
  const to = now >= d.endTs ? d.endTs : Math.min(d.endTs, Math.ceil(now / 60) * 60);
  const from = Math.max(d.startTs, to - WINDOW_SECS);
  if (last - from < 60) return null;
  if (from < now - BARS_LOOKBACK_SECS) return null;
  return { from, to };
}

/* WHAT THE X AXIS SPANS. A round up to six hours is drawn whole, start to bell,
 * so a live line runs across the chart toward the bell marker and the viewer
 * sees how much of the round is left. A longer round shows its last six hours,
 * ending at the bell or now. */
export function xDomain(d: RoundTimes, now: number): [number, number] {
  const length = d.endTs - d.startTs;
  if (length <= WINDOW_SECS) return [d.startTs, Math.max(d.endTs, d.startTs + 60)];
  const end = Math.min(Math.max(now, d.startTs + 60), d.endTs);
  return [Math.max(d.startTs, end - WINDOW_SECS), end];
}

/** Half the height of the y axis, in percent: symmetric around the start, with
 *  10% headroom, and never zero so a flat line still has an axis. */
export function yHalfRange(series: readonly (readonly PctPt[])[]): number {
  let max = 0;
  for (const s of series) for (const p of s) if (Number.isFinite(p.v)) max = Math.max(max, Math.abs(p.v));
  return Math.max(max * 1.1, 0.001);
}

/** A side's value at `t`: the latest point at or before it, or null before its first. */
export function valueAt(series: readonly PctPt[], t: number): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) {
      found = series[mid].v;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Add a live price to a list, once per publish time, keeping the newest few. */
export function appendLive(list: readonly PricePt[], p: PricePt, max = MAX_LIVE_POINTS): PricePt[] {
  if (!(p.price > 0) || list.some((x) => x.t === p.t)) return list as PricePt[];
  return mergePoints(list, [p]).slice(-max);
}
