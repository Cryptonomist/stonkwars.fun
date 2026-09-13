/* Which stocks can be priced when their exchange is shut, and where.
 *
 *   npx tsx scripts/build-pools.ts
 *
 * A tokenized share keeps trading on Solana through the night and the weekend.
 * For that to settle a fight it has to be readable by anyone, the same way
 * twice, so this pins ONE pool per stock: the deepest, recorded in
 * src/data/pools.json with the liquidity and volume that earned it the place.
 *
 * A pool below the floors is left out and its stock keeps exchange hours. The
 * floors are not about honesty of the price, they are about what it costs to
 * push one: the off-hours price is a trimmed mean of up to fifteen one-minute
 * closes, discarding the highest fifth and the lowest fifth, so a bought minute
 * lands in the part that is thrown away and counts for nothing. Moving the
 * answer means holding the price away from fair value across most of the sample
 * while arbitrage trades against you. Against a hundred thousand dollars of
 * depth that costs orders of magnitude more than any stake in this game.
 *
 * Re-run it when the market changes. Pools move; this file is a snapshot and
 * says when it was taken. */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const GECKO = "https://api.geckoterminal.com/api/v2";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; stonkwars-pools/1.0)", accept: "application/json" };

/** Deep enough that pushing the off-hours price is not worth anyone's while. */
const MIN_LIQUIDITY_USD = 100_000;
/** Traded enough that somebody is watching it, and would arbitrage a push. */
const MIN_VOLUME_24H_USD = 25_000;

/* AND DEPTH IS NOT THE SAME AS TRADING.
 *
 * Measured at one in the morning, five of twenty-three pools that passed the
 * floors above could be priced at all. CRCL had $2.19M sitting in it and had
 * not traded a minute in the hour. A stock the app promises will fight around
 * the clock and then cannot price is worse than one that never claimed it.
 *
 * So the last gate is the only one that matters overnight: how many minutes of
 * the last hour actually traded. Run this script at a quiet hour and the list
 * it writes is one that holds up at every other hour too. */
const MIN_TRADED_MINUTES_PER_HOUR = 20;

/** The multi endpoint takes thirty addresses at a time and names each one's
 *  deepest pool, so the whole roster is thirty-five calls rather than a
 *  thousand. Asking once per token took hours and mostly ate rate limits. */
const PER_CALL = 30;
const GAP_MS = 3_000;

type Token = { ticker: string; mint: string };
type Pool = { pool: string; dex: string; liquidityUsd: number; volume24hUsd: number; tradedMinutesPerHour?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MultiBody = {
  data?: {
    attributes?: { address?: string };
    relationships?: { top_pools?: { data?: { id?: string }[] } };
  }[];
  included?: {
    id?: string;
    attributes?: { address?: string; name?: string; reserve_in_usd?: string; volume_usd?: { h24?: string } };
  }[];
};

/** The deepest pool for each of `mints`, by mint, where the source knows one. */
async function topPools(mints: string[], attempt = 0): Promise<Map<string, Pool>> {
  const url = `${GECKO}/networks/solana/tokens/multi/${mints.join(",")}?include=top_pools`;
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 4) throw new Error(`HTTP ${r.status} after retries`);
    await sleep(6_000 * (attempt + 1));
    return topPools(mints, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const body = (await r.json()) as MultiBody;
  const pools = new Map((body.included ?? []).map((p) => [p.id ?? "", p]));

  const out = new Map<string, Pool>();
  for (const token of body.data ?? []) {
    const mint = token.attributes?.address;
    const topId = token.relationships?.top_pools?.data?.[0]?.id;
    const pool = topId ? pools.get(topId) : undefined;
    if (!mint || !pool?.attributes?.address) continue;
    out.set(mint, {
      pool: pool.attributes.address,
      dex: pool.attributes.name ?? "",
      liquidityUsd: Number(pool.attributes.reserve_in_usd ?? 0),
      volume24hUsd: Number(pool.attributes.volume_usd?.h24 ?? 0),
    });
  }
  return out;
}

/** How many of the last sixty minutes this pool actually traded. */
async function tradedMinutes(pool: string, attempt = 0): Promise<number> {
  const before = Math.floor(Date.now() / 1000);
  const url = `${GECKO}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=65&before_timestamp=${before}`;
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 4) return 0;
    await sleep(6_000 * (attempt + 1));
    return tradedMinutes(pool, attempt + 1);
  }
  if (!r.ok) return 0;
  const body = (await r.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  const rows = body.data?.attributes?.ohlcv_list ?? [];
  return rows.filter(([t, , , , c]) => c > 0 && t + 60 > before - 3_600 && t + 60 <= before).length;
}

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/stocks.mainnet-beta.json"), "utf8")) as {
    tokens: Token[];
  };

  // One mint per stock: the first issuer's, which is the roster's own order.
  const byTicker = new Map<string, string>();
  for (const t of deployment.tokens) if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, t.mint);

  const out: Record<string, Pool & { at: string }> = {};
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, "src/data/pools.json");
  const save = () => fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);

  const entries = [...byTicker];
  const candidates: [string, Pool][] = [];
  let checked = 0;
  let tooThin = 0;
  let none = 0;

  for (let i = 0; i < entries.length; i += PER_CALL) {
    const batch = entries.slice(i, i + PER_CALL);
    try {
      const found = await topPools(batch.map(([, mint]) => mint));
      for (const [ticker, mint] of batch) {
        const best = found.get(mint);
        if (!best) none++;
        else if (best.liquidityUsd < MIN_LIQUIDITY_USD || best.volume24hUsd < MIN_VOLUME_24H_USD) tooThin++;
        else candidates.push([ticker, best]);
      }
    } catch (e) {
      console.error(`batch at ${i}: ${e instanceof Error ? e.message : e}`);
    }
    checked += batch.length;
    console.log(`${checked}/${entries.length} checked, ${candidates.length} deep enough`);
    await sleep(GAP_MS);
  }

  /* The gate that actually decides it: does this pool trade? Asked last,
   * because it costs a request each and only the deep ones are worth asking
   * about. */
  console.log(`\nmeasuring how much ${candidates.length} of them trade, one hour back`);
  let quiet = 0;
  for (const [ticker, pool] of candidates) {
    const minutes = await tradedMinutes(pool.pool);
    if (minutes >= MIN_TRADED_MINUTES_PER_HOUR) {
      out[ticker] = { ...pool, at: today, tradedMinutesPerHour: minutes };
      console.log(`  ${ticker.padEnd(6)} ${String(minutes).padStart(2)}/60 traded  kept`);
    } else {
      quiet++;
      console.log(`  ${ticker.padEnd(6)} ${String(minutes).padStart(2)}/60 traded  too quiet to price`);
    }
    save();
    await sleep(GAP_MS);
  }

  save();
  console.log(
    `\n${Object.keys(out).length} stocks can settle around the clock, measured at ${new Date().toISOString()}` +
      ` (${quiet} deep but too quiet, ${tooThin} pools too thin, ${none} with no pool at all, of ${byTicker.size})`,
  );
  console.log(`written to ${path.relative(ROOT, file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
