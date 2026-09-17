import { NextResponse } from "next/server";

import { PRESTOCKS } from "@/lib/prestocks";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

/* WHAT A PRE-IPO TOKEN IS WORTH, AS A ROUTED QUOTE.
 *
 * FOR DISPLAY AND FOR BUYING. Nothing here settles anything: these tokens are
 * never staked (lib/prestocks.ts says why), so no number on this route can
 * decide a result.
 *
 * THE PRICE IS WHAT A BUY WOULD PAY, and that is not a detail. Four numbers
 * were available for OpenAI and they disagreed by up to 62%: the issuer's API
 * mark ($964), the issuer's own token price ($1,060), Jupiter's indexed
 * usdPrice ($1,061), and the pool ($1,555). A routed quote paid $1,569, which
 * matched only the pool, so the indexed prices are simply wrong here. Worse,
 * the pool source went stale for three of the seven at once and reported prices
 * up to 47% out with no trades behind them, which is exactly the kind of number
 * this site refuses to print.
 *
 * So the price is taken from a real quote for a real size: what $100 of USDC
 * buys right now, divided out. It is the one number nobody has to trust us
 * about, because it is the number the buy button would honour.
 *
 * The 24 hour move comes from the pool and is dropped whenever that pool shows
 * no trades in the window, because a change computed off a stale price is a
 * fiction dressed as a fact. */

const JUP = process.env.JUPITER_API_KEY || process.env.JUP_API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
const KEY = process.env.JUPITER_API_KEY || process.env.JUP_API_KEY;
const GECKO = "https://api.geckoterminal.com/api/v2";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Big enough that the quote is a real market, small enough not to move it. */
const PROBE_USDC = 100;
const TTL_MS = 30_000;

type Quote = { usd: number | null; change24h: number | null; trades24h: number | null; impactPct: number | null; route: string[] };
type Body = { at: number; probeUsd: number; prices: Record<string, Quote>; note?: string };

let cached: { at: number; body: Body } | null = null;

async function priceOf(mint: string, decimals: number) {
  const url = `${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}&amount=${PROBE_USDC * 1e6}&slippageBps=100`;
  const r = await fetch(url, {
    headers: { accept: "application/json", ...(KEY ? { "x-api-key": KEY } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(9_000),
  });
  if (!r.ok) return null;
  const q = (await r.json()) as { outAmount?: string; priceImpactPct?: string; routePlan?: { swapInfo?: { label?: string } }[] };
  const out = Number(q.outAmount) / 10 ** decimals;
  if (!Number.isFinite(out) || out <= 0) return null;
  return {
    usd: PROBE_USDC / out,
    impactPct: q.priceImpactPct != null ? Number(q.priceImpactPct) * 100 : null,
    route: [...new Set((q.routePlan ?? []).map((p) => p.swapInfo?.label).filter((l): l is string => !!l))],
  };
}

/** The 24 hour move, only from pools that actually traded. */
async function moves() {
  const out = new Map<string, { change24h: number | null; trades24h: number }>();
  try {
    const r = await fetch(`${GECKO}/networks/solana/pools/multi/${PRESTOCKS.map((p) => p.pool).join(",")}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9_000),
    });
    if (!r.ok) return out;
    const body = (await r.json()) as { data?: { attributes?: Record<string, unknown> }[] };
    for (const row of body.data ?? []) {
      const a = row.attributes ?? {};
      const addr = typeof a.address === "string" ? a.address.toLowerCase() : null;
      if (!addr) continue;
      const tx = (a.transactions as Record<string, Record<string, number>> | undefined)?.h24;
      const trades = tx ? (tx.buys ?? 0) + (tx.sells ?? 0) : 0;
      const chg = Number((a.price_change_percentage as Record<string, unknown> | undefined)?.h24);
      out.set(addr, { trades24h: trades, change24h: trades > 0 && Number.isFinite(chg) ? chg : null });
    }
  } catch {
    /* No move shown rather than a made-up one. */
  }
  return out;
}

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "cache-control": "public, s-maxage=30" } });
  }

  const [quotes, move] = await Promise.all([
    Promise.all(PRESTOCKS.map((p) => priceOf(p.mint, p.decimals).catch(() => null))),
    moves(),
  ]);

  const prices: Record<string, Quote> = {};
  PRESTOCKS.forEach((p, i) => {
    const q = quotes[i];
    const m = move.get(p.pool.toLowerCase());
    prices[p.ticker] = {
      usd: q?.usd ?? null,
      impactPct: q?.impactPct ?? null,
      route: q?.route ?? [],
      trades24h: m?.trades24h ?? null,
      change24h: m?.change24h ?? null,
    };
  });

  const priced = Object.values(prices).filter((q) => q.usd != null).length;
  const body: Body = {
    at: Math.floor(Date.now() / 1000),
    probeUsd: PROBE_USDC,
    prices,
    ...(priced === 0 ? { note: "Quotes are unavailable right now." } : {}),
  };
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": priced ? "public, s-maxage=30" : "no-store" } });
}
