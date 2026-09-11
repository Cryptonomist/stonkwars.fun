import "server-only";

/* Live prices for the page: what a stock trades at now, for showing moves and
 * sizing stakes. Never an input to an outcome; the program reads only the
 * boundary prices a crank posts.
 *
 * Each stock is shown at the price of the source that will settle it: Pyth
 * for Pyth-priced stocks (while this server holds a Pyth key), the market data
 * the oracle signs from for the rest. That source answers up to 20 symbols a
 * request, so the whole roster is a handful of requests, and the results are
 * shared for a few seconds by everyone polling. */

import { bareFeed, hermes } from "@/lib/hermes.server";
import { fxFor } from "@/lib/oracle";
import type { Quote } from "@/lib/pricemath";
import { byFeed, type Stock } from "@/lib/stocks";

const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark";
const PER_REQUEST = 20;
const EXPO = -4;

type SparkResult = {
  symbol: string;
  response?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[];
};

async function sparkBatch(symbols: string[]): Promise<Map<string, { price: number; time: number }>> {
  const r = await fetch(`${SPARK}?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1d&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`market data HTTP ${r.status}`);
  const body = (await r.json()) as { spark?: { result?: SparkResult[] } };
  const out = new Map<string, { price: number; time: number }>();
  for (const s of body.spark?.result ?? []) {
    const meta = s.response?.[0]?.meta;
    if (meta?.regularMarketPrice && meta.regularMarketPrice > 0) {
      out.set(s.symbol, { price: meta.regularMarketPrice, time: meta.regularMarketTime ?? 0 });
    }
  }
  return out;
}

/** Market prices for `stocks`, by ticker, in dollars: a stock listed abroad is
 * converted at the current rate, as the oracle converts it at a boundary.
 * Symbols the source does not answer for are left out rather than failing the
 * rest. */
export async function marketQuotes(stocks: Stock[]): Promise<Record<string, Quote>> {
  const fxSymbols = [...new Set(stocks.map((s) => fxFor(s.currency)?.symbol).filter((x): x is string => !!x))];
  const symbols = [...new Set([...stocks.map((s) => s.quote), ...fxSymbols])];
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += PER_REQUEST) batches.push(symbols.slice(i, i + PER_REQUEST));
  const results = await Promise.allSettled(batches.map((b) => sparkBatch(b)));
  const seen = new Map<string, { price: number; time: number }>();
  for (const res of results) if (res.status === "fulfilled") for (const [k, v] of res.value) seen.set(k, v);

  const quotes: Record<string, Quote> = {};
  for (const s of stocks) {
    const p = seen.get(s.quote);
    if (!p) continue;
    let price = p.price;
    const fx = fxFor(s.currency);
    if (fx) {
      const rate = seen.get(fx.symbol)?.price;
      if (!rate) continue;
      price *= rate * fx.scale;
    } else if (s.currency !== "USD") {
      continue;
    }
    quotes[s.ticker] = {
      ticker: s.ticker,
      price: String(Math.round(price * 10 ** -EXPO)),
      expo: EXPO,
      conf: "0",
      publishTime: p.time,
    };
  }
  return quotes;
}

/** Pyth's latest prices for `stocks`, by ticker. Empty without a Pyth key. */
export async function pythQuotes(stocks: Stock[]): Promise<Record<string, Quote>> {
  if (!stocks.length || !process.env.PYTH_API_KEY) return {};
  const res = await hermes().getLatestPriceUpdates(
    stocks.map((s) => s.feed),
    { parsed: true, ignoreInvalidPriceIds: true },
  );
  const quotes: Record<string, Quote> = {};
  for (const p of res.parsed ?? []) {
    const stock = byFeed(bareFeed(p.id));
    if (!stock) continue;
    quotes[stock.ticker] = {
      ticker: stock.ticker,
      price: String(p.price.price),
      expo: p.price.expo,
      conf: String(p.price.conf),
      publishTime: p.price.publish_time,
    };
  }
  return quotes;
}

/** Every stock at the price of the source that settles it, falling back to
 * the market price where Pyth has none. */
export async function liveQuotes(stocks: Stock[]): Promise<Record<string, Quote>> {
  const pythStocks = stocks.filter((s) => s.source === "pyth");
  const [market, pyth] = await Promise.all([
    marketQuotes(stocks),
    pythQuotes(pythStocks).catch(() => ({}) as Record<string, Quote>),
  ]);
  return { ...market, ...pyth };
}
