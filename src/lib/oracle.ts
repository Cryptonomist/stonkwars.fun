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
 * While the exchange is shut, from COMPOSITE_FROM, a stock pinned in
 * src/data/venues247.json is priced by composite-v2 instead (composite.ts):
 * the median, over a few minutes from the boundary, of the de-biased
 * one-minute closes of the markets that trade it around the clock, with a
 * proof anyone can recompute. answerAt returns that proof beside the quote.
 * composite-v1 never priced a boundary here: COMPOSITE_FROM came after it was
 * replaced, and it stays in composite.ts as v2's reference and for tests.
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

import {
  closeText,
  COMPOSITE_FROM,
  COMPOSITE_V2_RULE,
  compositeGate,
  compositeV2At,
  minuteOf,
  proofHash,
  V2_WINDOW_SECS,
  type CompositeProof,
  type CompositeV2Proof,
  type Reference,
  type Tier,
} from "./composite";
import { abroadOpeningAfter, session, sessionFrom } from "./market";
import { fetchVenueWindow, inputsAt, makeRoom, type Venues247 } from "./venues247";

export const QUOTE_PREFIX = "STONKWARS:PRICE:v1";
export const QUOTE_LEN = 78;
/** Prices are signed as integers of 1/10,000th of the quote currency. */
export const QUOTE_EXPO = -4;
/** How long after a bar closes before it is trusted not to change. */
export const BAR_SETTLE_SECS = 20;
/** One-minute bars reach back this far at the data source. */
export const MAX_LOOKBACK_SECS = 29 * 86_400;

/* EVERY PRICE SOURCE GETS FIVE SECONDS.
 *
 * A fetch with no timeout waits as long as the far end likes, and a crank
 * pass that waits on one hung request misses its own time limit and every
 * other fight in it. Five seconds is many times what a healthy answer takes;
 * a source slower than that is better asked again on the next try. */
export const FETCH_TIMEOUT_MS = 5_000;

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
 * minute with no trade).
 *
 * A bar's open, high, low and traded size come too when the source gives them.
 * They are for drawing and nothing else: every price rule below reads closes,
 * so what a chart shows can never change what a fight settles at. */
export type Bars = {
  t: number[];
  c: (number | null)[];
  o?: (number | null)[];
  h?: (number | null)[];
  l?: (number | null)[];
  /** Traded size in the bar: shares on an exchange, contracts on a perp. */
  v?: (number | null)[];
};

/** The end of the bar a boundary falls in: the first bar that ends after it,
 *  and so the earliest a bar-priced side's price can close. A boundary exactly
 *  on the minute starts that minute's bar, which ends sixty seconds later. */
export const firstBarEnd = (boundary: number) => Math.floor(boundary / 60) * 60 + 60;

/* NO EXCHANGE BAR BEFORE THE EXCHANGE HAS OPENED.
 *
 * The earliest a US exchange price after `boundary` can be final: the first
 * bar ending after the boundary, or, when the exchange was shut at the
 * boundary, the first bar of the first session after it, plus the settle
 * time. Its minute bars cover 4am to 8pm, so nothing can print before then,
 * and asking the data source before then can only come back empty. A listing
 * in Hong Kong or London is the same with its own exchange's sessions
 * (market.ts, abroadOpeningAfter); a market whose sessions are not modelled
 * keeps the plain rule, since guessing would be worse than asking.
 *
 * Only ever later than the plain rule, never earlier, so it cannot move a
 * signature forward. What is signed is still priceAtBoundary's answer from
 * the bars themselves. Null if no session opens within ten days. */
export function exchangeBarFinal(boundary: number, market = "US"): number | null {
  if (market !== "US") {
    const abroad = abroadOpeningAfter(market, boundary);
    return abroad === null ? null : firstBarEnd(abroad) + BAR_SETTLE_SECS;
  }
  const opening = sessionFrom(boundary * 1_000, "extended");
  if (opening === null) return null;
  return firstBarEnd(Math.max(boundary, Math.floor(opening / 1_000))) + BAR_SETTLE_SECS;
}

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
export async function fetchBars(symbol: string, from: number, to: number, interval = "1m"): Promise<Bars> {
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=${interval}&includePrePost=true`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${symbol}: market data HTTP ${r.status}`);
  type Quote = {
    close?: (number | null)[];
    open?: (number | null)[];
    high?: (number | null)[];
    low?: (number | null)[];
    volume?: (number | null)[];
  };
  const body = (await r.json()) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: Quote[] } }[];
      error?: { description?: string } | null;
    };
  };
  const res = body.chart?.result?.[0];
  if (!res) throw new Error(`${symbol}: ${body.chart?.error?.description ?? "no market data"}`);
  const q = res.indicators?.quote?.[0];
  return { t: res.timestamp ?? [], c: q?.close ?? [], o: q?.open, h: q?.high, l: q?.low, v: q?.volume };
}

