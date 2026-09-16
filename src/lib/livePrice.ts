/* WHICH MARKET A LIVE PRICE COMES FROM, AND THE SMALL PIECES OF READING IT.
 *
 * A fight is decided by the oracle's rule for a boundary: the exchange's
 * one-minute bars from 4am to 8pm New York time, and the stock's perp or pool
 * once the exchange is shut. The live price on a page should come from the same
 * place, or a round's health bars show one market while the bell reads another.
 * This names that place for a stock at a moment, so the server can fetch it and
 * the page can say it out loud.
 *
 * Pure on purpose: no fetch and no server-only import, so the tests, the prices
 * route and any component can share one answer. Nothing here is an input to a
 * result. The program reads only the boundary prices a crank posts. */

import { session } from "./market";
import type { Bars } from "./oracle";
import { pricedAt, type Stock } from "./stocks";

/* The sources a live quote can carry.
 *
 * "pyth": Pyth's own update, for the stocks it prices here.
 * "regular": the exchange's price during the regular session (or a listing
 *   abroad, whose hours we do not model).
 * "extended": the last one-minute bar of pre-market or after-hours trading,
 *   which is what the oracle signs from in those hours.
 * "perp": the Hyperliquid perp's mid, while the exchange is shut.
 * "pool": the trimmed mean of the stock's Solana pool, read exactly as the
 *   oracle reads it, while the exchange is shut and there is no perp.
 * "composite": from COMPOSITE_FROM, while the exchange is shut, the median of
 *   the latest prices of the markets pinned for the stock in venues247.json
 *   (liveComposite.ts), the same markets the composite settles on.
 * "last": the exchange's last close. Either nothing prices the stock right now,
 *   or the market that should could not be read, and the page says so. */
export type LiveSource = "pyth" | "regular" | "extended" | "perp" | "pool" | "composite" | "last";

/** The market a live price for `stock` should come from at `nowSec`. */
export function liveSourceFor(stock: Stock, nowSec: number): LiveSource {
  if (stock.source === "pyth") return "pyth";
  if (stock.market !== "US") return "regular";
  const s = session(nowSec * 1_000);
  if (s === "open") return "regular";
  if (s === "pre" || s === "after") return "extended";
  /* Shut. Ask the oracle's own rule, so the two can never disagree about
   * which market prices a fight ending now. A stock with neither a perp nor a
   * pool waits for the open, and its last close is all there is to show. */
  const from = pricedAt(stock.ticker, nowSec);
  if (from === "perp") return "perp";
  if (from === "pool") return "pool";
  if (from === "composite") return "composite";
  return "last";
}

/* Hyperliquid's allMids answers with every mid as a decimal string. Anything
 * that is not a positive finite number is not a price, and is dropped rather
 * than shown as zero. */
export function parseAllMids(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const [coin, raw] of Object.entries(body as Record<string, unknown>)) {
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    if (typeof raw === "string" && raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[coin] = n;
  }
  return out;
}

/* The latest trade in a run of one-minute bars, and when its minute ended.
 *
 * The market data source sometimes appends a last-trade point stamped a
 * second before the minute ends, so the time is taken from the start of the
 * minute the point falls in. A minute with no trade (a null close) is skipped:
 * a quiet minute is not a price of zero. */
export function lastClose(bars: Bars): { price: number; time: number } | null {
  for (let i = Math.min(bars.t.length, bars.c.length) - 1; i >= 0; i--) {
    const close = bars.c[i];
    if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
    return { price: close, time: Math.floor(bars.t[i] / 60) * 60 + 60 };
  }
  return null;
}

export type MergedBars = {
  t: number[];
  c: number[];
  /** The bucket's open, and the extremes reached inside it. */
  o: number[];
  h: number[];
  l: number[];
  /** Traded size, or null where the market did not report one. */
  v: (number | null)[];
  src: ("exchange" | "perp")[];
};

/* ONE PATH, FROM TWO MARKETS.
 *
 * A chart that crosses a closing bell has to switch markets at the bell,
 * exactly as the oracle does: the exchange's bars while it trades, the perp's
 * once it shuts. Each minute is taken from one market only, chosen by
 * `isClosed`, so the two series never interleave into a zigzag. Points are
 * bucketed to the start of their minute, minutes with no trade are dropped,
 * and the result is in time order.
 *
 * A bucket wider than the bars that fall in it is built the way a candle is:
 * the first bar's open, the highest high and the lowest low reached inside it,
 * the last close, and the sizes added up. A market that reports no size leaves
 * null rather than zero, so a chart can tell "nobody traded" from "nobody
 * said". */
export function mergeBars(
  exchange: Bars,
  perp: Bars,
  isClosed: (t: number) => boolean,
  /** One bucket, in seconds. A chart asking for wider bars buckets by those. */
  stepSecs = 60,
): MergedBars {
  type Cell = { o: number; h: number; l: number; c: number; v: number | null; src: "exchange" | "perp" };
  const byMinute = new Map<number, Cell>();

  const take = (bars: Bars, src: "exchange" | "perp", wantClosed: boolean) => {
    const n = Math.min(bars.t.length, bars.c.length);
    for (let i = 0; i < n; i++) {
      const close = bars.c[i];
      if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
      const minute = Math.floor(bars.t[i] / stepSecs) * stepSecs;
      if (isClosed(minute) !== wantClosed) continue;

      // A source that gives no open, high or low prices that bar at its close.
      const priced = (col: (number | null)[] | undefined) => {
        const x = col?.[i];
        return x != null && Number.isFinite(x) && x > 0 ? x : close;
      };
      const raw = bars.v?.[i];
      const size = raw != null && Number.isFinite(raw) && raw >= 0 ? raw : null;

      /* A bar the market says nothing traded in has no traded range either. Its
       * high and low are then a quote rather than a print, and one stale quote
       * stretches the whole scale: an after-hours TSLA bar with a volume of
       * zero carried a low twenty dollars under its own open and close. Such a
       * bar reaches only as far as it opened and closed. A bar that reported no
       * size at all is left alone, since "nobody said" is not "nobody traded". */
      const quoteOnly = size === 0;
      const high = quoteOnly ? Math.max(priced(bars.o), close) : priced(bars.h);
      const low = quoteOnly ? Math.min(priced(bars.o), close) : priced(bars.l);

      const had = byMinute.get(minute);
      if (!had) {
        byMinute.set(minute, { o: priced(bars.o), h: high, l: low, c: close, v: size, src });
        continue;
      }
      /* Bars arrive oldest first, so a later one extends the bucket it falls
       * in and its close becomes the bucket's. The two markets never share a
       * bucket: isClosed gives each to one. */
      had.h = Math.max(had.h, high);
      had.l = Math.min(had.l, low);
      had.c = close;
      if (size !== null) had.v = (had.v ?? 0) + size;
    }
  };
  take(exchange, "exchange", false);
  take(perp, "perp", true);

  const minutes = [...byMinute.keys()].sort((a, b) => a - b);
  const cell = (m: number) => byMinute.get(m)!;
  return {
    t: minutes,
    c: minutes.map((m) => cell(m).c),
    o: minutes.map((m) => cell(m).o),
    h: minutes.map((m) => Math.max(cell(m).h, cell(m).o, cell(m).c)),
    l: minutes.map((m) => Math.min(cell(m).l, cell(m).o, cell(m).c)),
    v: minutes.map((m) => cell(m).v),
    src: minutes.map((m) => cell(m).src),
  };
}
