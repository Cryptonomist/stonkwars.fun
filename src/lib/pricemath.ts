/* Price arithmetic, with no React in it, so server code can use it too.
 *
 * This lived in prices.ts beside the polling hook, which is a "use client"
 * module; a server route that imports from one gets client references, not
 * functions, and calling one throws. The share card found that out the first
 * time it drew a settled fight. */

import type { LiveSource } from "@/lib/livePrice";

export type { LiveSource };

export type Quote = {
  ticker: string;
  /** Pyth mantissa, as a decimal string (bigint-safe over JSON). */
  price: string;
  expo: number;
  conf: string;
  publishTime: number;
  /** The close of the session before this one, at the same exponent, where the
   *  source gave one. Display only: no outcome is measured against it. */
  prev?: string;
  /** The market this price was read from, so a page can name it. Absent on
   *  quotes that were never live (the development price wanderer). */
  source?: LiveSource;
};

/** A live price's source, in the words a badge beside it uses. */
export function sourceWords(source: LiveSource): string {
  switch (source) {
    case "pyth":
      return "Pyth";
    case "regular":
      return "Exchange";
    case "extended":
      return "Extended hours";
    case "perp":
      return "Perp";
    case "pool":
      return "Pool";
    case "last":
      return "Last close";
  }
}

export type Quotes = { quotes: Record<string, Quote>; at: number; error?: string };

export const quoteValue = (q?: Pick<Quote, "price" | "expo">): number | null =>
  q ? Number(q.price) * 10 ** q.expo : null;

/** The move on the day, against the previous session's close, or null when the
 *  source did not give one. */
export function dayChangePct(q?: Quote): number | null {
  if (!q?.prev) return null;
  const prev = Number(q.prev);
  return prev > 0 ? ((Number(q.price) - prev) / prev) * 100 : null;
}

/* A PREVIOUS CLOSE BORROWED FROM ANOTHER SOURCE.
 *
 * Pyth sends a price and never the close before it, so a Pyth-priced stock
 * (TSLA, QQQ) used to show no move on the day anywhere: not in the tape, the
 * picker, the movers or its own page. The exchange quote for the same stock
 * does carry that close, and the day's move is measured from the regular close
 * whichever feed the price comes from. So the price keeps its own source and
 * the close is carried over, rescaled to the price's exponent, because the two
 * feeds count in different powers of ten. Display only, like every `prev`. */
export function withPrev(q: Quote, from?: Pick<Quote, "prev" | "expo">): Quote {
  if (q.prev || !from?.prev) return q;
  const prev = Number(from.prev) * 10 ** (from.expo - q.expo);
  return Number.isFinite(prev) && prev > 0 ? { ...q, prev: String(Math.round(prev)) } : q;
}

/* STAKE SIZING, IN INTEGERS.
 *
 * `dollars` of a stock at a Pyth price `price * 10^expo`, as base units of a
 * token with `decimals`:
 *
 *     raw = dollars * 10^(decimals - expo) / price
 *
 * Dollars arrive as cents so the whole thing stays in bigint. Rounded down:
 * nobody is asked to stake more than they typed. */
export function stakeForDollars(
  cents: bigint,
  quote: Pick<Quote, "price" | "expo">,
  decimals: number,
): bigint {
  const price = BigInt(quote.price);
  if (price <= BigInt(0)) return BigInt(0);
  const power = decimals - quote.expo; // expo is negative, so this is > decimals
  const num = cents * BigInt(10) ** BigInt(power);
  return num / (price * BigInt(100));
}

/** What `raw` base units are worth at a quote, in dollars. Display only. */
export function stakeValue(raw: bigint, decimals: number, quote?: Pick<Quote, "price" | "expo">) {
  if (!quote) return null;
  return (Number(raw) / 10 ** decimals) * Number(quote.price) * 10 ** quote.expo;
}

/** Percent move from a start to an end price, both mantissa + exponent. */
export function movePct(
  start: { price: bigint | string; expo: number },
  end: { price: bigint | string; expo: number },
): number {
  const s = Number(start.price) * 10 ** start.expo;
  const e = Number(end.price) * 10 ** end.expo;
  return s > 0 ? ((e - s) / s) * 100 : 0;
}
