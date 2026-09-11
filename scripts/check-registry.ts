/* What is actually registered on a cluster: every Asset account the program
 * owns, checked against the roster and the cluster's token list.
 *
 *   RPC=https://api.devnet.solana.com npx tsx scripts/check-registry.ts */

import { Connection, PublicKey } from "@solana/web3.js";

import { assetPda, coder, configPda, PROGRAM_ID, SOURCE_PYTH } from "../src/lib/duel";
import { ROSTER, TOKENS } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Asset = { mint: PublicKey; symbol: string; source: number; enabled: boolean; feed_id: number[] };

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const config = await conn.getAccountInfo(configPda());
  if (!config) throw new Error("no config on this cluster");
  const c = coder.accounts.decode("Config", config.data) as { admin: PublicKey; oracle: PublicKey; paused: boolean };
  console.log(`admin  ${new PublicKey(c.admin).toBase58()}`);
  console.log(`oracle ${new PublicKey(c.oracle).toBase58()}`);
  console.log(`paused ${c.paused}`);
  console.log(`roster ${ROSTER.length} stocks · token list ${TOKENS.length} mints`);

  const missing: string[] = [];
  const wrong: string[] = [];
  let pyth = 0;
  for (let i = 0; i < TOKENS.length; i += 100) {
    const batch = TOKENS.slice(i, i + 100);
    let infos;
    for (let attempt = 0; ; attempt++) {
      try {
        infos = await conn.getMultipleAccountsInfo(batch.map((t) => assetPda(new PublicKey(t.mint))));
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        await sleep(1_500 * (attempt + 1));
      }
    }
    batch.forEach((t, j) => {
      const info = infos![j];
      if (!info) return missing.push(t.ticker);
      const a = coder.accounts.decode("Asset", info.data) as Asset;
      const stock = ROSTER.find((s) => s.ticker === t.ticker)!;
      const feed = Buffer.from(a.feed_id).toString("hex");
      const source = stock.source === "pyth" ? SOURCE_PYTH : 1;
      if (feed !== stock.feed || a.source !== source || !a.enabled) {
        wrong.push(`${t.ticker}: feed ${feed.slice(0, 8)} source ${a.source} enabled ${a.enabled}`);
      }
      if (a.source === SOURCE_PYTH) pyth++;
    });
    await sleep(400);
  }
  console.log(`registered ${TOKENS.length - missing.length}/${TOKENS.length}; ${pyth} priced by Pyth`);
  if (missing.length) console.log(`missing (${missing.length}): ${missing.slice(0, 20).join(" ")}`);
  if (wrong.length) console.log(`wrong (${wrong.length}):\n  ${wrong.slice(0, 10).join("\n  ")}`);
  if (!missing.length && !wrong.length) console.log("every stock in the list is registered, enabled, with its feed and source");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