/* THE MARKET THAT NEVER CLOSES.
 *
 * Hyperliquid's HIP-3 equity perps trade every minute of every day, including
 * the weekend, and print a candle for each one. That matters more than it
 * sounds: with no gaps, an out-of-hours price can use the ordinary rule, the
 * close of the first bar at or after the boundary, instead of an average over
 * a window. A fight then measures exactly the interval it says it does.
 *
 * It is a perpetual future, not a share, and that is the honest cost. What it
 * buys is a price that exists: the pools these stocks trade in managed a
 * median of three traded minutes an hour at a weekend, against sixty here, and
 * a fifteen-minute window on a pool moved five times as much as the market
 * actually did. Each market in src/data/perps.json was checked to be the same
 * company as the stock it prices, because a matching ticker is not a matching
 * instrument: `xyz:CL` is crude oil, and our CL is Colgate-Palmolive. */

const HYPERLIQUID = "https://api.hyperliquid.xyz/info";

/** Candles for a perp market, as `Bars` in seconds. One minute unless a chart asks wider. */
export async function fetchPerpBars(coin: string, from: number, to: number, interval = "1m"): Promise<Bars> {
  const key = `${coin}:${from}:${to}:${interval}`;
  const had = perpBars.get(key);
  if (had) return had;
  /* An empty window has no bars in it, and asking anyway is how a request
   * with its end before its start reached the venue and came back a 502,
   * which the quote route then reported as a failure instead of a wait. */
  if (to <= from) return { t: [], c: [] };

  const r = await fetch(HYPERLIQUID, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime: from * 1_000, endTime: to * 1_000 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${coin}: perp data HTTP ${r.status}`);
  const rows =
    ((await r.json()) as { t: number; o?: string; h?: string; l?: string; c: string; v?: string }[] | null) ?? [];

  /* Hyperliquid sends every field as a decimal string. A price has to be
   * positive to be a price; a size of zero is a real answer (nobody traded). */
  const price = (s: string | undefined) => (s != null && Number(s) > 0 ? Number(s) : null);
  const size = (s: string | undefined) => (s != null && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : null);

  const bars: Bars = {
    t: rows.map((c) => Math.floor(c.t / 1_000)),
    c: rows.map((c) => price(c.c)),
    o: rows.map((c) => price(c.o)),
    h: rows.map((c) => price(c.h)),
    l: rows.map((c) => price(c.l)),
    v: rows.map((c) => size(c.v)),
  };
  if (perpWindowComplete(bars, to, Math.floor(Date.now() / 1_000))) {
    if (perpBars.size > 500) perpBars.clear();
    perpBars.set(key, bars);
  }
  return bars;
}

/* A MINUTE WITH NO TRADE ARRIVES LATE, NOT NEVER.
 *
 * Hyperliquid prints no candle for a minute while nobody trades in it. When
 * the next trade comes, the quiet minutes appear behind it as flat candles at
 * the last close: six hours of all 32 markets on 14 Sep had 2,237 such minutes
 * and not one gap. At night a thin market can go eight minutes before that
 * trade. So a window whose last minute has no candle yet is not finished
 * history: caching it would keep this instance from ever seeing the price a
 * fight is waiting for, once `to` stops moving ten minutes after a boundary.
 * Only a window that reaches the minute `to` falls in, and has had time to
 * settle, is kept. Exported for tests. */
export function perpWindowComplete(bars: Bars, to: number, now: number): boolean {
  const last = bars.t[bars.t.length - 1];
  return last !== undefined && last >= Math.floor(to / 60) * 60 && to + 60 + BAR_SETTLE_SECS <= now;
}

/** Finished minutes never change, so asking twice is a waste of somebody's API. */
const perpBars = new Map<string, Bars>();

/* WHEN THE EXCHANGE IS SHUT, THE TOKEN IS NOT.
 *
 * This is the point of putting a share on a chain: the token keeps trading
 * through the night and the weekend, on pools nobody can close. So when the
 * stock's own exchange has nothing to say, the price comes from the token
 * itself, on Solana.
 *
 * ONE MINUTE OF IT WOULD NOT BE SAFE. Off-hours a pool can trade thirty
 * dollars in a minute, and a single swap would set that minute's close. So the
 * price is a TRIMMED MEAN of up to fifteen one-minute closes before the
 * boundary, discarding the highest fifth and the lowest fifth and averaging
 * what is left. A bought minute lands in the part that is thrown away and
 * counts for nothing; moving the answer means holding the price away from fair
 * value across most of the sample, while every arbitrageur on Solana trades
 * against you, which costs orders of magnitude more than any stake here is
 * worth. See trimmedMeanAtBoundary below for why this replaced a median.
 *
 * It stays a fact about the past, so it is as repeatable as the exchange bars:
 * the pool is pinned in the roster, the window is fixed, and anyone can ask
 * the same public source and get the same number.
 *
 * A stock whose pool is too thin to be worth reading has no pinned pool at
 * all, and simply keeps exchange hours. See scripts/build-pools.ts. */

const GECKO = "https://api.geckoterminal.com/api/v2";

/** At most this many one-minute closes go into an off-hours price. */
export const OFFHOURS_WINDOW = 15;

/* HOW FAR BACK IT WILL REACH TO FIND THEM.
 *
 * A busy pool trades most minutes and the price is the last quarter of an
 * hour. A quiet one at four in the morning might trade six minutes in an hour,
 * and demanding fifteen recent ones would mean no price at all, which strands
 * the fight until the exchange opens. So it takes the most recent closes it
 * can find within the hour, and asks only that there be enough of them.
 *
 * The lag that buys is real and symmetric: both fighters are read the same way
 * at the same moment, so the comparison holds even when the prints are old. */
export const OFFHOURS_LOOKBACK = 60;

/** Fewer closes than this in the whole hour, and there is no price to give. */
export const OFFHOURS_MIN_BARS = 5;

/** Share of the sample discarded at each end before averaging. */
export const OFFHOURS_TRIM = 0.2;

/** The source refused us for asking too often; try again later, not harder. */
export class RateLimited extends Error {}

/** The boundary is older than the history its price is read from: nothing
 *  will be signed for it, now or later. */
export class TooOld extends Error {}

/* A pool's minutes, once.
 *
 * A boundary's window is finished history, so the answer for a given pool and
 * boundary never changes and is worth keeping. It matters more than it looks:
 * a crank retries a fight every few seconds until it settles, and without this
 * each attempt asked again and the free source started refusing all of them,
 * which is a rate limit we were inflicting on ourselves. */
const poolBars = new Map<string, Bars>();
let coolOffUntil = 0;

/** Tries per pool read, and the pause between them. */
export const POOL_ATTEMPTS = 2;
export const POOL_RETRY_MS = 1_000;

/** One-minute bars for a Solana pool, as of `before`. */
export async function fetchPoolBars(pool: string, before: number): Promise<Bars> {
  const key = `${pool}:${before}`;
  const had = poolBars.get(key);
  if (had) return had;
  if (Date.now() < coolOffUntil) throw new RateLimited("waiting out the market data source");

  const url = `${GECKO}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=${OFFHOURS_LOOKBACK + 5}&before_timestamp=${before}`;
  /* TWO TRIES, ONE SECOND APART.
   *
   * This used to try three times and back off two and then four seconds, and
   * slept after the last failure too: eight seconds of a crank pass spent on
   * one pool before any other fight got a turn. The crank comes back to a
   * fight within seconds anyway, so one quick second try catches a blip and
   * anything longer is the next attempt's problem. */
  let last = "";
  for (let attempt = 0; attempt < POOL_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, POOL_RETRY_MS));
    const r = await fetch(url, {
      headers: { ...HEADERS, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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
  }
  if (last === "HTTP 429") {
    // Stand back for a minute rather than joining the queue every few seconds.
    coolOffUntil = Date.now() + 60_000;
    throw new RateLimited(`pool ${pool.slice(0, 8)}: ${last}`);
  }
  throw new Error(`pool ${pool.slice(0, 8)}: on-chain data ${last}`);
}

/* WAS THIS POOL'S WINDOW TOO THIN TO PRICE?
 *
 * True when its bars for this boundary have been read on this instance and
 * hold too few closes, so quoteAt falls back to the exchange; false when they
 * priced; undefined when they have not been read here. A crank uses it to
 * tell a quiet pool, which waits for the exchange to open, from a pool it was
 * told to stop asking for a minute, which does not. */
export function poolWindowThin(pool: string, boundary: number): boolean | undefined {
  const bars = poolBars.get(`${pool}:${boundary}`);
  return bars ? trimmedMeanAtBoundary(bars, boundary) === null : undefined;
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
  /* Every minute that traded inside the hour before the boundary, newest
   * last, then the most recent fifteen of them. A lively pool fills that from
   * the last quarter hour; a quiet one reaches further back for the same
   * count, which is the difference between a fight settling and a fight
   * stranded until the exchange opens. */
  const recent: number[] = [];
  for (let i = 0; i < bars.t.length; i++) {
    const end = bars.t[i] + 60;
    const close = bars.c[i];
    if (end > boundary || end <= boundary - OFFHOURS_LOOKBACK * 60) continue;
    if (close != null && close > 0) recent.push(close);
  }
  if (recent.length < OFFHOURS_MIN_BARS) return null;

  const window = recent.slice(-OFFHOURS_WINDOW);
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
 * eight at night New York time. Outside that, for a boundary at or after
 * COMPOSITE_FROM, the composite of the markets that trade the stock around
 * the clock, for a stock with markets pinned in src/data/venues247.json at
 * that boundary (composite.ts). Before COMPOSITE_FROM, the perp and then the
 * token's pool on Solana, as they always did. A stock with none of these, or
 * from COMPOSITE_FROM a stock with no pins at the boundary, keeps exchange
 * hours and waits for the opening bell.
 *
 * THE RULE IS PER BOUNDARY, NOT PER FIGHT. A quote names a stock and a
 * boundary and never a duel (the route is public, and the program checks only
 * those), so each of a fight's boundaries is priced by the rule in force at
 * that boundary. A fight taken before COMPOSITE_FROM whose end falls after it
 * ends on the new rule: a perp-priced start and a composite-priced end, or a
 * pool-priced start and an end that waits for the exchange. The release picks
 * COMPOSITE_FROM so that no open fight is caught that way
 * (scripts/cutover-check.ts lists any that would be).
 *
 * `composite` is the stock's ticker in venues247.json, set by the roster
 * (stocks.ts quoteSymbolFor) only for a listed US stock quoted in dollars;
 * `venues` is the pins file, the deployed one unless a test passes its own. A
 * pin's `until` counts: a stock whose every market has been ended at a
 * boundary is priced there as a stock with none.
 *
 * Listings outside the US are always their own exchange's bars: `session()`
 * describes New York, and nothing trades a Hong Kong or London listing around
 * the clock here. Shut, such a side waits for its next session like a US stock
 * with nothing else to read (exchangeBarFinal, market.ts abroadOpeningAfter). */
export type PriceSource = "exchange" | "perp" | "pool" | "composite";

export function sourceAt(
  boundary: number,
  opts: { market?: string; pool?: string; perp?: string; composite?: string; venues?: Venues247 },
): PriceSource {
  // A listing outside the US is its own exchange's bars, in that exchange's sessions.
  if ((opts.market ?? "US") !== "US") return "exchange";
  if (session(boundary * 1_000) !== "closed") return "exchange";
  // Shut. From the cutover, the composite for a stock with markets pinned at this boundary.
  if (opts.composite && boundary >= COMPOSITE_FROM && inputsAt(opts.composite, boundary, opts.venues).length > 0) return "composite";
  /* And for every other stock, from the cutover, the exchange's next bar. A
   * perp or pool pinned before it priced a stock the composite's markets do
   * not list (GLD, GME, KO, MCD, MRNA, STRC): one thin market, or a pool, which
   * is what the composite exists to stop a fight resting on. */
  if (boundary >= COMPOSITE_FROM) return "exchange";
  // Before it, the perp next: it prints every minute, so the ordinary rule works.
  if (opts.perp) return "perp";
  if (opts.pool) return "pool";
  return "exchange";
}

export type QuoteOptions = {
  feed: string;
  symbol: string;
  currency?: string;
  boundary: number;
  now?: number;
  market?: string;
  pool?: string;
  perp?: string;
  composite?: string;
  /** The composite's pins; tests pass their own. */
  venues?: Venues247;
};

/* WHAT THE ORACLE HAS TO SAY ABOUT ONE SIDE AT ONE BOUNDARY.
 *
 *   quote        the price to sign, or null while it is not final
 *   wait         why not, in words, when there is no quote
 *   retryAt      the earliest worth asking again, when the oracle knows it
 *   parkedUntil  the composite fell back to the exchange's first bar after the
 *                boundary, which cannot be final before this: nothing is worth
 *                asking until then (a Saturday boundary waits for Monday 4:01)
 *   tier         the composite's fallback tier, null when its median priced it
 *   proof        the composite's proof and the sha256 of its canonical JSON;
 *                null for every other source
 *
 * The same boundary always gets the same answer once its price is final, and
 * the proof carries nothing about when it was asked, so two answers minutes
 * apart are the same bytes. */
export type Answer = {
  source: PriceSource;
  quote: Quote | null;
  wait: string | null;
  retryAt: number | null;
  parkedUntil: number | null;
  tier: Tier;
  proof: CompositeProof | CompositeV2Proof | null;
  sha256: string | null;
};

/** The quote for `feed` at `boundary`, in dollars, or null if the price it
 * needs is not final yet. `symbol` is the stock's symbol at the market data
 * source, `currency` what that source quotes it in, `pool` the Solana pool and
 * `perp` the perpetual market that price it when its exchange is shut, and
 * `composite` its ticker in venues247.json. answerAt says why, with the proof. */
export async function quoteAt(opts: QuoteOptions): Promise<Quote | null> {
  return (await answerAt(opts)).quote;
}

const cleanFeed = (feed: string) => feed.replace(/^0x/, "").toLowerCase();

export async function answerAt(opts: QuoteOptions): Promise<Answer> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - opts.boundary > MAX_LOOKBACK_SECS) {
    throw new TooOld(`${opts.symbol}: ${opts.boundary} is older than the minute bars reach`);
  }
  const source = sourceAt(opts.boundary, opts);
  if (source === "composite" && (opts.currency ?? "USD") === "USD") return compositeAnswerAt(opts, now);

  const quote = await legacyQuoteAt(opts, now, source === "composite" ? "exchange" : source);
  return {
    source,
    quote,
    wait: quote ? null : `the price at ${opts.boundary} is not final yet`,
    retryAt: null,
    parkedUntil: null,
    tier: null,
    proof: null,
    sha256: null,
  };
}

/* THE COMPOSITE, ASKED ONCE ITS WINDOW IS FINAL.
 *
 * Nothing is fetched before the window's end plus BAR_SETTLE_SECS
 * (composite.ts, compositePublishTime). Then every pinned venue is asked in
 * parallel for its whole span (Bitget in turn, venues247.ts), and so is the
 * exchange's last close for the breaker, and composite.ts decides.
 *
 * A VERDICT IS KEPT. A priced minute, or one that fell back to the exchange,
 * is history, so this instance remembers it per (ticker, minute): a crank
 * retrying a Saturday fight all weekend asks the venues once, not every pass,
 * and crank.ts reads compositeParkedUntil to wait for Monday instead of five
 * seconds. A wait is not kept; it is the one answer that changes.
 *
 * PER MINUTE, NOT PER SECOND. Everything the rule reads is fixed by the minute
 * a boundary falls in: the window, the requests, the exchange's next opening.
 * The boundary itself only goes into the quote and the proof, so it is written
 * in afterwards (stamped), and sixty boundaries in one minute are one
 * computation, not sixty. */
type Verdict =
  | { quote: Quote; tier: "two-anchor" | null; proof: CompositeV2Proof; sha256: string }
  | { parkedUntil: number; reason: string; proof: CompositeV2Proof; sha256: string };
const verdicts = new Map<string, Verdict>();
const MAX_VERDICTS = 5_000;

/** When a composite side at `boundary` fell back to the exchange, the moment
 *  its bar can first be final, if this instance has computed it. */
export function compositeParkedUntil(ticker: string, boundary: number): number | undefined {
  const v = verdicts.get(`${ticker}:${minuteOf(boundary)}`);
  return v && "parkedUntil" in v ? v.parkedUntil : undefined;
}

/** A kept verdict for another second of its minute, with that boundary in its
 *  quote and proof, and the proof's hash worked out again. */
function stamped(v: Verdict, boundary: number): Verdict {
  if (v.proof.boundary === boundary) return v;
  const proof = { ...v.proof, boundary };
  const sha256 = proofHash(proof);
  return "quote" in v ? { ...v, quote: { ...v.quote, boundary }, proof, sha256 } : { ...v, proof, sha256 };
}

async function compositeAnswerAt(opts: QuoteOptions, now: number): Promise<Answer> {
  const ticker = opts.composite!;
  const boundary = opts.boundary;
  const m = minuteOf(boundary);
  const base = { source: "composite" as const, quote: null, retryAt: null, parkedUntil: null, tier: null, proof: null, sha256: null };
  const inputs = inputsAt(ticker, boundary, opts.venues);

  const gate = compositeGate({ boundary, now, settleSecs: BAR_SETTLE_SECS, venues: [], windowSecs: V2_WINDOW_SECS });
  if (gate && "wait" in gate) return { ...base, wait: gate.wait, retryAt: gate.retryAt };

  const key = `${ticker}:${m}`;
  let verdict = verdicts.get(key);
  if (verdict) verdict = stamped(verdict, boundary);
  else {
    const tooLate = compositeGate({ boundary, now, settleSecs: BAR_SETTLE_SECS, venues: inputs.map((i) => i.venue), windowSecs: V2_WINDOW_SECS });
    if (tooLate && "refused" in tooLate) throw new TooOld(`${opts.symbol}: ${tooLate.refused}`);

    const fetchOpts = { now, timeoutMs: FETCH_TIMEOUT_MS, settleSecs: BAR_SETTLE_SECS, rule: COMPOSITE_V2_RULE } as const;
    const [windows, reference] = await Promise.all([
      Promise.all(inputs.map((i) => fetchVenueWindow(i, m, fetchOpts))),
      exchangeCloseBefore(opts.symbol, boundary),
    ]);
    const result = compositeV2At({
      boundary,
      now,
      settleSecs: BAR_SETTLE_SECS,
      windows,
      reference,
      exchangeFinal: exchangeBarFinal(boundary, opts.market),
    });
    if ("refused" in result) throw new Error(`${opts.symbol}: ${result.refused}`);
    if ("wait" in result) return { ...base, wait: result.wait, retryAt: result.retryAt };
    verdict =
      "price" in result
        ? {
            quote: { feed: cleanFeed(opts.feed), boundary, price: result.price, expo: QUOTE_EXPO, publishTime: result.publishTime },
            tier: result.tier,
            proof: result.proof,
            sha256: result.sha256,
          }
        : { parkedUntil: result.waitUntil, reason: result.reason, proof: result.proof, sha256: result.sha256 };
    makeRoom(verdicts, MAX_VERDICTS);
    verdicts.set(key, verdict);
  }

  if ("quote" in verdict) {
    return { ...base, quote: verdict.quote, wait: null, tier: verdict.tier, proof: verdict.proof, sha256: verdict.sha256 };
  }
  /* Tier (b): the exchange's first bar after the boundary, which is the
   * exchange path every stock without a round-the-clock market already takes,
   * asked nothing before it can be final. */
  const parked = { ...base, parkedUntil: verdict.parkedUntil, tier: "exchange" as const, proof: verdict.proof, sha256: verdict.sha256 };
  if (now < verdict.parkedUntil) {
    return { ...parked, wait: `${verdict.reason}; the exchange prices it from ${verdict.parkedUntil}`, retryAt: verdict.parkedUntil };
  }
  const quote = await exchangeQuoteAt(opts, now);
  return { ...parked, quote, wait: quote ? null : `the exchange's first bar after ${boundary} is not final yet` };
}

/* THE BREAKER'S REFERENCE: the exchange's last one-minute close before the
 * boundary's minute, from the session before the closure the boundary is in.
 *
 * ONLY WHOLE-MINUTE BARS FROM A SESSION. Yahoo appends its latest trade to a
 * chart as an extra point that is not on a minute (asked at 04:06 UTC on 15
 * Sep, TSLA's chart ended with a point at Monday 19:59:56 ET beside the 19:59
 * bar), and replaces it with nothing once the session is history. Taken as the
 * reference, that point put a different close in a proof signed that night
 * than in the same proof worked out after the next session, and so a different
 * sha256. So the reference is the last bar whose start is on a minute and
 * inside an exchange session, which is the same bar whenever it is asked.
 *
 * KEPT PER CLOSURE. Every boundary in one closure has the same last session
 * bar before it, so the reference is asked once for the closure (keyed by the
 * opening that ends it), not once per minute: a whole weekend costs the market
 * data source one request per stock. Six days back covers the longest closure
 * on the calendar, a holiday next to a weekend. A close that was found is
 * history and kept; not finding one is asked again. */
const references = new Map<string, { t: number; close: string }>();

/** The reference among `bars` for minute m: the last bar on a whole minute,
 *  inside a session, starting at or before m - 60, with a close. Exported for
 *  tests. */
export function referenceFromBars(bars: Bars, m: number): { t: number; close: string } | null {
  let found: { t: number; close: string } | null = null;
  for (let i = 0; i < bars.t.length; i++) {
    const t = bars.t[i];
    const close = bars.c[i];
    if (t % 60 !== 0 || t > m - 60 || close == null || !(close > 0) || session(t * 1_000) === "closed") continue;
    if (!found || t >= found.t) found = { t, close: closeText(close)! };
  }
  return found;
}

async function exchangeCloseBefore(symbol: string, boundary: number): Promise<Reference> {
  const m = minuteOf(boundary);
  const key = `${symbol}:${sessionFrom(boundary * 1_000, "extended") ?? m}`;
  const had = references.get(key);
  if (had) return had;
  let bars: Bars;
  try {
    bars = await fetchBars(symbol, m - 6 * 86_400, m);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "market data unavailable" };
  }
  const found = referenceFromBars(bars, m);
  if (found) {
    makeRoom(references, MAX_VERDICTS);
    references.set(key, found);
  }
  return found;
}

