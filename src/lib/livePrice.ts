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

/* ONE PATH, FROM TWO MARKETS.
 *
 * A chart that crosses a closing bell has to switch markets at the bell,
 * exactly as the oracle does: the exchange's bars while it trades, the perp's
 * once it shuts. Each minute is taken from one market only, chosen by
 * `isClosed`, so the two series never interleave into a zigzag. Points are
 * bucketed to the start of their minute (the later point wins inside one),
 * minutes with no trade are dropped, and the result is in time order. */
export function mergeBars(
  exchange: Bars,
  perp: Bars,
  isClosed: (t: number) => boolean,
  /** One bucket, in seconds. A chart asking for wider bars buckets by those. */
  stepSecs = 60,
): { t: number[]; c: number[]; src: ("exchange" | "perp")[] } {
  const byMinute = new Map<number, { c: number; src: "exchange" | "perp" }>();
  const take = (bars: Bars, src: "exchange" | "perp", wantClosed: boolean) => {
    const n = Math.min(bars.t.length, bars.c.length);
    for (let i = 0; i < n; i++) {
      const close = bars.c[i];
      if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
      const minute = Math.floor(bars.t[i] / stepSecs) * stepSecs;
      if (isClosed(minute) !== wantClosed) continue;
      // Bars arrive oldest first, so a later point in the same minute is newer.
      // The two markets never share a minute: isClosed gives each to one.
      byMinute.set(minute, { c: close, src });
    }
  };
  take(exchange, "exchange", false);
  take(perp, "perp", true);

  const minutes = [...byMinute.keys()].sort((a, b) => a - b);
  return {
    t: minutes,
    c: minutes.map((m) => byMinute.get(m)!.c),
    src: minutes.map((m) => byMinute.get(m)!.src),
  };
}
