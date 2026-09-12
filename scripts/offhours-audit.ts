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

import { quoteAt, sourceAt } from "../src/lib/oracle";
import { quoteSymbolFor, ROSTER, tradesAroundTheClock } from "../src/lib/stocks";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* How long ago to ask about. Ninety seconds is the settler's first attempt;
   * a market that prints every few minutes has not necessarily printed by
   * then, and saying so is correct rather than broken. Pass a larger number to
   * see what a patient settler gets. */
  const ageSecs = Number(process.argv[2] ?? 90);
  const boundary = Math.floor(Date.now() / 1000) - ageSecs;
  console.log(`asking for a price at ${new Date(boundary * 1000).toISOString()}\n`);

  const stocks = ROSTER.filter((s) => tradesAroundTheClock(s.ticker));
  const can: string[] = [];
  const cannot: string[] = [];

  for (const stock of stocks) {
    const market = quoteSymbolFor(stock.feed);
    if (!market) {
      cannot.push(stock.ticker);
      continue;
    }
    const from = sourceAt(boundary, market);
    try {
      const q = await quoteAt({ feed: stock.feed, ...market, boundary });
      if (q) {
        can.push(stock.ticker);
        console.log(
          `  ${stock.ticker.padEnd(6)} ${from.padEnd(8)} ${(Number(q.price) * 10 ** q.expo).toFixed(2).padStart(10)}`,
        );
      } else {
        cannot.push(stock.ticker);
        console.log(`  ${stock.ticker.padEnd(6)} ${from.padEnd(8)} NO PRICE`);
      }
    } catch (e) {
      cannot.push(stock.ticker);
      console.log(`  ${stock.ticker.padEnd(6)} ${from.padEnd(8)} ERROR ${e instanceof Error ? e.message : e}`);
    }
    // The pool source is free and rate limited; the perp is free and is not.
    await sleep(from === "pool" ? 2_500 : 400);
  }

  console.log(`\n${can.length} of ${stocks.length} can be priced at this hour`);
  if (cannot.length) console.log(`cannot: ${cannot.join(" ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
