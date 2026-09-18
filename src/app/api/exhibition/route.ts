import { NextResponse, type NextRequest } from "next/server";

import { isWindowId, legFrom, verdictOf, WINDOWS, type Exhibition, type Leg } from "@/lib/exhibition";
import { fetchBars } from "@/lib/oracle";
import { byPreTicker, dexName } from "@/lib/prestocks";
import { byTicker, quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** It waits on two market data sources, so give it more than the default ten. */
export const maxDuration = 30;

/* AN EXHIBITION BOUT: /api/exhibition?a=OPENAI&b=NVDA&w=24h
 *
 * FOR WATCHING ONLY, AND THAT IS THE POINT. A PreStocks company cannot be
 * staked here (see lib/prestocks.ts: permanent delegate, transfer fee, transfer
 * hook), so it can never be in a real fight. An exhibition lets it fight
 * anyway with nothing on the table: the prices are real, the result is not on
 * chain, no program runs and no stake moves.
 *
 * Each side is read from the market that actually quotes it. A PreStocks side
 * comes from the same Solana pool its desk quotes; a roster side comes from the
 * exchange's own bars. Neither is signed, neither is checked on chain, and
 * nothing here is an input to any real fight's result.
 *
 * Both sides are asked for the same window and each is measured from its own
 * first traded price in it, so a stock that was shut for part of a 24 hour
 * window is flat over that stretch rather than absent from the race. */

/** Finished windows never change, so each answer is kept per server instance. */
const recent = new Map<string, { at: number; body: Exhibition }>();
const CACHE_MS = 60_000;
const MAX_KEPT = 120;

/* GeckoTerminal's OHLCV, at the bucket the window asks for.
 *
 * THE WINDOW IS ENFORCED HERE, NOT ASSUMED. `limit` returns the last N bars
 * that EXIST, which for a thin pool is not the last N hours: SpaceX's most
 * recent 26 hour bars ran from 21 to 23 January, eight months before they were
 * asked for. Taking them as a 24 hour race would have drawn a stale price as a
 * current one and named a winner on it. So anything outside the window is
 * dropped, and a side with nothing left becomes a no-contest, which is the
 * true answer: it did not trade. */
async function poolLeg(ticker: string, bucket: "minute" | "hour", points: number, from: number, to: number): Promise<Leg> {
  const p = byPreTicker(ticker);
  if (!p) throw new Error(`${ticker} is not a listed private company`);
  const url =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${p.pool}` +
    `/ohlcv/${bucket}?aggregate=1&limit=${Math.min(points, 1000)}`;
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`${ticker}: pool data HTTP ${r.status}`);
  const body = (await r.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  /* GeckoTerminal answers newest first; every other series here is oldest
   * first, and a reversed leg would draw the race backwards. */
  const rows = [...(body.data?.attributes?.ohlcv_list ?? [])]
    .sort((a, b) => a[0] - b[0])
    .filter((row) => row[0] >= from && row[0] <= to);
  const leg = legFrom(
    p.ticker,
    p.name,
    "pool",
    rows.map((row) => row[0]),
    rows.map((row) => (row[4] > 0 ? row[4] : null)),
  );
  /* Name the venue this side was read from, so the card can say it rather
   * than call everything "a Solana pool". */
  return { ...leg, venue: dexName(p.dex) ?? undefined, pool: p.pool };
}

/** The exchange's own bars for a roster stock. */
async function stockLeg(ticker: string, from: number, to: number, bucket: "minute" | "hour"): Promise<Leg> {
  const stock = byTicker(ticker);
  if (!stock) throw new Error(`${ticker} is not on the roster`);
  const symbol = quoteSymbolFor(stock.feed)?.symbol ?? stock.quote;
  const bars = await fetchBars(symbol, from, to, bucket === "minute" ? "1m" : "1h");
  return legFrom(stock.ticker, stock.name, "exchange", bars.t, bars.c);
}

const legFor = (ticker: string, from: number, to: number, bucket: "minute" | "hour", points: number) =>
  byPreTicker(ticker) ? poolLeg(ticker, bucket, points, from, to) : stockLeg(ticker, from, to, bucket);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = (q.get("a") ?? "").toUpperCase();
  const b = (q.get("b") ?? "").toUpperCase();
  const w = q.get("w") ?? "24h";

  if (!a || !b) return NextResponse.json({ error: "Name two sides: ?a=OPENAI&b=NVDA" }, { status: 400 });
  if (a === b) return NextResponse.json({ error: "A side cannot fight itself." }, { status: 400 });
  if (!isWindowId(w)) return NextResponse.json({ error: `Unknown window ${w}.` }, { status: 400 });
  /* At least one side must be a private company, or this is just two stocks
   * that could have had a real fight with something at stake. */
  if (!byPreTicker(a) && !byPreTicker(b)) {
    return NextResponse.json(
      { error: "One side must be a private company. Two roster stocks can fight for real instead." },
      { status: 400 },
    );
  }

  const key = `${a}:${b}:${w}`;
  const had = recent.get(key);
  if (had && Date.now() - had.at < CACHE_MS) return NextResponse.json(had.body);

  const { secs, bucket } = WINDOWS[w];
  const to = Math.floor(Date.now() / 1000);
  const from = to - secs;
  const points = Math.ceil(secs / (bucket === "minute" ? 60 : 3_600)) + 2;

  try {
    /* Both at once: one waits on a pool and the other on the exchange, and
     * they have nothing to say to each other. */
    const [legA, legB] = await Promise.all([
      legFor(a, from, to, bucket, points),
      legFor(b, from, to, bucket, points),
    ]);
    const body: Exhibition = { from, to, a: legA, b: legB, verdict: verdictOf(legA, legB) };

    if (recent.size > MAX_KEPT) recent.clear();
    recent.set(key, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    /* Only the first line, and never a key or an upstream URL. */
    const why = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "could not read a market";
    return NextResponse.json({ error: why }, { status: 502 });
  }
}
