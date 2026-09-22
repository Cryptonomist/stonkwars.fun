/* WHAT DOES A FIGHT ACTUALLY COST IN FEES?
 *
 *   npx tsx scripts/fight-fees.ts <duel address>
 *
 * The pitch video says fees are less than a ten-thousandth of a SOL. That is
 * a checkable number and a judge can check it, so it gets checked here: every
 * transaction that touched the fight account, who paid it, and what it cost.
 *
 * Fees and rent are different things and the distinction matters. A fee is
 * spent. Rent on a token account is a deposit that comes back when the
 * account closes. A wallet's balance falls by both, so anyone comparing their
 * wallet to the claim needs to know which is which.
 *
 * Reads chain state. Sends nothing. */

import fs from "fs";
import path from "path";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const duel = new PublicKey(process.argv[2]);

  const sigs = await conn.getSignaturesForAddress(duel, { limit: 25 }, "confirmed");
  console.log(`transactions touching ${duel.toBase58().slice(0, 8)}: ${sigs.length}`);
  console.log("");

  let total = 0;
  const byPayer = new Map<string, number>();
  for (const s of [...sigs].reverse()) {
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) continue;
    const fee = tx.meta.fee;
    total += fee;
    const payer = tx.transaction.message.getAccountKeys().get(0)!.toBase58();
    byPayer.set(payer, (byPayer.get(payer) ?? 0) + fee);
    console.log(`  ${(fee / LAMPORTS_PER_SOL).toFixed(9)} SOL  paid by ${payer.slice(0, 8)}  ${s.signature.slice(0, 12)}`);
  }

  console.log("");
  console.log(`TOTAL FEES on this fight: ${(total / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  console.log("");
  console.log("by payer:");
  for (const [p, f] of [...byPayer].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.slice(0, 8)}  ${(f / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  }

  const tenThousandth = LAMPORTS_PER_SOL / 10_000;
  console.log("");
  console.log(`a ten-thousandth of a SOL is ${(tenThousandth / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  console.log(
    total < tenThousandth
      ? `CLAIM HOLDS: total fees are below it`
      : `CLAIM FAILS: total fees are ABOVE it`,
  );
  const biggest = Math.max(...byPayer.values());
  console.log(
    biggest < tenThousandth
      ? `and no single wallet paid more than a ten-thousandth either`
      : `but one wallet paid more than a ten-thousandth on its own`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
