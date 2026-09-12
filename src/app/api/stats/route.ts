import { NextResponse, type NextRequest } from "next/server";

import { devPrice } from "@/lib/devPrices";
import { dailyCloses } from "@/lib/marketHistory.server";
import { byTicker, type Stock } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** It waits on a market data source, so give it more than the default ten. */
export const maxDuration = 30;

/* A month of daily closes for the stocks a pick screen is showing:
 * /api/stats?t=TSLA,NVDA. Daily bars change once a day, so one fetch is shared
 * for an hour per server instance. */
const TTL_MS = 60 * 60 * 1_000;
const MAX_TICKERS = 8;
const cache = new Map<string, { at: number; closes: number[] }>();

/* DEVELOPMENT ONLY: a month of synthetic closes, so the pick screen has stats
 * on a local validator with no market open. Refused in a production build. */
const devCloses = (s: Stock) => {
  const day = 86_400;
  const t = Math.floor(Date.now() / 1000);
  return Array.from({ length: 22 }, (_, i) => Number(devPrice(s.ticker, t - (21 - i) * day)) / 1e5);
};

export async function GET(req: NextRequest) {
  const asked = (req.nextUrl.searchParams.get("t") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const stocks = [...new Set(asked)]
    .slice(0, MAX_TICKERS)
    .map((t) => byTicker(t))
    .filter((s): s is Stock => !!s);
  if (!stocks.length) {
    return NextResponse.json({ closes: {}, error: "Ask for ?t=TICKER,TICKER" }, { status: 400 });
  }

  if (process.env.DEV_FAKE_PRICES === "1" && process.env.NODE_ENV !== "production") {
    return NextResponse.json({ closes: Object.fromEntries(stocks.map((s) => [s.ticker, devCloses(s)])) });
  }

  const now = Date.now();
  const closes: Record<string, number[]> = {};
  const missing: Stock[] = [];
  for (const s of stocks) {
    const hit = cache.get(s.ticker);
    if (hit && now - hit.at < TTL_MS) closes[s.ticker] = hit.closes;
    else missing.push(s);
  }

  let error: string | undefined;
  if (missing.length) {
    try {
      const fresh = await dailyCloses(missing);
      for (const [ticker, series] of Object.entries(fresh)) {
        cache.set(ticker, { at: now, closes: series });
        closes[ticker] = series;
      }
    } catch (e) {
      // Stats are decoration: a screen without them still picks a fight.
      error = e instanceof Error ? e.message : "market history unavailable";
    }
  }

  return NextResponse.json({ closes, ...(error ? { error } : {}) });
}
