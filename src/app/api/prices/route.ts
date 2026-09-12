import { NextResponse, type NextRequest } from "next/server";

import { DEV_EXPO, devPrice } from "@/lib/devPrices";
import { liveQuotes } from "@/lib/marketPrices.server";
import { byTicker, type Stock } from "@/lib/stocks";
import type { Quote, Quotes } from "@/lib/pricemath";

export const dynamic = "force-dynamic";
/** It waits on a market data source, so give it more than the default ten. */
export const maxDuration = 30;

/* Prices for the stocks a page shows: /api/prices?t=TSLA,NVDA. Each price is
 * shared for a few seconds per server instance, so a stock everyone is
 * watching costs one upstream request per window, not one per visitor. */
const TTL_MS = 5_000;
const MAX_TICKERS = 60;
const cache = new Map<string, { at: number; quote: Quote }>();

/* DEVELOPMENT ONLY: synthetic quotes that wander, so every screen can be
 * exercised on a local validator with no market open. Refused outright in a
 * production build. These numbers never reach an outcome: the program only
 * reads the boundary prices a crank posts. */
function devQuotes(stocks: Stock[]): Quotes {
  const t = Math.floor(Date.now() / 1000);
  const quotes: Record<string, Quote> = {};
  for (const s of stocks) {
    quotes[s.ticker] = { ticker: s.ticker, price: String(devPrice(s.ticker, t)), expo: DEV_EXPO, conf: "2000", publishTime: t };
  }
  return { quotes, at: t };
}

export async function GET(req: NextRequest) {
  const asked = (req.nextUrl.searchParams.get("t") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const stocks = [...new Set(asked)]
    .slice(0, MAX_TICKERS)
    .map((t) => byTicker(t))
    .filter((s): s is Stock => !!s);
  if (!stocks.length) {
    return NextResponse.json({ quotes: {}, at: Math.floor(Date.now() / 1000), error: "Ask for ?t=TICKER,TICKER" }, { status: 400 });
  }

  if (process.env.DEV_FAKE_PRICES === "1" && process.env.NODE_ENV !== "production") {
    return NextResponse.json(devQuotes(stocks));
  }

  const now = Date.now();
  const quotes: Record<string, Quote> = {};
  const missing: Stock[] = [];
  for (const s of stocks) {
    const hit = cache.get(s.ticker);
    if (hit && now - hit.at < TTL_MS) quotes[s.ticker] = hit.quote;
    else missing.push(s);
  }

  let error: string | undefined;
  if (missing.length) {
    try {
      const fresh = await liveQuotes(missing);
      for (const [ticker, quote] of Object.entries(fresh)) {
        cache.set(ticker, { at: now, quote });
        quotes[ticker] = quote;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "price request failed";
    }
    // Anything the sources did not answer this time: the last known price.
    for (const s of missing) {
      if (!quotes[s.ticker] && cache.has(s.ticker)) quotes[s.ticker] = cache.get(s.ticker)!.quote;
    }
  }

  const body: Quotes = { quotes, at: Math.floor(now / 1000), ...(error && !Object.keys(quotes).length ? { error } : {}) };
  return NextResponse.json(body, { status: Object.keys(quotes).length || !error ? 200 : 503 });
}
