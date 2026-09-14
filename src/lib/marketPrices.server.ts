import "server-only";

/* Live prices for the page: what a stock trades at now, for showing moves and
 * sizing stakes. Never an input to an outcome; the program reads only the
 * boundary prices a crank posts.
 *
 * Each stock is shown at the price of the source that will settle it: Pyth
 * for Pyth-priced stocks (while this server holds a Pyth key), the market data
 * the oracle signs from for the rest. That source answers up to 20 symbols a
 * request, so the whole roster is a handful of requests, and the results are
 * shared for a few seconds by everyone polling. Once the exchange shuts, the
 * oracle reads a stock's perp or pool instead, and so does this; see
 * offHoursPrices below. */

import { bareFeed, hermes } from "@/lib/hermes.server";
import { BAR_SETTLE_SECS, fetchPoolBars, fxFor, QUOTE_EXPO, trimmedMeanAtBoundary } from "@/lib/oracle";
import type { Quote } from "@/lib/pricemath";
import { byFeed, pricedAt, quoteSymbolFor, type Stock } from "@/lib/stocks";

const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark";
const HYPERLIQUID = "https://api.hyperliquid.xyz/info";
const PER_REQUEST = 20;
const EXPO = -4;

type SparkResult = {
  symbol: string;
  response?: {
    meta?: { regularMarketPrice?: number; regularMarketTime?: number; chartPreviousClose?: number };
    indicators?: { quote?: { close?: (number | null)[] }[] };
  }[];
};

/* Five days of daily closes rather than one, which costs the same request and
 * carries the close before this one. That is what a move on the day is
 * measured against, so every page can show one without asking again. */
