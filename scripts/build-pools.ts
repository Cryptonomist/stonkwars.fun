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
 * push one: the off-hours price is the median of fifteen one-minute closes, so
 * a manipulator has to hold the price away from fair value across eight
 * separate minutes while arbitrage trades against them. Against a hundred
 * thousand dollars of depth that costs orders of magnitude more than any stake
 * in this game.
 *
 * Re-run it when the market changes. Pools move; this file is a snapshot and
 * says when it was taken. */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const GECKO = "https://api.geckoterminal.com/api/v2";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; stonkwars-pools/1.0)", accept: "application/json" };

/** Deep enough that pushing a fifteen-minute median is not worth anyone's while. */
const MIN_LIQUIDITY_USD = 100_000;
/** Traded enough that somebody is watching it, and would arbitrage a push. */
const MIN_VOLUME_24H_USD = 25_000;

/** The multi endpoint takes thirty addresses at a time and names each one's
 *  deepest pool, so the whole roster is thirty-five calls rather than a
 *  thousand. Asking once per token took hours and mostly ate rate limits. */
const PER_CALL = 30;
const GAP_MS = 3_000;

type Token = { ticker: string; mint: string };
type Pool = { pool: string; dex: string; liquidityUsd: number; volume24hUsd: number };

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
        else out[ticker] = { ...best, at: today };
      }
    } catch (e) {
      console.error(`batch at ${i}: ${e instanceof Error ? e.message : e}`);
    }
    checked += batch.length;
    // Written as we go, so a run that is interrupted still leaves what it found.
    save();
    console.log(`${checked}/${entries.length} checked, ${Object.keys(out).length} pinned`);
    await sleep(GAP_MS);
  }

  save();
  console.log(
    `\n${Object.keys(out).length} stocks can settle around the clock` +
      ` (${tooThin} pools too thin, ${none} with no pool at all, of ${byTicker.size})`,
  );
  console.log(`written to ${path.relative(ROOT, file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
