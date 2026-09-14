import "server-only";

/* Live prices for the page: what a stock trades at now, for showing moves and
 * sizing stakes. Never an input to an outcome; the program reads only the
 * boundary prices a crank posts.
 *
 * Each stock is shown at the price of the source that will settle it: Pyth
 * for Pyth-priced stocks (while this server holds a Pyth key), the market data
 * the oracle signs from for the rest. That source answers up to 20 symbols a
 * request, so the whole roster is a handful of requests, and the results are
 * shared for a few seconds by everyone polling. Before the open and after the
 * close, the oracle signs from the exchange's extended-hours minute bars, and
 * this reads the latest of them; see extendedPrices. Once the exchange shuts,
 * the oracle reads a stock's perp or pool instead, and so does this; see
 * offHoursPrices. Every quote says which of those it came from (Quote.source),
 * so a page can name it beside the number. */

import { bareFeed, hermes } from "@/lib/hermes.server";
import { lastClose, liveSourceFor, parseAllMids, type LiveSource } from "@/lib/livePrice";
import { session } from "@/lib/market";
import {
  BAR_SETTLE_SECS,
  fetchPerpBars,
  fetchPoolBars,
  fxFor,
  QUOTE_EXPO,
  trimmedMeanAtBoundary,
  type Bars,
} from "@/lib/oracle";
import { withPrev, type Quote } from "@/lib/pricemath";
import { byFeed, quoteSymbolFor, type Stock } from "@/lib/stocks";

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

/* A few at a time, however many stocks a page asks for, so one busy page
 * never fires a burst of requests at a free source. */
async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/* EXTENDED HOURS: THE LATEST MINUTE, NOT THE REGULAR CLOSE.
 *
 * From 4am to the open and from the close to 8pm New York time, the oracle
 * signs from the exchange's one-minute bars, pre-market and after-hours
 * included, while the daily quote above stays frozen at the regular session's
 * last price. A round in those hours showed that frozen price and moved
 * nothing. So each stock is shown at its latest minute bar instead.
 *
 * The same source answers minute bars for up to 20 symbols in one request.
 * That was checked against the per-symbol chart the oracle reads (fetchBars)
 * across a whole Friday for five stocks, pre-market to 8pm: the same minutes at
 * the same closes to within float rounding, except that minutes with no trade
 * are left out rather than sent as null. Asking per symbol instead would cost a
 * stock picker sixty requests every few seconds, from the address the settling
 * crank also reads bars from; this costs three.
 *
 * Only bars from the last hour count, so a quiet stock never passes off a print
 * from the day before as now. A stock with none is left out here and shown at
 * its regular close, labelled as that. */
const EXTENDED_LOOKBACK_SECS = 3_600;

type MinuteSpark = {
  symbol: string;
  response?: {
    meta?: { regularMarketPrice?: number };
    timestamp?: number[];
    indicators?: { quote?: { close?: (number | null)[] }[] };
  }[];
};

async function extendedBatch(
  symbols: string[],
  now: number,
): Promise<Map<string, { price: number; time: number; close?: number }>> {
  const r = await fetch(
    `${SPARK}?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1d&interval=1m&includePrePost=true`,
    { headers: { "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" }, cache: "no-store" },
  );
  if (!r.ok) throw new Error(`market data HTTP ${r.status}`);
  const body = (await r.json()) as { spark?: { result?: MinuteSpark[] } };
  const out = new Map<string, { price: number; time: number; close?: number }>();
  for (const s of body.spark?.result ?? []) {
    const res = s.response?.[0];
    const t = res?.timestamp ?? [];
    const c = res?.indicators?.quote?.[0]?.close ?? [];
    const recent: Bars = { t: [], c: [] };
    for (let i = 0; i < t.length; i++) {
      if (t[i] < now - EXTENDED_LOOKBACK_SECS || t[i] > now) continue;
      recent.t.push(t[i]);
      recent.c.push(c[i] ?? null);
    }
    const last = lastClose(recent);
    if (!last) continue;
    const close = res?.meta?.regularMarketPrice;
    out.set(s.symbol, { ...last, ...(close && close > 0 ? { close } : {}) });
  }
  return out;
}

