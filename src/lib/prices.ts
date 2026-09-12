"use client";

/* Live prices, from our own /api/prices, which holds the Pyth key server-side.
 * The browser never talks to Hermes or the market data source directly.
 *
 * A page asks only for the stocks it shows: with a thousand stocks in the
 * roster, "everything, every few seconds" is not a request anyone should
 * make. Requests for the same set of tickers are shared across components.
 *
 * The arithmetic is in pricemath.ts and re-exported here for components;
 * server code must import it from there. */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { Quotes } from "@/lib/pricemath";

export { dayChangePct, movePct, quoteValue, stakeForDollars, stakeValue } from "@/lib/pricemath";
export type { Quote, Quotes } from "@/lib/pricemath";

/** The most tickers one request carries; the server refuses more. */
export const MAX_PRICE_TICKERS = 60;

export function usePrices(tickers: (string | null | undefined)[], refetchMs = 5_000) {
  const list = [...new Set(tickers.filter((t): t is string => !!t))].sort().slice(0, MAX_PRICE_TICKERS);
  const key = list.join(",");
  return useQuery<Quotes>({
    queryKey: ["prices", key],
    queryFn: async () => {
      if (!list.length) return { quotes: {}, at: Math.floor(Date.now() / 1000) };
      const r = await fetch(`/api/prices?t=${encodeURIComponent(key)}`, { cache: "no-store" });
      const body = (await r.json()) as Quotes;
      if (!r.ok) return { quotes: {}, at: Date.now() / 1000, error: body.error ?? `HTTP ${r.status}` };
      return body;
    },
    refetchInterval: refetchMs,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
