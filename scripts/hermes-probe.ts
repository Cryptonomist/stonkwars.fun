/* Does Hermes serve the one price the program will accept?
 *
 * The program takes, for a boundary T, only the update with
 * prev_publish_time < T <= publish_time. That is only settleable if Hermes,
 * asked for T, returns exactly that update. This asks, for a handful of
 * equity feeds and a few T in the recent past, and says whether it did.
 *
 *   npx tsx scripts/hermes-probe.ts
 */

import fs from "fs";
import path from "path";
import { HermesClient } from "@pythnetwork/hermes-client";

// The key lives in .env.local (never in the repo); Hermes refuses without it.
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
const SYMBOLS = ["NVDA", "TSLA", "AAPL", "SPY", "QQQ", "MSFT", "GOOGL", "AMZN", "META", "COIN", "MSTR", "HOOD", "PLTR", "AMD"];

async function main() {
  const feeds = await hermes.getPriceFeeds({ assetType: "equity" });
  const wanted = new Map<string, { id: string; symbol: string }>();
  for (const f of feeds) {
    const sym = String(f.attributes.symbol ?? "");
    for (const s of SYMBOLS) {
      if (sym === `Equity.US.${s}/USD`) wanted.set(s, { id: f.id, symbol: sym });
    }
  }
  console.log("equity feeds in Hermes:", feeds.length);
  const sessionish = feeds
    .map((f) => String(f.attributes.symbol ?? ""))
    .filter((s) => s.startsWith("Equity.US.NVDA"));
  console.log("NVDA variants:", sessionish.join(", "));
  for (const s of SYMBOLS) console.log(s.padEnd(6), wanted.get(s)?.id ?? "MISSING");

  const ids = [...wanted.values()].slice(0, 3).map((w) => w.id);
  const latest = await hermes.getLatestPriceUpdates(ids, { parsed: true });
  for (const p of latest.parsed ?? []) {
    console.log(
      "latest",
      p.id.slice(0, 8),
      "price",
      p.price.price,
      "expo",
      p.price.expo,
      "publish",
      new Date(p.price.publish_time * 1000).toISOString(),
      "prev",
      p.metadata?.prev_publish_time,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  for (const back of [30, 300, 3600]) {
    const t = now - back;
    try {
      const u = await hermes.getPriceUpdatesAtTimestamp(t, ids, { parsed: true });
      for (const p of u.parsed ?? []) {
        const pub = p.price.publish_time;
        const prev = p.metadata?.prev_publish_time ?? NaN;
        const ok = prev < t && t <= pub;
        console.log(
          `T-${back}s`.padEnd(8),
          p.id.slice(0, 8),
          "publish-T",
          pub - t,
          "prev-T",
          prev - t,
          ok ? "UNIQUE-FIRST ok" : "NOT the first",
        );
      }
      console.log("   binary updates:", u.binary.data.length, "bytes each ~", u.binary.data[0]?.length);
    } catch (e: any) {
      console.log(`T-${back}s`, "error", e?.message ?? e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
