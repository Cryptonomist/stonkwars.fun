import { NextResponse } from "next/server";

import { bareFeed, hermes } from "@/lib/hermes.server";
import { byFeed, ROSTER } from "@/lib/stocks";
import type { Quote, Quotes } from "@/lib/prices";

export const dynamic = "force-dynamic";

/* Every visitor polls this, so it is cached for two seconds per server
 * instance: one Hermes request serves everyone watching in that window. */
let cache: { at: number; body: Quotes } | null = null;
const TTL_MS = 2_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const res = await hermes().getLatestPriceUpdates(
      ROSTER.map((s) => s.feed),
      { parsed: true, ignoreInvalidPriceIds: true },
    );
    const quotes: Record<string, Quote> = {};
    for (const p of res.parsed ?? []) {
      const stock = byFeed(bareFeed(p.id));
      if (!stock) continue;
      quotes[stock.ticker] = {
        ticker: stock.ticker,
        price: String(p.price.price),
        expo: p.price.expo,
        conf: String(p.price.conf),
        publishTime: p.price.publish_time,
      };
    }
    const body: Quotes = { quotes, at: Math.floor(Date.now() / 1000) };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Hermes request failed";
    return NextResponse.json({ quotes: {}, at: Math.floor(Date.now() / 1000), error }, { status: 503 });
  }
}