/** Extended-hours quotes for US stocks priced in dollars, by ticker. A stock
 * with no trade in the last hour, or whose batch failed, is left out. */
async function extendedPrices(stocks: Stock[], now: number): Promise<Record<string, Quote>> {
  const symbols = [...new Set(stocks.map((s) => s.quote))];
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += PER_REQUEST) batches.push(symbols.slice(i, i + PER_REQUEST));
  const seen = new Map<string, { price: number; time: number; close?: number }>();
  const results = await Promise.allSettled(batches.map((b) => extendedBatch(b, now)));
  for (const res of results) if (res.status === "fulfilled") for (const [k, v] of res.value) seen.set(k, v);

  const quotes: Record<string, Quote> = {};
  for (const s of stocks) {
    const p = seen.get(s.quote);
    if (!p) continue;
    /* The move is measured from the regular close, as off-hours below: this
     * price belongs to no regular session, so what it has moved is everything
     * since the bell. The minute still forming ends in the future, so its
     * time is capped at now. */
    quotes[s.ticker] = {
      ticker: s.ticker,
      price: String(Math.round(p.price * 10 ** -EXPO)),
      expo: EXPO,
      conf: "0",
      publishTime: Math.min(p.time, now),
      ...(p.close ? { prev: String(Math.round(p.close * 10 ** -EXPO)) } : {}),
      source: "extended",
    };
  }
  return quotes;
}

/* Every mid on a perp dex, in one request. Asked with no dex, `allMids`
 * answers for Hyperliquid's own markets; naming one ("xyz", where the roster's
 * equity perps trade) answers for that dex instead, keyed by the full coin
 * name ("xyz:NVDA") that src/data/perps.json already pins. */
async function perpMids(dex: string): Promise<Record<string, number>> {
  const r = await fetch(HYPERLIQUID, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`perp mids HTTP ${r.status}`);
  return parseAllMids(await r.json());
}

/* OFF-HOURS, THE EXCHANGE IS NOT WHAT SETTLES.
 *
 * Once a stock's exchange shuts, its quote is the last close and stays there
 * until morning, while the oracle prices a fight ending now on the stock's
 * perp, or on its pool, and both keep moving. Showing the close held a round's
 * health bars still all weekend and then reported a result they never showed.
 * So each stock goes through the oracle's own rule for a boundary of now
 * (pricedAt, by way of liveSourceFor), and is read from the market that rule
 * names.
 *
 * By ticker: a price in dollars, or null where the stock is priced off-hours
 * but that market could not be read just now. A stock missing from the map is
 * on its exchange (or Pyth) as before. That includes every stock pricedAt
 * calls a wait, and every Pyth stock at any hour: it keeps Pyth's latest print
 * (where this server holds a Pyth key), which is what settles it, rather than
 * a perp or pool that never will. Null means leave it
 * out, so the caller keeps its last good price rather than snapping back to a
 * close that is not what settles, which is also why a perp that has not
 * answered never falls through to anything else: the oracle does not either. */
