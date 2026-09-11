import { NextResponse } from "next/server";

import { DEV_EXPO, devPrice } from "@/lib/devPrices";
import { bareFeed, hermes } from "@/lib/hermes.server";
import { byFeed, ROSTER } from "@/lib/stocks";
import type { Quote, Quotes } from "@/lib/prices";

export const dynamic = "force-dynamic";

/* Every visitor polls this, so it is cached for two seconds per server
 * instance: one Hermes request serves everyone watching in that window. */
let cache: { at: number; body: Quotes } | null = null;
const TTL_MS = 2_000;

/* DEVELOPMENT ONLY: synthetic quotes that wander, so every screen can be
 * exercised on a local validator before a Pyth key exists. Refused outright in
 * a production build. These numbers never reach a transaction's outcome: the
 * program only ever reads signed Pyth accounts. */
function devQuotes(): Quotes {
  const t = Math.floor(Date.now() / 1000);
  const quotes: Record<string, Quote> = {};
  for (const s of ROSTER) {
    quotes[s.ticker] = {
      ticker: s.ticker,
      price: String(devPrice(s.ticker, t)),
      expo: DEV_EXPO,
      conf: "2000",
      publishTime: t,
    };
  }
  return { quotes, at: t };
}

export async function GET() {
  if (process.env.DEV_FAKE_PRICES === "1" && process.env.NODE_ENV !== "production") {
    return NextResponse.json(devQuotes());
  }
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
