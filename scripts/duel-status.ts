/* What state is a fight in, and what prices does it hold?
 *
 *   RPC=https://api.devnet.solana.com npx tsx scripts/duel-status.ts <address> [--watch]
 *
 * Reads the chain and nothing else, so it says what happened rather than what
 * anything intended. Useful for watching a settler that is not yours do its
 * job: start this, touch nothing, and see whether the fight moves on. */

import { Connection, PublicKey } from "@solana/web3.js";

import { decodeDuel, STATUS_REFUNDED, STATUS_SETTLED } from "../src/lib/duel";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const NAMES = ["open", "accepted", "LIVE", "SETTLED", "void", "refunded"];
const px = (p: { price: bigint; expo: number }) => Number(p.price) * 10 ** p.expo;

async function main() {
  const address = new PublicKey(process.argv[2] ?? "");
  const watch = process.argv.includes("--watch");
  const conn = new Connection(RPC, "confirmed");

  for (;;) {
    const info = await conn.getAccountInfo(address);
    if (!info) {
      console.log("no such fight (cancelled and closed?)");
      return;
    }
    const d = decodeDuel(address, info.data);
    const done = d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED;
    console.log(
      [
        new Date().toISOString().slice(11, 19),
        (NAMES[d.status] ?? String(d.status)).padEnd(8),
        `start ${px(d.creatorStart).toFixed(2)} v ${px(d.opponentStart).toFixed(2)}`,
        `end ${px(d.creatorEnd).toFixed(2)} v ${px(d.opponentEnd).toFixed(2)}`,
        done ? `outcome ${d.outcome}` : "",
      ].join("  "),
    );
    if (done || !watch) return;
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
