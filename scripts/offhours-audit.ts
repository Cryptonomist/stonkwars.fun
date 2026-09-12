/* Which pinned stocks can actually be priced right now?
 *
 *   npx tsx scripts/offhours-audit.ts
 *
 * A pool passing a liquidity floor is not the same as a pool that trades. Deep
 * pools can sit untouched for an hour at four in the morning, and a stock the
 * app promises will fight around the clock but cannot be priced is worse than
 * one that never claimed it.
 *
 * This asks the real oracle for a real quote at a boundary a minute ago, for
 * every pinned pool, and reports which answer. Run it at the hour you care
 * about; the answer at noon says nothing about the answer at 4am. */

import fs from "fs";
import path from "path";

import { quoteAt } from "../src/lib/oracle";
import { byTicker, quoteSymbolFor } from "../src/lib/stocks";

const ROOT = path.resolve(__dirname, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pools = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/pools.json"), "utf8")) as Record<
    string,
    { pool: string; liquidityUsd: number; volume24hUsd: number }
  >;
  const boundary = Math.floor(Date.now() / 1000) - 90;
  console.log(`asking for a price at ${new Date(boundary * 1000).toISOString()}\n`);

  const can: string[] = [];
  const cannot: string[] = [];

  for (const [ticker, p] of Object.entries(pools)) {
    const stock = byTicker(ticker);
    const market = stock ? quoteSymbolFor(stock.feed) : undefined;
    if (!stock || !market) {
      cannot.push(`${ticker} (not in the roster)`);
      continue;
    }
    try {
      const q = await quoteAt({ feed: stock.feed, ...market, boundary });
      if (q) {
        can.push(ticker);
        console.log(`  ${ticker.padEnd(6)} ok    ${(Number(q.price) * 10 ** q.expo).toFixed(2).padStart(10)}`);
      } else {
        cannot.push(ticker);
        console.log(`  ${ticker.padEnd(6)} NO PRICE   liquidity $${Math.round(p.liquidityUsd).toLocaleString()}`);
      }
    } catch (e) {
      cannot.push(ticker);
      console.log(`  ${ticker.padEnd(6)} ERROR ${e instanceof Error ? e.message : e}`);
    }
    await sleep(2_500); // the source is free; do not make it regret that
  }

  console.log(`\n${can.length} of ${Object.keys(pools).length} can be priced at this hour`);
  console.log(`can:    ${can.join(" ")}`);
  console.log(`cannot: ${cannot.join(" ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
