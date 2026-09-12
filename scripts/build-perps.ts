/* Which stocks have a perpetual market that never closes.
 *
 *   npx tsx scripts/build-perps.ts
 *
 * Hyperliquid's HIP-3 lets anyone deploy perp markets, and the `xyz` deployer
 * runs about 120 of them on equities, indices and commodities. Unlike a Solana
 * pool, which can sit untouched for an hour at four in the morning, these print
 * a candle every minute of every day. That is what lets a fight settle at a
 * weekend on the ordinary rule, "the first price at or after the boundary",
 * rather than on a smoothed window.
 *
 * ONLY EXACT TICKER MATCHES. `xyz:SP500` is the index, not SPY the ETF, and
 * they trade at completely different prices. A near-enough match here would
 * settle fights on the wrong instrument, so a stock without its own ticker on
 * the venue simply does not get one.
 *
 * Output: src/data/perps.json, ticker -> the market and what earned it a place.
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const API = "https://api.hyperliquid.xyz/info";
const DEX = "xyz";

/** Enough daily notional that the mark is somebody's real position. */
const MIN_24H_NOTIONAL = 1_000_000;
/** And it has to actually print: minutes with a candle, out of the last 60. */
const MIN_MINUTES_PER_HOUR = 55;

/* AND IT HAS TO BE THE SAME COMPANY.
 *
 * A matching ticker is not a matching instrument. Our roster's CL is
 * Colgate-Palmolive; `xyz:CL` trades at 95.56 next door to `xyz:BRENTOIL` at
 * 99.67, because on a futures venue CL is crude oil. Settling a Colgate fight
 * on the price of oil would be silent and catastrophic, and no amount of
 * volume or candle coverage would have caught it.
 *
 * So every match is checked against the stock's own last market price. They do
 * not agree exactly, because the perp keeps moving after the exchange shuts:
 * measured across a weekend, every genuine match sat within 2.25% and most
 * within half a percent, while CL sat 10.15% out. Five percent is the line
 * between the two, and it fails safe. Refusing a real match costs one stock;
 * accepting a false one settles fights on the wrong asset. */
const MAX_PRICE_GAP = 0.05;

type Entry = { coin: string; notional24h: number; minutesPerHour: number; markVsMarket: number; at: string };

const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark";

/** The stock's own last market price, for checking the perp is the same thing. */
async function marketPrice(quote: string): Promise<number | null> {
  const r = await fetch(`${SPARK}?symbols=${encodeURIComponent(quote)}&range=1d&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; stonkwars/1.0)" },
  });
  if (!r.ok) return null;
  const body = (await r.json()) as { spark?: { result?: { response?: { meta?: { regularMarketPrice?: number } }[] }[] } };
  const px = body.spark?.result?.[0]?.response?.[0]?.meta?.regularMarketPrice;
  return typeof px === "number" && px > 0 ? px : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(body: unknown): Promise<unknown> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Minutes in the last hour that printed a candle. */
async function coverage(coin: string): Promise<number> {
  const end = Date.now();
  const candles = (await post({
    type: "candleSnapshot",
    req: { coin, interval: "1m", startTime: end - 60 * 60_000, endTime: end },
  })) as { T: number; c: string }[] | null;
  return (candles ?? []).filter((c) => Number(c.c) > 0).length;
}

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/roster.json"), "utf8")) as {
    ticker: string;
    name: string;
    quote: string;
    currency: string;
    source: string;
  }[];

  const [meta, ctxs] = (await post({ type: "metaAndAssetCtxs", dex: DEX })) as [
    { universe: { name: string }[] },
    { dayNtlVlm: string; markPx: string }[],
  ];

  const venue = new Map<string, { notional: number; mark: number }>();
  meta.universe.forEach((u, i) =>
    venue.set(u.name, { notional: Number(ctxs[i]?.dayNtlVlm ?? 0), mark: Number(ctxs[i]?.markPx ?? 0) }),
  );
  console.log(`${venue.size} markets on ${DEX}`);

  const out: Record<string, Entry> = {};
  const today = new Date().toISOString().slice(0, 10);
  let noMarket = 0;
  let quiet = 0;

  let impostor = 0;
  for (const stock of roster) {
    const coin = `${DEX}:${stock.ticker}`;
    const market = venue.get(coin);
    if (market === undefined) {
      noMarket++;
      continue;
    }
    if (market.notional < MIN_24H_NOTIONAL) {
      quiet++;
      continue;
    }
    if (stock.currency !== "USD") {
      // The perp is quoted in dollars; a foreign listing is not, and a fight
      // that mixed the two would compare a converted price with a raw one.
      impostor++;
      continue;
    }
    try {
      const real = await marketPrice(stock.quote);
      if (real === null) {
        quiet++;
        console.log(`  ${stock.ticker.padEnd(6)} no market price to check it against`);
        await sleep(300);
        continue;
      }
      const gap = Math.abs(market.mark - real) / real;
      if (gap > MAX_PRICE_GAP) {
        impostor++;
        console.log(
          `  ${stock.ticker.padEnd(6)} REFUSED  ${stock.name}: perp ${market.mark.toFixed(2)} against a real` +
            ` ${real.toFixed(2)}, ${(gap * 100).toFixed(0)}% apart. Different asset, same ticker.`,
        );
        await sleep(300);
        continue;
      }

      const minutes = await coverage(coin);
      if (minutes < MIN_MINUTES_PER_HOUR) {
        quiet++;
        console.log(`  ${stock.ticker.padEnd(6)} ${minutes}/60 minutes, too patchy`);
      } else {
        out[stock.ticker] = { coin, notional24h: market.notional, minutesPerHour: minutes, markVsMarket: gap, at: today };
        console.log(
          `  ${stock.ticker.padEnd(6)} ${String(minutes).padStart(2)}/60 minutes` +
            `  24h $${Math.round(market.notional).toLocaleString().padStart(12)}` +
            `  ${(gap * 100).toFixed(2)}% off the share  kept`,
        );
      }
    } catch (e) {
      quiet++;
      console.log(`  ${stock.ticker.padEnd(6)} ${e instanceof Error ? e.message : e}`);
    }
    await sleep(300);
  }

  const file = path.join(ROOT, "src/data/perps.json");
  fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(
    `\n${Object.keys(out).length} stocks have a perpetual market that never closes` +
      ` (${impostor} refused as a different asset, ${quiet} too quiet or patchy,` +
      ` ${noMarket} with no market of their own, of ${roster.length})`,
  );
  console.log(`written to ${path.relative(ROOT, file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
