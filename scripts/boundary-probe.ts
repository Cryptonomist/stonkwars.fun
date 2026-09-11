/* Does Hermes hand back the one price the program accepts?
 *
 *   npx tsx scripts/boundary-probe.ts [feedHex ...]
 *
 * For a few boundaries T in the recent past, asks Hermes for the update at T
 * and checks prev_publish_time < T <= publish_time for every feed: the rule
 * start_duel and settle_duel enforce. Defaults to TSLA and QQQ, the two US
 * equity feeds the free Pyth plan grants. */

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

const FEEDS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", // TSLA
      "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d", // QQQ
    ];

async function main() {
  const now = Math.floor(Date.now() / 1000);
  let ok = 0;
  let total = 0;
  for (const back of [5, 20, 60, 300, 1800]) {
    const t = now - back;
    try {
      const u = await hermes.getPriceUpdatesAtTimestamp(t, FEEDS, { encoding: "base64", parsed: true });
      const parts: string[] = [];
      for (const p of u.parsed ?? []) {
        total++;
        const prev = p.metadata?.prev_publish_time;
        const first = typeof prev === "number" && prev < t && t <= p.price.publish_time;
        if (first) ok++;
        parts.push(
          `${p.id.slice(0, 6)} ${Number(p.price.price) * 10 ** p.price.expo} pub-T=${p.price.publish_time - t} prev-T=${typeof prev === "number" ? prev - t : "?"} ${first ? "FIRST" : "NOT-FIRST"}`,
        );
      }
      console.log(`T-${back}s`.padEnd(8), `${u.binary.data.length} update blob(s)`, "|", parts.join(" | "));
    } catch (e) {
      console.log(`T-${back}s`.padEnd(8), "error", (e instanceof Error ? e.message : String(e)).slice(0, 160));
    }
  }
  console.log(`${ok}/${total} observations were the unique first price at or after T`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
