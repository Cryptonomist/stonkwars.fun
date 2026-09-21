import "server-only";

/* A month of daily closes per stock, for the fighter stats on the pick screen.
 *
 * The same spark endpoint the live prices use, asked for a month of days
 * instead of a day: twenty symbols a request, so a screenful of fighters is one
 * call. Never an input to an outcome (the program reads only the boundary
 * prices a crank posts), and never converted between currencies, because every
 * stat built from these is a ratio (see lib/fighterStats.ts). */

import type { Stock } from "@/lib/stocks";

const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark";
const PER_REQUEST = 20;

type SparkResult = {
  symbol: string;
  response?: { indicators?: { quote?: { close?: (number | null)[] }[] } }[];
};

async function batch(symbols: string[]): Promise<Map<string, number[]>> {
  const r = await fetch(`${SPARK}?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1mo&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" },
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!r.ok) throw new Error(`market data HTTP ${r.status}`);
  const body = (await r.json()) as { spark?: { result?: SparkResult[] } };
  const out = new Map<string, number[]>();
  for (const s of body.spark?.result ?? []) {
    const closes = (s.response?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
    );
    if (closes.length) out.set(s.symbol, closes);
  }
  return out;
}

/** Daily closes by ticker. A symbol the source will not answer for is left out
 * rather than failing the others. */
export async function dailyCloses(stocks: Stock[]): Promise<Record<string, number[]>> {
  const symbols = [...new Set(stocks.map((s) => s.quote))];
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += PER_REQUEST) batches.push(symbols.slice(i, i + PER_REQUEST));
  const results = await Promise.allSettled(batches.map(batch));

  const seen = new Map<string, number[]>();
  for (const res of results) if (res.status === "fulfilled") for (const [k, v] of res.value) seen.set(k, v);

  const out: Record<string, number[]> = {};
  for (const s of stocks) {
    const closes = seen.get(s.quote);
    if (closes) out[s.ticker] = closes;
  }
  return out;
}
