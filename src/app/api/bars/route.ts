import { NextResponse, type NextRequest } from "next/server";

import { STEPS } from "@/lib/chart";
import { mergeBars } from "@/lib/livePrice";
import { session } from "@/lib/market";
import { fetchBars, fetchPerpBars, MAX_LOOKBACK_SECS, type Bars } from "@/lib/oracle";
import { byTicker, quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** It waits on a market data source, so give it more than the default ten. */
export const maxDuration = 30;

/* ONE-MINUTE BARS FOR A CHART: /api/bars?t=NVDA&from=UNIX&to=UNIX.
 *
 * FOR DISPLAY ONLY. These bars draw the path a fight or a stock took between
 * two moments, and are never an input to any result: the program reads only
 * the start and bell prices a crank posts, each signed or checked on chain.
 *
 * Each minute comes from the market the oracle would read at that minute: the
 * exchange's bars (pre-market and after-hours included) while it trades, and
 * the stock's Hyperliquid perp once it shuts. A stock with no perp has nothing
 * to draw while its exchange is shut, and the answer says so instead of
 * joining the gap with a line that never traded. Every point carries its
 * source, so a chart can show where the market changed hands.
 *
 * Only US listings: session() models New York's hours and nobody else's.
 * Ranges are capped at six hours of minutes, and reach back no further than the
 * minute bars do. */

const MAX_RANGE_SECS = 6 * 3_600;
/** A daily bar covers whole sessions, so it comes from the exchange alone. */
const DAILY = 86_400;
/** A range that ended this long ago has every minute final. */
const FINAL_AFTER_SECS = 120;
const MAX_KEPT = 200;

type Body = { t: number[]; c: number[]; src: ("exchange" | "perp")[]; note?: string };

/* Finished ranges never change, so each is kept per server instance. The
 * oldest is dropped first once there are too many. */
const finished = new Map<string, Body>();

const bad = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

const EMPTY: Bars = { t: [], c: [] };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const stock = byTicker((params.get("t") ?? "").trim());
  if (!stock || stock.market !== "US") return bad(422, "Only US listings chart here");

  const from = Number(params.get("from"));
  const asked = Number(params.get("to"));
  if (!Number.isInteger(from) || !Number.isInteger(asked)) return bad(400, "Ask for ?t=TICKER&from=UNIX&to=UNIX");
  if (asked <= from) return bad(400, "to must be after from");

  /* One bar, in seconds: a minute unless a chart asks for a wider one, and only
   * the sizes the market data behind this serves (lib/chart.ts STEPS). */
  const step = params.get("step") ? Number(params.get("step")) : 60;
  const rule = STEPS[step];
  if (!rule) return bad(400, `step must be one of ${Object.keys(STEPS).join(", ")} seconds`);
  if (asked - from > rule.maxRangeSecs) return bad(400, `At most ${Math.round(rule.maxRangeSecs / 3_600)} hours at ${step} second bars`);

  const now = Math.floor(Date.now() / 1000);
  const lookback = Math.min(rule.maxLookbackSecs, step === 60 ? MAX_LOOKBACK_SECS : rule.maxLookbackSecs);
  if (from < now - lookback) return bad(400, `${step} second bars reach back ${Math.round(lookback / 86_400)} days`);
  const to = Math.min(asked, now);
  if (to <= from) return bad(400, "That range has not started yet");

  const key = `${stock.ticker}:${from}:${to}:${step}`;
  const isFinal = to < now - FINAL_AFTER_SECS;
  const cacheControl = isFinal ? "public, s-maxage=86400" : "public, s-maxage=20";
  const kept = finished.get(key);
  if (kept) return NextResponse.json(kept, { headers: { "cache-control": cacheControl } });

  /* Which markets the range needs, minute by minute. The exchange only if some
   * minute is not shut; the perp only if some minute is and there is one. */
  const daily = step >= DAILY;
  const isClosed = (t: number) => !daily && session(t * 1_000) === "closed";
  let anyOpen = daily;
  let anyClosed = false;
  for (let m = Math.floor(from / step) * step; m <= to && !(anyOpen && anyClosed); m += step) {
    if (isClosed(m)) anyClosed = true;
    else anyOpen = true;
  }
  const coin = quoteSymbolFor(stock.feed)?.perp;

  let exchange = EMPTY;
  let perp = EMPTY;
  try {
    [exchange, perp] = await Promise.all([
      anyOpen ? fetchBars(stock.quote, from, to, rule.yahoo) : Promise.resolve(EMPTY),
      anyClosed && coin ? fetchPerpBars(coin, from, to, rule.perp) : Promise.resolve(EMPTY),
    ]);
  } catch {
    // The upstream message names the source and its status; neither helps a chart.
    return bad(502, "Bars are unavailable right now");
  }

  const merged = mergeBars(exchange, perp, isClosed, step);
  // Nothing past the end of the range, including a last-trade point stamped late.
  const body: Body = { t: [], c: [], src: [] };
  for (let i = 0; i < merged.t.length; i++) {
    if (merged.t[i] < Math.floor(from / step) * step || merged.t[i] > to) continue;
    body.t.push(merged.t[i]);
    body.c.push(merged.c[i]);
    body.src.push(merged.src[i]);
  }
  if (anyClosed && !coin) body.note = "No minute bars while the exchange is shut for this stock.";

  if (isFinal) {
    if (finished.size >= MAX_KEPT) finished.delete(finished.keys().next().value!);
    finished.set(key, body);
  }
  return NextResponse.json(body, { headers: { "cache-control": cacheControl } });
}
