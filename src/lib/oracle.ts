/* The oracle: prices for the stocks no Pyth feed on this deployment covers.
 *
 * It answers the one question the program asks of every price source: what was
 * the first price of this stock at or after this moment? It reads completed
 * one-minute bars of the stock's regular session, takes the close of the bar
 * that contains the moment (or of the first bar after it, when the market was
 * shut), and signs that answer in the 78-byte format
 * programs/duel/src/quote.rs reads.
 *
 * The bars are history, so the answer does not depend on when it is asked: a
 * crank that runs an hour late still gets the price at the bell, and asking
 * twice gets the same signed bytes (Ed25519 signatures are deterministic).
 * There is nothing for a settler to shop between.
 *
 * WHAT THIS KEY IS TRUSTED WITH. A duel with a signed side believes this key
 * about the market. Every quote it signs is public in the transaction that
 * used it, next to the bar it claims to come from, so a false one is provable
 * after the fact; it is not preventable. That is the trade for pricing every
 * stock instead of three, and the app labels each fight with its source.
 *
 * No "server-only" import: scripts/settler.ts runs this from Node too. Nothing
 * here reads the key; callers pass it in.
 */

import { Ed25519Program, type Keypair, type TransactionInstruction } from "@solana/web3.js";

import { session } from "./market";

export const QUOTE_PREFIX = "STONKWARS:PRICE:v1";
export const QUOTE_LEN = 78;
/** Prices are signed as integers of 1/10,000th of the quote currency. */
export const QUOTE_EXPO = -4;
/** How long after a bar closes before it is trusted not to change. */
export const BAR_SETTLE_SECS = 20;
/** One-minute bars reach back this far at the data source. */
export const MAX_LOOKBACK_SECS = 29 * 86_400;

export type Quote = {
  /** The stock's feed id, hex without 0x: Asset::feed_id. */
  feed: string;
  boundary: number;
  price: bigint;
  expo: number;
  publishTime: number;
};

export function quoteMessage(q: Quote): Uint8Array {
  const feed = Buffer.from(q.feed.replace(/^0x/, ""), "hex");
  if (feed.length !== 32) throw new Error(`Feed id must be 32 bytes, got ${feed.length}`);
  const m = new Uint8Array(QUOTE_LEN);
  const v = new DataView(m.buffer);
  m.set(new TextEncoder().encode(QUOTE_PREFIX), 0);
  m.set(feed, 18);
  v.setBigInt64(50, BigInt(q.boundary), true);
  v.setBigInt64(58, q.price, true);
  v.setInt32(66, q.expo, true);
  v.setBigInt64(70, BigInt(q.publishTime), true);
  return m;
}

/** The Ed25519 program instruction that carries a signed quote into a start
 * or settle transaction. It must sit in the same transaction as the duel
 * instruction; where in it does not matter. */
export function signedQuoteInstruction(oracle: Keypair, q: Quote): TransactionInstruction {
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: oracle.secretKey,
    message: quoteMessage(q),
  });
}

/** One-minute bars: start times in unix seconds, and closes (null for a
 * minute with no trade). */
export type Bars = { t: number[]; c: (number | null)[] };

/* THE PRICE FOR A MOMENT.
 *
 * The first bar that ends after the boundary: the bar the boundary falls in,
 * or, if nothing traded in it (the market was shut, or the stock is thin), the
 * next bar that has a trade. Its close is the price, as of the bar's end. Null
 * while that bar is still forming, or until one exists. */
export function priceAtBoundary(
  bars: Bars,
  boundary: number,
  now: number,
): { price: bigint; publishTime: number } | null {
  for (let i = 0; i < bars.t.length; i++) {
    const end = bars.t[i] + 60;
    const close = bars.c[i];
    if (end <= boundary || close == null || !(close > 0)) continue;
    if (now < end + BAR_SETTLE_SECS) return null;
    return { price: BigInt(Math.round(close * 10 ** -QUOTE_EXPO)), publishTime: end };
  }
  return null;
}

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; stonkwars-oracle/1.0)" };

/* Pre-market and after-hours count.
 *
 * A US stock trades from 4am to 8pm New York time, not 9:30 to 4, and the
 * hours either side of the session are when most of the people playing this
 * are awake. Those bars are thinner than the middle of the day, which is worth
 * saying out loud, but they are prints on the stock's own market rather than
 * anybody's quote. */
