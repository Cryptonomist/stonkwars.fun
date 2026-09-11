/* Which Pyth feeds does this API key's plan actually grant?
 *
 *   npx tsx scripts/entitlement-probe.ts
 *
 * Tries a latest-price request per candidate feed and reports granted or the
 * reason it is not. Also lists every feed whose symbol mentions a roster
 * ticker, across all asset types, to find tokenized-stock feeds (NVDAX and the
 * like) that may sit under a different grant than US equities. */

import fs from "fs";
import path from "path";
import { HermesClient } from "@pythnetwork/hermes-client";

const envFile = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const hermes = new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
  accessToken: process.env.PYTH_API_KEY,
});

const TICKERS = ["NVDA", "TSLA", "AAPL", "SPY", "QQQ", "MSFT", "GOOGL", "AMZN", "META", "COIN", "MSTR", "HOOD", "PLTR", "AMD"];

async function tryLatest(id: string): Promise<string> {
  try {
    const u = await hermes.getLatestPriceUpdates([id], { parsed: true });
    const p = u.parsed?.[0];
    return p ? `GRANTED price=${Number(p.price.price) * 10 ** p.price.expo} at ${new Date(p.price.publish_time * 1000).toISOString()}` : "GRANTED (empty)";
  } catch (e) {
    return `refused: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 160)}`;
  }
}

async function main() {
  const all = await hermes.getPriceFeeds({});
  console.log("feeds listed:", all.length);
  const types = new Map<string, number>();
  for (const f of all) types.set(String(f.attributes.asset_type), (types.get(String(f.attributes.asset_type)) ?? 0) + 1);
  console.log("asset types:", [...types.entries()].map(([k, v]) => `${k}:${v}`).join(" "));

  // Every feed mentioning a roster ticker, whatever its asset type.
  const related = all.filter((f) => {
    const s = String(f.attributes.symbol ?? "").toUpperCase();
    return TICKERS.some((t) => new RegExp(`[./]${t}X?([./]|$)`).test(s) || s.includes(`${t}X`));
  });
  console.log(`\nfeeds mentioning roster tickers: ${related.length}`);
  for (const f of related.slice(0, 80)) {
    console.log(`  ${String(f.attributes.asset_type).padEnd(10)} ${String(f.attributes.symbol).padEnd(34)} ${f.id}`);
  }

  console.log("\nentitlement checks:");
  const sol = all.find((f) => f.attributes.symbol === "Crypto.SOL/USD");
  if (sol) console.log("  Crypto.SOL/USD".padEnd(36), await tryLatest(sol.id));
  const seen = new Set<string>();
  for (const f of related) {
    const type = String(f.attributes.asset_type);
    const key = `${type}`;
    // One probe per asset type is enough to learn the grant, plus a few more.
    if (seen.has(key) && seen.size > 6) continue;
    seen.add(key);
    console.log(`  ${String(f.attributes.symbol).padEnd(34)}`, await tryLatest(f.id));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