async function sparkBatch(symbols: string[]): Promise<Map<string, { price: number; time: number; prev?: number }>> {
  const r = await fetch(`${SPARK}?symbols=${symbols.map(encodeURIComponent).join(",")}&range=5d&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`market data HTTP ${r.status}`);
  const body = (await r.json()) as { spark?: { result?: SparkResult[] } };
  const out = new Map<string, { price: number; time: number; prev?: number }>();
  for (const s of body.spark?.result ?? []) {
    const res = s.response?.[0];
    const meta = res?.meta;
    if (!meta?.regularMarketPrice || !(meta.regularMarketPrice > 0)) continue;
    /* The session before the latest one. The final close in the series is the
     * current session (still moving while it is open), so the one before it is
     * what today's move is measured from. */
    const closes = (res?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === "number" && c > 0);
    const prev = closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose;
    out.set(s.symbol, { price: meta.regularMarketPrice, time: meta.regularMarketTime ?? 0, prev });
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
  const seen = new Map<string, { price: number; time: number; prev?: number }>();
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
    let prev = p.prev;
    if (prev !== undefined && fx) {
      const rate = seen.get(fx.symbol)?.price;
      prev = rate ? prev * rate * fx.scale : undefined;
    }
    quotes[s.ticker] = {
      ticker: s.ticker,
      price: String(Math.round(price * 10 ** -EXPO)),
      expo: EXPO,
      conf: "0",
      publishTime: p.time,
      ...(prev !== undefined && prev > 0 ? { prev: String(Math.round(prev * 10 ** -EXPO)) } : {}),
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

/* Every mid on a perp dex, in one request. Asked with no dex, `allMids`
 * answers for Hyperliquid's own markets; naming one ("xyz", where the roster's
 * equity perps trade) answers for that dex instead, keyed by the full coin
 * name ("xyz:NVDA") that src/data/perps.json already pins. */
async function perpMids(dex: string): Promise<Record<string, string>> {
  const r = await fetch(HYPERLIQUID, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`perp mids HTTP ${r.status}`);
  return ((await r.json()) as Record<string, string> | null) ?? {};
}

/* OFF-HOURS, THE EXCHANGE IS NOT WHAT SETTLES.
 *
 * Once a stock's exchange shuts, its quote is the last close and stays there
 * until morning, while the oracle prices a fight ending now on the stock's
 * perp, or on its pool, and both keep moving. Showing the close held a round's
 * health bars still all weekend and then reported a result they never showed.
 * So each stock goes through the oracle's own rule for a boundary of now
 * (pricedAt), and is read from the market that rule names.
 *
 * By ticker: a price in dollars, or null where the stock is priced off-hours
 * but that market could not be read just now. A stock missing from the map is
 * on its exchange (or Pyth) as before. Null means leave it out, so the caller
 * keeps its last good price rather than snapping back to a close that is not
 * what settles, which is also why a perp that has not answered never falls
 * through to anything else: the oracle does not either. */
async function offHoursPrices(
  stocks: Stock[],
  now: number,
): Promise<Map<string, { price: number; publishTime: number } | null>> {
  const out = new Map<string, { price: number; publishTime: number } | null>();
  const perps: { ticker: string; coin: string }[] = [];
  const pools: { ticker: string; pool: string }[] = [];
  for (const s of stocks) {
    const from = pricedAt(s.ticker, now);
    const where = quoteSymbolFor(s.feed);
    if (from === "perp" && where?.perp) perps.push({ ticker: s.ticker, coin: where.perp });
    else if (from === "pool" && where?.pool) pools.push({ ticker: s.ticker, pool: where.pool });
  }

  /* The perp's mid, now. The oracle signs the close of the minute a boundary
   * falls in, so the two agree to within a minute of trading. One request per
   * dex covers every coin on it. */
  const dexOf = (coin: string) => (coin.includes(":") ? coin.split(":")[0] : "");
  const dexes = [...new Set(perps.map((p) => dexOf(p.coin)))];
  const mids = new Map<string, Record<string, string>>();
  await Promise.all(
    dexes.map((dex) =>
      perpMids(dex)
        .then((m) => void mids.set(dex, m))
        .catch(() => undefined),
    ),
  );
  for (const { ticker, coin } of perps) {
    const mid = Number(mids.get(dexOf(coin))?.[coin]);
    out.set(ticker, mid > 0 ? { price: mid, publishTime: now } : null);
  }

  /* The pool, read exactly as the oracle reads it: the trimmed mean of its
   * recent minutes, at the latest whole minute whose bars have settled. That
   * is the price it would sign for a fight ending then. Pinning the boundary
   * to the minute also lets fetchPoolBars keep the answer, so however often
   * pages poll, each pool costs its free source one request a minute. */
  const boundary = Math.floor((now - BAR_SETTLE_SECS) / 60) * 60;
  await Promise.all(
    pools.map(async ({ ticker, pool }) => {
      try {
        const m = trimmedMeanAtBoundary(await fetchPoolBars(pool, boundary), boundary);
        // A pool too quiet to price falls through to the exchange, as it does
        // in the oracle, so the stock stays off this map.
        if (m) out.set(ticker, { price: Number(m.price) * 10 ** QUOTE_EXPO, publishTime: m.publishTime });
      } catch {
        out.set(ticker, null);
      }
    }),
  );
  return out;
}

/** Every stock at the price of the source that settles it now: Pyth where it
 * prices the stock, the stock's perp or pool while its exchange is shut and
 * the oracle reads one of those, and the exchange's price otherwise. */
export async function liveQuotes(stocks: Stock[]): Promise<Record<string, Quote>> {
  const now = Math.floor(Date.now() / 1000);
  const pythStocks = stocks.filter((s) => s.source === "pyth");
  const [market, pyth, offHours] = await Promise.all([
    marketQuotes(stocks),
    pythQuotes(pythStocks).catch(() => ({}) as Record<string, Quote>),
    offHoursPrices(stocks, now),
  ]);
  const quotes: Record<string, Quote> = { ...market, ...pyth };
  for (const [ticker, live] of offHours) {
    if (!live) {
      delete quotes[ticker];
      continue;
    }
    /* The move is measured from the exchange's last close, the price the
     * quote above was frozen at, rather than the close before it: this price
     * belongs to no session, so what it has moved is everything since the
     * bell. */
    const close = market[ticker];
    quotes[ticker] = {
      ticker,
      price: String(Math.round(live.price * 10 ** -EXPO)),
      expo: EXPO,
      conf: "0",
      publishTime: live.publishTime,
      ...(close ? { prev: close.price } : {}),
    };
  }
  return quotes;
}
