/* The off-hours price, end to end, against the live pool right now.
 *
 *   npx tsx scripts/offhours-probe.ts [pool]
 *
 * Reads the same functions the oracle reads, so what it prints is what a fight
 * settling at this moment would be signed for. Prints the window it used, so
 * the answer can be checked by eye against the minutes it came from, including
 * which of them the trim throws away. */

import { fetchPoolBars, OFFHOURS_TRIM, OFFHOURS_WINDOW, QUOTE_EXPO, quoteAt, trimmedMeanAtBoundary } from "../src/lib/oracle";

// TSLAx / USDC, the deepest pool at the time of writing.
const POOL = process.argv[2] ?? "";

async function main() {
  const pool = POOL || (await deepestTslaPool());
  const boundary = Math.floor(Date.now() / 1000) - 60;

  const bars = await fetchPoolBars(pool, boundary);
  const used = bars.t
    .map((t, i) => ({ t, c: bars.c[i] }))
    .filter((b) => b.t + 60 <= boundary && b.t + 60 > boundary - OFFHOURS_WINDOW * 60 && b.c);

  console.log(`pool ${pool}`);
  console.log(`boundary ${new Date(boundary * 1000).toISOString()}`);
  console.log(`\nthe window (${used.length} minutes that traded, of ${OFFHOURS_WINDOW}):`);
  for (const b of used) console.log(`  ${new Date((b.t + 60) * 1000).toISOString()}  ${b.c!.toFixed(2)}`);

  /* Show the trim doing its work: the same sort the oracle does, with the ends
   * it discards marked, so a bought minute can be seen landing in the part
   * that counts for nothing. */
  const sorted = used.map((b) => b.c!).sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * OFFHOURS_TRIM));
  if (sorted.length) {
    console.log(`\nsorted, ${cut} discarded from each end:`);
    for (const [i, c] of sorted.entries()) {
      const kept = i >= cut && i < sorted.length - cut;
      console.log(`  ${c.toFixed(2)}  ${kept ? "kept" : "thrown away"}`);
    }
  }

  const m = trimmedMeanAtBoundary(bars, boundary);
  console.log(`\ntrimmed mean: ${m ? (Number(m.price) * 10 ** QUOTE_EXPO).toFixed(4) : "not enough minutes traded"}`);

  // And through the real entry point, as a fight would ask for it.
  const q = await quoteAt({
    feed: "00".repeat(32),
    symbol: "TSLA",
    market: "US",
    pool,
    boundary,
  });
  console.log(`quoteAt:  ${q ? (Number(q.price) * 10 ** q.expo).toFixed(4) : "null"}`);
  if (q) console.log(`publishTime ${q.publishTime} (boundary ${boundary}); the program needs publishTime >= boundary`);
}

async function deepestTslaPool(): Promise<string> {
  const r = await fetch(
    "https://api.geckoterminal.com/api/v2/networks/solana/tokens/XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB/pools",
    { headers: { accept: "application/json", "user-agent": "stonkwars-probe/1.0" } },
  );
  const body = (await r.json()) as { data?: { attributes?: { address?: string; reserve_in_usd?: string } }[] };
  const best = (body.data ?? []).sort(
    (a, b) => Number(b.attributes?.reserve_in_usd ?? 0) - Number(a.attributes?.reserve_in_usd ?? 0),
  )[0];
  if (!best?.attributes?.address) throw new Error("no TSLAx pool");
  return best.attributes.address;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
