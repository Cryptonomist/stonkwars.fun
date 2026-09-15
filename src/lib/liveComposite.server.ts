import "server-only";

/* THE LIVE 24/7 MEDIAN, FETCHED.
 *
 * One bulk request per venue (liveComposite.ts, tickerRequest), shared by every
 * page polling for CACHE_MS, so however many tiles are on screen each venue is
 * asked at most once in that time. A venue that fails, times out or answers
 * 429 simply has no prices this round, and a stock short of a quorum has no
 * live price; the prices route keeps its last good one. Nothing here throws. */

import { VENUE_ORDER, type VenueId } from "./composite";
import { liveMedianAt, parseTickers, pinnedAt, tickerRequest, type LiveMedian } from "./liveComposite";
import { QUOTE_EXPO } from "./oracle";

/** How long a venue's answer is shared by everyone asking. */
export const CACHE_MS = 15_000;
const TIMEOUT_MS = 5_000;

const answers = new Map<VenueId, { at: number; key: string; prices: Promise<Record<string, string> | null> }>();

function venuePrices(venue: VenueId, instruments: string[], nowMs: number): Promise<Record<string, string> | null> {
  const key = instruments.join(",");
  const kept = answers.get(venue);
  if (kept && kept.key === key && nowMs - kept.at < CACHE_MS) return kept.prices;
  const req = tickerRequest(venue, instruments);
  const prices = fetch(req.url, { ...req.init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(async (r) => (r.ok ? parseTickers(venue, await r.json()) : null))
    .catch(() => null);
  answers.set(venue, { at: nowMs, key, prices });
  return prices;
}

/** Each ticker's live 24/7 median in dollars at `now` (unix seconds), or null
 *  where too few of its pinned markets answered. */
export async function liveCompositePrices(tickers: string[], now: number): Promise<Map<string, { price: number; markets: number } | null>> {
  const out = new Map<string, { price: number; markets: number } | null>();
  if (!tickers.length) return out;
  const nowMs = Date.now();
  const fetched: Partial<Record<VenueId, Record<string, string>>> = {};
  await Promise.all(
    VENUE_ORDER.map(async (venue) => {
      const instruments = pinnedAt(venue, now);
      if (!instruments.length) return;
      const prices = await venuePrices(venue, instruments, nowMs);
      if (prices) fetched[venue] = prices;
    }),
  );
  for (const t of tickers) {
    const m: LiveMedian | null = liveMedianAt(t, now, fetched);
    out.set(t, m ? { price: Number(m.ticks) * 10 ** QUOTE_EXPO, markets: m.markets } : null);
  }
  return out;
}
