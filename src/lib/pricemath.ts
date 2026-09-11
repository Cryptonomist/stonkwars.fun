/* Price arithmetic, with no React in it, so server code can use it too.
 *
 * This lived in prices.ts beside the polling hook, which is a "use client"
 * module; a server route that imports from one gets client references, not
 * functions, and calling one throws. The share card found that out the first
 * time it drew a settled fight. */

export type Quote = {
  ticker: string;
  /** Pyth mantissa, as a decimal string (bigint-safe over JSON). */
  price: string;
  expo: number;
  conf: string;
  publishTime: number;
};

export type Quotes = { quotes: Record<string, Quote>; at: number; error?: string };

export const quoteValue = (q?: Pick<Quote, "price" | "expo">): number | null =>
  q ? Number(q.price) * 10 ** q.expo : null;

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
