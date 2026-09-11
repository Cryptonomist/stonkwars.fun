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

/** Regular-session one-minute bars for `symbol` between two unix times. */
export async function fetchBars(symbol: string, from: number, to: number): Promise<Bars> {
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1m&includePrePost=false`;
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

/** The quote for `feed` at `boundary`, in dollars, or null if its bar is not
 * complete yet. `symbol` is the stock's symbol at the market data source and
 * `currency` what that source quotes it in. */
export async function quoteAt(opts: {
  feed: string;
  symbol: string;
  currency?: string;
  boundary: number;
  now?: number;
}): Promise<Quote | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - opts.boundary > MAX_LOOKBACK_SECS) {
    throw new Error(`${opts.symbol}: ${opts.boundary} is older than the minute bars reach`);
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
