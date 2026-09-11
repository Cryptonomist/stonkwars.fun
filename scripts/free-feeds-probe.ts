/* Which US stock and ETF feeds does this Pyth plan grant?
 *
 *   npx tsx scripts/free-feeds-probe.ts          # popular names
 *   ALL=1 npx tsx scripts/free-feeds-probe.ts    # every Equity.US feed
 *
 * One latest-price request per feed, a few at a time, so a 403 names exactly
 * the feed it refuses. Prints the granted ones with their feed ids. */

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

const POPULAR = `AAPL MSFT NVDA AMZN GOOGL GOOG META TSLA AVGO JPM LLY V UNH XOM MA JNJ PG HD COST ORCL MRK ABBV
CVX KO PEP BAC NFLX AMD ADBE CRM TMO WMT MCD CSCO ACN INTC QCOM DIS IBM UBER PYPL SHOP XYZ SQ PLTR COIN
HOOD MSTR GME AMC RIVN LCID NIO BABA SNAP SPOT ARM SMCI MU TSM ASML CRCL CRWV MARA RIOT SOFI RBLX DKNG
ABNB DASH SNOW NET CRWD PANW ZS DDOG MDB OKTA TWLO U PINS ROKU F GM BA CAT GE DE LMT NKE SBUX TGT LOW
SPY QQQ IWM DIA VOO VTI GLD SLV TLT ARKK SOXL TQQQ SQQQ IBIT ETHA XLK XLF XLE SMH`
  .split(/\s+/)
  .filter(Boolean);

async function granted(id: string): Promise<{ ok: boolean; price?: number }> {
  try {
    const u = await hermes.getLatestPriceUpdates([id], { parsed: true });
    const p = u.parsed?.[0];
    return { ok: true, price: p ? Number(p.price.price) * 10 ** p.price.expo : undefined };
  } catch {
    return { ok: false };
  }
}

async function main() {
  const feeds = (await hermes.getPriceFeeds({ assetType: "equity" })).filter((f) =>
    /^Equity\.US\.[A-Z.]+\/USD$/.test(String(f.attributes.symbol ?? "")),
  );
  const wanted = process.env.ALL
    ? feeds
    : feeds.filter((f) => POPULAR.includes(String(f.attributes.symbol).slice("Equity.US.".length, -"/USD".length)));
  console.log(`probing ${wanted.length} of ${feeds.length} Equity.US feeds`);

  const hits: string[] = [];
  const queue = [...wanted];
  const workers = Array.from({ length: 4 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const r = await granted(f.id);
      if (r.ok) hits.push(`${String(f.attributes.symbol).padEnd(22)} ${r.price?.toFixed(2).padStart(10)}  ${f.id}`);
    }
  });
  await Promise.all(workers);
  console.log(`\nGRANTED on this plan: ${hits.length}`);
  for (const h of hits.sort()) console.log("  " + h);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
