/* Would the real tokens pass the escrow screen? Read every mainnet mint the
 * roster lists (src/data/stocks.mainnet-beta.json: xStocks, Ondo, Backpack),
 * list their Token-2022 extensions, and apply the same test as
 * programs/duel/src/mint_check.rs.
 *
 *   RPC=https://api.mainnet-beta.solana.com npx tsx scripts/xstocks-probe.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";

import mainnet from "../src/data/stocks.mainnet-beta.json";

const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type Token = { ticker: string; symbol: string; issuer: string; mint: string };

function extensions(data: Buffer): { kind: number; value: Buffer }[] {
  if (data.length <= 82) return [];
  const out: { kind: number; value: Buffer }[] = [];
  let at = 166;
  while (at + 4 <= data.length) {
    const kind = data.readUInt16LE(at);
    const len = data.readUInt16LE(at + 2);
    if (kind === 0) break;
    out.push({ kind, value: data.subarray(at + 4, at + 4 + len) });
    at += 4 + len;
  }
  return out;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const tokens = (mainnet as { tokens: Token[] }).tokens;
  const tally = new Map<string, { pass: number; refused: string[]; multipliers: number[] }>();
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(batch.map((t) => new PublicKey(t.mint)));
    batch.forEach((t, j) => {
      const row = tally.get(t.issuer) ?? { pass: 0, refused: [], multipliers: [] };
      tally.set(t.issuer, row);
      const info = infos[j];
      if (!info) return row.refused.push(`${t.symbol}: missing`);
      const exts = info.owner.toBase58() === TOKEN_2022 ? extensions(info.data) : [];
      const hook = exts.find((e) => e.kind === 14);
      const liveHook = hook ? !hook.value.subarray(32, 64).every((b) => b === 0) : false;
      const nonTransferable = exts.some((e) => e.kind === 9);
      // DefaultAccountState: one byte, 1 = Initialized, 2 = Frozen.
      const frozenByDefault = exts.find((e) => e.kind === 6)?.value[0] === 2;
      const fee = exts.some((e) => e.kind === 1);
      // ScaledUiAmount: authority(32) multiplier(f64) ...
      const sua = exts.find((e) => e.kind === 25)?.value;
      if (sua && sua.length >= 40) row.multipliers.push(sua.readDoubleLE(32));
      const why = [liveHook && "live transfer hook", nonTransferable && "non-transferable", frozenByDefault && "frozen by default", fee && "transfer fee"].filter(Boolean);
      if (why.length) row.refused.push(`${t.symbol}: ${why.join(", ")}`);
      else row.pass++;
    });
  }
  let pass = 0;
  for (const [issuer, row] of tally) {
    pass += row.pass;
    const m = row.multipliers;
    const range = m.length ? ` · scaled-amount multiplier ${Math.min(...m).toFixed(4)} to ${Math.max(...m).toFixed(4)}` : "";
    console.log(`${issuer.padEnd(10)} ${row.pass} pass, ${row.refused.length} refused${range}`);
    for (const r of row.refused.slice(0, 10)) console.log(`  ${r}`);
  }
  console.log(`${pass}/${tokens.length} pass the escrow screen`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