/** Every source but the composite: the perp, the pool, or the exchange. */
async function legacyQuoteAt(opts: QuoteOptions, now: number, source: Exclude<PriceSource, "composite">): Promise<Quote | null> {
  /* NOT BEFORE THE BAR CAN BE FINAL, AND NOT EVEN ASKED.
   *
   * A bar-priced side's price is the close of the first bar ending after the
   * boundary, trusted BAR_SETTLE_SECS after that. Before then priceAtBoundary
   * would refuse whatever came back, so the request is only load on somebody
   * else's API, and a page or crank asking early and often would make a lot
   * of it. This answers "not yet" without a network call. It changes nothing
   * about what is signed: the same refusal already stood in priceAtBoundary. */
  const barFinal = firstBarEnd(opts.boundary) + BAR_SETTLE_SECS;

  /* The perp prints every minute, so this is the same rule the exchange path
   * uses: the close of the first bar at or after the boundary. No window, no
   * averaging, and a round measures the interval it claims to. */
  if (source === "perp") {
    if (now < barFinal) return null;
    const bars = await fetchPerpBars(opts.perp!, opts.boundary - 300, Math.min(now, opts.boundary + 600));
    const p = priceAtBoundary(bars, opts.boundary, now);
    if (p) {
      return {
        feed: cleanFeed(opts.feed),
        boundary: opts.boundary,
        price: p.price,
        expo: QUOTE_EXPO,
        publishTime: p.publishTime,
      };
    }
    /* A market that has not printed yet is a wait, not a failure, and falling
     * through to a pool would answer a different question. */
    return null;
  }

  if (source === "pool") {
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
        feed: cleanFeed(opts.feed),
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
  return exchangeQuoteAt(opts, now);
}

/** The exchange's first bar after the boundary, in dollars. */
async function exchangeQuoteAt(opts: QuoteOptions, now: number): Promise<Quote | null> {
  /* The exchange, asked nothing before its first bar after the boundary can
   * be final. For a quiet pool on a Saturday that is Monday's pre-market, and
   * without this every retry all weekend asked the exchange's data source for
   * bars that could not exist yet. */
  const exchangeFinal = exchangeBarFinal(opts.boundary, opts.market);
  if (exchangeFinal === null || now < exchangeFinal) return null;
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
    feed: cleanFeed(opts.feed),
    boundary: opts.boundary,
    price,
    expo: QUOTE_EXPO,
    publishTime: p.publishTime,
  };
}