export async function fetchBars(symbol: string, from: number, to: number): Promise<Bars> {
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1m&includePrePost=true`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`${symbol}: market data HTTP ${r.status}`);
  const body = (await r.json()) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[];
      error?: { description?: string } | null;
    };
  };
  const res = body.chart?.result?.[0];
  if (!res) throw new Error(`${symbol}: ${body.chart?.error?.description ?? "no market data"}`);
  return { t: res.timestamp ?? [], c: res.indicators?.quote?.[0]?.close ?? [] };
}

/* WHEN THE EXCHANGE IS SHUT, THE TOKEN IS NOT.
 *
 * This is the point of putting a share on a chain: the token keeps trading
 * through the night and the weekend, on pools nobody can close. So when the
 * stock's own exchange has nothing to say, the price comes from the token
 * itself, on Solana.
 *
 * ONE MINUTE OF IT WOULD NOT BE SAFE. Off-hours a pool can trade thirty
 * dollars in a minute, and a single swap would set that minute's close. So the
 * price is the MEDIAN of the last fifteen one-minute closes before the
 * boundary. A median cannot be moved by one trade: pushing it means holding
 * the price away from fair value across eight separate minutes, while every
 * arbitrageur on Solana trades against you, which costs orders of magnitude
 * more than any stake here is worth.
 *
 * It stays a fact about the past, so it is as repeatable as the exchange bars:
 * the pool is pinned in the roster, the window is fixed, and anyone can ask
 * the same public source and get the same number.
 *
 * A stock whose pool is too thin to be worth reading has no pinned pool at
 * all, and simply keeps exchange hours. See scripts/build-pools.ts. */

const GECKO = "https://api.geckoterminal.com/api/v2";

/** How many one-minute closes the off-hours price is taken over. */
export const OFFHOURS_WINDOW = 15;

/** Fewer minutes than this actually traded, and there is no price to give. */
export const OFFHOURS_MIN_BARS = 5;

/** Share of the window discarded at each end before averaging. */
export const OFFHOURS_TRIM = 0.2;

/** The source refused us for asking too often; try again later, not harder. */
export class RateLimited extends Error {}

/* A pool's minutes, once.
 *
 * A boundary's window is finished history, so the answer for a given pool and
 * boundary never changes and is worth keeping. It matters more than it looks:
 * a crank retries a fight every few seconds until it settles, and without this
 * each attempt asked again and the free source started refusing all of them,
 * which is a rate limit we were inflicting on ourselves. */
const poolBars = new Map<string, Bars>();
let coolOffUntil = 0;

/** One-minute bars for a Solana pool, as of `before`. */
export async function fetchPoolBars(pool: string, before: number): Promise<Bars> {
  const key = `${pool}:${before}`;
  const had = poolBars.get(key);
  if (had) return had;
  if (Date.now() < coolOffUntil) throw new RateLimited("waiting out the market data source");

  const url = `${GECKO}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=${OFFHOURS_WINDOW * 4}&before_timestamp=${before}`;
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { ...HEADERS, accept: "application/json" }, cache: "no-store" });
    if (r.ok) {
      const body = (await r.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
      const rows = body.data?.attributes?.ohlcv_list ?? [];
      // Oldest first, to match the exchange bars.
      const sorted = [...rows].sort((a, b) => a[0] - b[0]);
      const bars = { t: sorted.map((row) => row[0]), c: sorted.map((row) => (row[4] > 0 ? row[4] : null)) };
      if (poolBars.size > 500) poolBars.clear();
      poolBars.set(key, bars);
      return bars;
    }
    last = `HTTP ${r.status}`;
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
  }
  if (last === "HTTP 429") {
    // Stand back for a minute rather than joining the queue every few seconds.
    coolOffUntil = Date.now() + 60_000;
    throw new RateLimited(`pool ${pool.slice(0, 8)}: ${last}`);
  }
  throw new Error(`pool ${pool.slice(0, 8)}: on-chain data ${last}`);
}

/* A TRIMMED MEAN, NOT A MEDIAN.
 *
 * A median is whichever close sits in the middle, so it moves in jumps: shift
 * the window by two minutes and the middle sample often does not change at
 * all. Both sides of a short fight then report exactly the same price as they
 * started with and the program, correctly, calls a draw. A price that says
 * "nothing happened" when something did is the wrong price, however
 * unpushable it is.
 *
 * So: throw away the highest fifth and the lowest fifth of the window, and
 * average what is left. It answers with a real number that moves whenever the
 * market does, and it still ignores an outlier outright rather than letting it
 * pull the answer. Somebody buying one minute has their minute discarded;
 * moving the result means holding the price away from fair value across most
 * of the window while arbitrage trades against them.
 *
 * That is a deliberate trade. A median resists a determined push harder. It
 * also declares a draw on fights that had a winner, which is a certain fault
 * against a costly and hypothetical one. */
export function trimmedMeanAtBoundary(bars: Bars, boundary: number): { price: bigint; publishTime: number } | null {
  const window: number[] = [];
  for (let i = 0; i < bars.t.length; i++) {
    const end = bars.t[i] + 60;
    const close = bars.c[i];
    if (end > boundary || end <= boundary - OFFHOURS_WINDOW * 60) continue;
    if (close != null && close > 0) window.push(close);
  }
  if (window.length < OFFHOURS_MIN_BARS) return null;

  window.sort((a, b) => a - b);
  // At least one off each end, so a single bought minute never counts.
  const cut = Math.max(1, Math.floor(window.length * OFFHOURS_TRIM));
  const kept = window.slice(cut, window.length - cut);
  const mean = kept.reduce((sum, c) => sum + c, 0) / kept.length;
  return { price: BigInt(Math.round(mean * 10 ** -QUOTE_EXPO)), publishTime: boundary };
}

/* EVERY PRICE IN DOLLARS.
 *
 * A stock listed abroad is quoted in its home currency (Hong Kong dollars,
 * London pence). Fights compare moves, and a player holding a token feels the
 * move in dollars, currency included; the page also shows and sizes stakes in
 * dollars. So a foreign price is converted at the same minute, with the
 * currency's own one-minute bars: the close of the last currency bar that
 * started before the stock's bar ended. Both are history, so the product is
 * as repeatable as either. */
const FX: Record<string, { symbol: string; scale: number }> = {
  HKD: { symbol: "HKDUSD=X", scale: 1 },
  GBP: { symbol: "GBPUSD=X", scale: 1 },
  GBp: { symbol: "GBPUSD=X", scale: 0.01 },
  EUR: { symbol: "EURUSD=X", scale: 1 },
  CAD: { symbol: "CADUSD=X", scale: 1 },
  AUD: { symbol: "AUDUSD=X", scale: 1 },
  JPY: { symbol: "JPYUSD=X", scale: 1 },
  CHF: { symbol: "CHFUSD=X", scale: 1 },
};

export const fxFor = (currency: string) => (currency === "USD" ? null : FX[currency] ?? null);

/** Dollars per unit of `currency` as of `at` (a bar end), from minute bars. */
async function dollarsPer(currency: string, at: number): Promise<number | null> {
  const fx = fxFor(currency);
  if (!fx) throw new Error(`No conversion to dollars for ${currency}`);
  const bars = await fetchBars(fx.symbol, at - 3_600, at + 60);
  let rate: number | null = null;
  for (let i = 0; i < bars.t.length; i++) {
    const close = bars.c[i];
    if (bars.t[i] < at && close != null && close > 0) rate = close;
  }
  return rate === null ? null : rate * fx.scale;
}

/* WHICH MARKET ANSWERS FOR A MOMENT.
 *
 * The stock's own exchange while it is trading, from four in the morning to
 * eight at night New York time. Outside that, the token's pool on Solana, for
 * the stocks that have one deep enough to pin. A stock with no pinned pool
 * keeps exchange hours and waits for the opening bell, as it always did.
 *
 * Listings outside the US keep their own exchange's hours either way: their
 * sessions are not what `session()` describes, and guessing would be worse
 * than waiting. */
export function sourceAt(boundary: number, opts: { market?: string; pool?: string }): "exchange" | "onchain" {
  if (!opts.pool) return "exchange";
  if ((opts.market ?? "US") !== "US") return "exchange";
  return session(boundary * 1_000) === "closed" ? "onchain" : "exchange";
}

/** The quote for `feed` at `boundary`, in dollars, or null if the price it
 * needs is not final yet. `symbol` is the stock's symbol at the market data
 * source, `currency` what that source quotes it in, and `pool` the Solana pool
 * that prices it when its exchange is shut. */
export async function quoteAt(opts: {
  feed: string;
  symbol: string;
  currency?: string;
  boundary: number;
  now?: number;
  market?: string;
  pool?: string;
}): Promise<Quote | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - opts.boundary > MAX_LOOKBACK_SECS) {
    throw new Error(`${opts.symbol}: ${opts.boundary} is older than the minute bars reach`);
  }

  if (sourceAt(opts.boundary, opts) === "onchain") {
    // The window is behind the boundary, so it is complete the moment the
    // boundary passes; a settler an hour late reads the same fifteen minutes.
    if (now < opts.boundary + BAR_SETTLE_SECS) return null;
    let bars: Bars;
    try {
      bars = await fetchPoolBars(opts.pool!, opts.boundary);
    } catch (e) {
      // Being told to wait is not a failure; the crank will come back.
      if (e instanceof RateLimited) return null;
      throw e;
    }
    const m = trimmedMeanAtBoundary(bars, opts.boundary);
    if (m) {
      return {
        feed: opts.feed.replace(/^0x/, "").toLowerCase(),
        boundary: opts.boundary,
        price: m.price,
        expo: QUOTE_EXPO,
        publishTime: m.publishTime,
      };
    }
    /* The pool went quiet in those fifteen minutes, so there is no price worth
     * signing from it. Fall through to the exchange, which means the fight
     * waits for the opening bell exactly as it did before any of this. Both
     * answers are history, so falling back does not make the result depend on
     * when anybody asked. */
  }
  // Minute bars come at most a week per request. Six days covers any closure
  // a duel can wait through: a start more than five days late is void.
  const to = Math.min(now, opts.boundary + 6 * 86_400);
  const bars = await fetchBars(opts.symbol, opts.boundary - 120, to);
  const p = priceAtBoundary(bars, opts.boundary, now);
  if (!p) return null;

  let price = p.price;
  const currency = opts.currency ?? "USD";
  if (currency !== "USD") {
    const rate = await dollarsPer(currency, p.publishTime);
    if (rate === null) return null;
    price = BigInt(Math.round((Number(p.price) / 10 ** -QUOTE_EXPO) * rate * 10 ** -QUOTE_EXPO));
  }
  return {
    feed: opts.feed.replace(/^0x/, "").toLowerCase(),
    boundary: opts.boundary,
    price,
    expo: QUOTE_EXPO,
    publishTime: p.publishTime,
  };
}