async function offHoursPrices(
  stocks: Stock[],
  now: number,
): Promise<Map<string, { price: number; publishTime: number; source: "perp" | "pool" } | null>> {
  const out = new Map<string, { price: number; publishTime: number; source: "perp" | "pool" } | null>();
  const perps: { ticker: string; coin: string }[] = [];
  const pools: { ticker: string; pool: string }[] = [];
  for (const s of stocks) {
    const from = liveSourceFor(s, now);
    const where = quoteSymbolFor(s.feed);
    if (from === "perp" && where?.perp) perps.push({ ticker: s.ticker, coin: where.perp });
    else if (from === "pool" && where?.pool) pools.push({ ticker: s.ticker, pool: where.pool });
  }

  /* The perp's mid, now. The oracle signs the close of the minute a boundary
   * falls in, so the two agree to within a minute of trading. One request per
   * dex covers every coin on it. */
  const dexOf = (coin: string) => (coin.includes(":") ? coin.split(":")[0] : "");
  const dexes = [...new Set(perps.map((p) => dexOf(p.coin)))];
  const mids = new Map<string, Record<string, number>>();
  await Promise.all(
    dexes.map((dex) =>
      perpMids(dex)
        .then((m) => void mids.set(dex, m))
        .catch(() => undefined),
    ),
  );
  const unanswered: { ticker: string; coin: string }[] = [];
  for (const { ticker, coin } of perps) {
    const mid = mids.get(dexOf(coin))?.[coin];
    if (mid) out.set(ticker, { price: mid, publishTime: now, source: "perp" });
    else unanswered.push({ ticker, coin });
  }

  /* A coin the mids left out, or a dex that did not answer: the same perp's
   * latest finished minute, which is what the oracle itself reads. Pinned to
   * whole minutes so fetchPerpBars can keep the answer (a finished candle never
   * changes), and a few at a time. Still the perp or nothing, for the reason
   * above. */
  const minute = Math.floor(now / 60) * 60;
  await eachLimited(unanswered, 6, async ({ ticker, coin }) => {
    try {
      const bars = await fetchPerpBars(coin, minute - 300, minute);
      const finished: Bars = { t: [], c: [] };
      for (let i = 0; i < bars.t.length; i++) {
        if (bars.t[i] + 60 > minute) continue;
        finished.t.push(bars.t[i]);
        finished.c.push(bars.c[i]);
      }
      const last = lastClose(finished);
      out.set(ticker, last ? { price: last.price, publishTime: last.time, source: "perp" } : null);
    } catch {
      out.set(ticker, null);
    }
  });

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
        if (m) {
          out.set(ticker, { price: Number(m.price) * 10 ** QUOTE_EXPO, publishTime: m.publishTime, source: "pool" });
        }
      } catch {
        out.set(ticker, null);
      }
    }),
  );
  return out;
}

/** Every stock at the price of the source that settles it now, tagged with
 * that source: Pyth where it prices the stock; the latest extended-hours
 * minute before the open and after the close; the stock's perp or pool while
 * its exchange is shut and the oracle reads one of those; and the exchange's
 * price otherwise, which outside the regular session is its last close. */
export async function liveQuotes(stocks: Stock[]): Promise<Record<string, Quote>> {
  const now = Math.floor(Date.now() / 1000);
  const want = new Map(stocks.map((s) => [s.ticker, liveSourceFor(s, now)] as const));

  /* A listing quoted in another currency keeps the daily path, which converts
   * it to dollars; the minute path does not. */
  const isExtended = (s: Stock) => want.get(s.ticker) === "extended" && s.currency === "USD";
  const extendedStocks = stocks.filter(isExtended);
  const daily = stocks.filter((s) => !isExtended(s));

  const [market, pyth, offHours, extended] = await Promise.all([
    marketQuotes(daily),
    pythQuotes(daily.filter((s) => s.source === "pyth")).catch(() => ({}) as Record<string, Quote>),
    offHoursPrices(daily, now),
    extendedPrices(extendedStocks, now).catch(() => ({}) as Record<string, Quote>),
  ]);
  // Extended-hours stocks with no recent minute: their regular close, as before.
  const unread = extendedStocks.filter((s) => !extended[s.ticker]);
  const closes = unread.length ? await marketQuotes(unread).catch(() => ({}) as Record<string, Quote>) : {};

  /* An exchange quote is a live price only in the regular session. Outside
   * it, whatever reached this path (a Pyth stock without Pyth, a pool too quiet
   * to price, a stock that waits for the open) is the last close, and says so.
   * A listing abroad keeps its own hours, which session() does not model. */
  const inSession = session(now * 1_000) === "open";
  const quotes: Record<string, Quote> = {};
  for (const s of stocks) {
    const q = market[s.ticker] ?? closes[s.ticker];
    if (!q) continue;
    const source: LiveSource = s.market !== "US" || inSession ? "regular" : "last";
    quotes[s.ticker] = { ...q, source };
  }
  /* Pyth's quote replaces the exchange's, but Pyth never sends a previous
   * close, and the day's move is measured from the regular close whichever
   * feed the price comes from. So the exchange's close rides along, rescaled
   * to Pyth's exponent (withPrev); the price and its source stay Pyth's. */
  for (const [ticker, q] of Object.entries(pyth)) quotes[ticker] = { ...withPrev(q, market[ticker]), source: "pyth" };

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
      source: live.source,
    };
  }
  for (const [ticker, q] of Object.entries(extended)) quotes[ticker] = q;
  return quotes;
}
