"use client";

/* The race chart's data: minute bars for the path so far, the live prices the
 * page polls on top, and the chain's start and bell prices at the two ends.
 *
 * WHERE EACH POINT COMES FROM.
 *   bars   /api/bars, per stock, for the round's minutes (at most its last six
 *          hours). Asked again each minute while the round runs, so a reload
 *          halfway through a round draws the path back from bars.
 *   polls  each usePrices quote during the round, once per publish time. Kept
 *          in sessionStorage per fight, so a reload keeps the seconds between
 *          bars too. A quote stamped before the start (a last close, say) is
 *          not a price in this round and is not added.
 *   ends   the on-chain start (0%) and, once the program has it, the bell.
 *
 * All of it is for watching: raceSeries.ts pins the ends to the chain, and
 * nothing here reaches a result. */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { STATUS_LIVE, STATUS_REFUNDED, STATUS_SETTLED, type DuelView } from "./duel";
import { pythToNumber } from "./format";
import { movePct, quoteValue, type Quotes } from "./prices";
import {
  appendLive,
  barsToPoints,
  barsWindow,
  MIN_BARS_ROUND_SECS,
  mergePoints,
  pinEndpoints,
  toPercentSeries,
  WINDOW_SECS,
  xDomain,
  type PctPt,
  type PricePt,
} from "./raceSeries";
import { byTicker } from "./stocks";

type BarsBody = { t?: number[]; c?: (number | null)[]; note?: string; error?: string };

export type RaceSeries = {
  p1: PctPt[];
  p2: PctPt[];
  domain: [number, number];
  /** Only the chain's two prices per side: nothing drew the path between. */
  endpointsOnly: boolean;
  notes: string[];
  /** The first bars are still on their way. */
  loading: boolean;
};

type Live = { p1: PricePt[]; p2: PricePt[] };
const EMPTY_LIVE: Live = { p1: [], p2: [] };
const storageKey = (address: string) => `stonk:race:${address}`;

function readLive(address: string): Live {
  try {
    const raw = window.sessionStorage.getItem(storageKey(address));
    if (!raw) return EMPTY_LIVE;
    const parsed = JSON.parse(raw) as { p1?: [number, number][]; p2?: [number, number][] };
    const pts = (xs?: [number, number][]) =>
      Array.isArray(xs) ? xs.filter((x) => Array.isArray(x) && x.length === 2).map(([t, price]) => ({ t, price })) : [];
    return { p1: pts(parsed.p1), p2: pts(parsed.p2) };
  } catch {
    return EMPTY_LIVE;
  }
}

function writeLive(address: string, live: Live) {
  try {
    const pack = (xs: PricePt[]) => xs.map((p) => [p.t, p.price]);
    window.sessionStorage.setItem(storageKey(address), JSON.stringify({ p1: pack(live.p1), p2: pack(live.p2) }));
  } catch {
    /* Storage refused or full: the path still draws from bars. */
  }
}

function useBars(ticker: string | null, window: { from: number; to: number } | null) {
  const charted = !!ticker && byTicker(ticker)?.market === "US";
  return useQuery<BarsBody>({
    queryKey: ["bars", ticker, window?.from, window?.to],
    enabled: charted && !!window,
    queryFn: async () => {
      const r = await fetch(`/api/bars?t=${encodeURIComponent(ticker!)}&from=${window!.from}&to=${window!.to}`);
      const body = (await r.json().catch(() => ({}))) as BarsBody;
      return r.ok ? body : { error: body.error ?? `HTTP ${r.status}` };
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useRaceSeries(
  d: DuelView,
  t1: string | null,
  t2: string | null,
  quotes: Quotes | undefined,
  now: number,
): RaceSeries | null {
  const address = d.address.toBase58();
  const live = d.status === STATUS_LIVE;
  const ended = (d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED) && d.creatorEnd.price > BigInt(0);

  /* Minute resolution is all the window needs, and a window that moved every
   * second would ask for a new URL every second. */
  const minute = now ? Math.floor(now / 60) * 60 : 0;
  const win = useMemo(
    () => (d.startTs && minute ? barsWindow(d, ended ? Math.max(minute, d.endTs + 60) : minute + 59) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.startTs, d.endTs, minute, ended],
  );
  const bars1 = useBars(t1, win);
  const bars2 = useBars(t2, win);

  const [polls, setPolls] = useState<Live>(EMPTY_LIVE);
  useEffect(() => {
    setPolls(readLive(address));
  }, [address]);

  const q1 = t1 ? quotes?.quotes[t1] : undefined;
  const q2 = t2 ? quotes?.quotes[t2] : undefined;
  useEffect(() => {
    if (!live || !d.startTs) return;
    const inRound = (t: number) => t >= d.startTs && t <= d.endTs;
    setPolls((prev) => {
      let next = prev;
      const v1 = quoteValue(q1);
      const v2 = quoteValue(q2);
      if (q1 && v1 !== null && inRound(q1.publishTime)) next = { ...next, p1: appendLive(next.p1, { t: q1.publishTime, price: v1 }) };
      if (q2 && v2 !== null && inRound(q2.publishTime)) next = { ...next, p2: appendLive(next.p2, { t: q2.publishTime, price: v2 }) };
      if (next !== prev) writeLive(address, next);
      return next;
    });
  }, [live, d.startTs, d.endTs, address, q1, q2]);

  return useMemo(() => {
    if (!d.startTs || !now) return null;
    const [x0, x1] = xDomain(d, now);
    const round = d.endTs - d.startTs;

    const side = (bars: BarsBody | undefined, own: PricePt[], start: DuelView["creatorStart"], end: DuelView["creatorEnd"]) => {
      const prices = mergePoints(barsToPoints(bars), own).filter((p) => p.t >= x0 && p.t <= Math.min(x1, d.endTs));
      const series = toPercentSeries(prices, pythToNumber(start.price, start.expo));
      return pinEndpoints(
        series,
        x0 <= d.startTs ? { t: d.startTs, v: 0 } : null,
        ended ? { t: d.endTs, v: movePct(start, end) } : null,
      );
    };
    const p1 = side(bars1.data, polls.p1, d.creatorStart, d.creatorEnd);
    const p2 = side(bars2.data, polls.p2, d.opponentStart, d.opponentEnd);

    const inner = (s: PctPt[]) => s.filter((p) => p.t > d.startTs && p.t < d.endTs).length;
    const endpointsOnly = ended && inner(p1) === 0 && inner(p2) === 0;
    const loading = !!win && (bars1.isLoading || bars2.isLoading);

    const notes: string[] = [];
    if (endpointsOnly && !loading) {
      notes.push(
        round < MIN_BARS_ROUND_SECS
          ? "Too short for minute bars. Start and bell prices only."
          : "No minute bars for this round. Start and bell prices only.",
      );
    } else {
      for (const [t, b] of [
        [t1, bars1.data],
        [t2, bars2.data],
      ] as const) {
        if (b?.note && t) notes.push(`${t}: ${b.note}`);
      }
      if ((bars1.data?.error || bars2.data?.error) && !loading) notes.push("Minute bars are unavailable right now. Live prices still draw.");
    }
    if (round > WINDOW_SECS) notes.push("Showing the last 6 hours.");

    return { p1, p2, domain: [x0, x1], endpointsOnly, notes, loading };
  }, [d, now, ended, bars1.data, bars2.data, bars1.isLoading, bars2.isLoading, polls, t1, t2, win]);
}
