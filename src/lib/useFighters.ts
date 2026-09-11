"use client";

/* Fighter stats for the pick screen, from our own /api/stats. A month of daily
 * closes changes once a day, so this asks rarely and keeps what it gets. */

import { useQuery } from "@tanstack/react-query";

import { fighterFrom, type Fighter } from "@/lib/fighterStats";

export type Fighters = Record<string, Fighter | null>;

export function useFighters(tickers: (string | null | undefined)[]) {
  const list = [...new Set(tickers.filter((t): t is string => !!t))].sort();
  const key = list.join(",");
  return useQuery<Fighters>({
    queryKey: ["fighters", key],
    queryFn: async () => {
      const r = await fetch(`/api/stats?t=${encodeURIComponent(key)}`, { cache: "no-store" });
      const body = (await r.json()) as { closes?: Record<string, number[]> };
      const out: Fighters = {};
      for (const [ticker, closes] of Object.entries(body.closes ?? {})) out[ticker] = fighterFrom(closes);
      return out;
    },
    enabled: list.length > 0,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
