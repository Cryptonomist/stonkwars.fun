"use client";

/* Live prices, from our own /api/prices, which holds the Pyth key server-side.
 * The browser never talks to Hermes directly: since the Core upgrade Hermes
 * wants an API key, and a key in a bundle is a published key.
 *
 * The arithmetic is in pricemath.ts and re-exported here for components;
 * server code must import it from there. */

import { useQuery } from "@tanstack/react-query";

import type { Quotes } from "@/lib/pricemath";

export { movePct, quoteValue, stakeForDollars, stakeValue } from "@/lib/pricemath";
export type { Quote, Quotes } from "@/lib/pricemath";

export function usePrices(refetchMs = 3_000) {
  return useQuery<Quotes>({
    queryKey: ["prices"],
    queryFn: async () => {
      const r = await fetch("/api/prices", { cache: "no-store" });
      const body = (await r.json()) as Quotes;
      if (!r.ok) return { quotes: {}, at: Date.now() / 1000, error: body.error ?? `HTTP ${r.status}` };
      return body;
    },
    refetchInterval: refetchMs,
    staleTime: 0,
  });
}
