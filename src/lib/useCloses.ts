"use client";

/* A month of daily closes per stock, for sparklines.
 *
 * From our own /api/stats, which answers at most 8 tickers a request and keeps
 * each stock's month for an hour. So a list is asked for in fixed batches of
 * 8, one query each, cut from the sorted ticker list: the same set of tickers
 * always makes the same batches, so a rail whose rows re-order as prices move
 * does not ask again, and two components showing the same stocks share the
 * answer.
 *
 * Daily closes change once a day, so a batch is fresh for half an hour and is
 * not asked again because a tab came back into focus. A stock the source
 * would not answer for is simply missing from the record: its sparkline draws
 * the faint dash that says there is no line, never a flat one.
 *
 * For drawing only. Nothing here reaches a fight. */

import { useQueries } from "@tanstack/react-query";

/** The most tickers /api/stats answers in one request. */
const PER_REQUEST = 8;

export type Closes = Record<string, number[]>;

export function useCloses(tickers: (string | null | undefined)[]): {
  closes: Closes;
  /** Some batch has not answered yet. */
  isLoading: boolean;
  /** Some batch failed outright. */
  isError: boolean;
} {
  const list = [...new Set(tickers.filter((t): t is string => !!t))].sort();
  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += PER_REQUEST) batches.push(list.slice(i, i + PER_REQUEST));

  return useQueries({
    queries: batches.map((batch) => {
      const key = batch.join(",");
      return {
        queryKey: ["closes", key],
        queryFn: async (): Promise<Closes> => {
          const r = await fetch(`/api/stats?t=${encodeURIComponent(key)}`, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const body = (await r.json()) as { closes?: Closes };
          return body.closes ?? {};
        },
        staleTime: 30 * 60_000,
        refetchOnWindowFocus: false,
      };
    }),
    combine: (results) => {
      const closes: Closes = {};
      for (const res of results) Object.assign(closes, res.data ?? {});
      return {
        closes,
        isLoading: results.some((res) => res.isPending),
        isError: results.some((res) => res.isError),
      };
    },
  });
}
