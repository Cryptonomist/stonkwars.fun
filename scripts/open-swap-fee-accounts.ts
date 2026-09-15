/* Open the treasury's mainnet token accounts, so the swap fee can be paid.
 *
 * Jupiter pays a swap fee only into a token account the treasury already has
 * for the token the user receives: USDC and SOL on a sell, the stock's token
 * on a buy. Until one exists, swaps into that token go through with no fee
 * (the trade panel's quote says "no-account").
 *
 *   MAINNET=1 SWAP_FEE_OWNER=<treasury> WALLET=<payer.json> npx tsx scripts/open-swap-fee-accounts.ts
 *       prints what it would open and what it costs, and sends nothing
 *   ... --send                       opens them
 *   ... --tickers TSLA,NVDA,AMZN     just these stocks (default: every stock that fights 24/7)
 *   ... --all                        every stock with a mainnet token (over a thousand; costs real SOL)
 *
 * Each account holds about 0.00204 SOL of rent, paid by WALLET, which can be
 * any wallet; the accounts belong to SWAP_FEE_OWNER. Opening one that exists
 * is skipped, so it is safe to run again. This spends real SOL: run it
 * yourself, from a wallet you control. */

import fs from "fs";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";

import mainnetTokens from "../src/data/stocks.mainnet-beta.json";
import { ataFor } from "../src/lib/duel";
import { ROSTER, tradesAroundTheClock } from "../src/lib/stocks";
import { PAY } from "../src/lib/swap";
import { mainnetStockToken } from "../src/lib/swapPairs";

const RENT_SOL = 0.00203928;
const PER_TX = 6;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};

async function main() {
  if (process.env.MAINNET !== "1") throw new Error("This opens accounts on mainnet: run with MAINNET=1");
  const owner = new PublicKey(process.env.SWAP_FEE_OWNER ?? "");
  const rpc = process.env.RPC ?? process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");

  const tickers = args.includes("--all")
    ? [...new Set((mainnetTokens as { tokens: { ticker: string }[] }).tokens.map((t) => t.ticker))]
    : flag("--tickers")
      ? flag("--tickers")!.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
      : ROSTER.map((s) => s.ticker).filter((t) => tradesAroundTheClock(t));

  const wanted = [
    { label: "USDC", mint: PAY.USDC.mint, program: PAY.USDC.tokenProgram },
    { label: "SOL (wrapped)", mint: PAY.SOL.mint, program: PAY.SOL.tokenProgram },
    ...tickers.flatMap((t) => {
      const tok = mainnetStockToken(t);
      return tok ? [{ label: tok.symbol, mint: tok.mint, program: tok.tokenProgram }] : [];
    }),
  ].map((w) => ({ ...w, ata: ataFor(owner, new PublicKey(w.mint), new PublicKey(w.program)) }));

  const missing: typeof wanted = [];
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(batch.map((w) => w.ata), "confirmed");
    batch.forEach((w, j) => {
      if (!infos[j]) missing.push(w);
    });
  }

  console.log(`treasury ${owner.toBase58()}: ${wanted.length - missing.length} of ${wanted.length} accounts already open`);
  for (const m of missing) console.log(`  to open: ${m.label.padEnd(14)} ${m.ata.toBase58()}`);
  const cost = missing.length * RENT_SOL;
  console.log(`${missing.length} to open, about ${cost.toFixed(4)} SOL of rent (plus network fees)`);
  if (!missing.length || !args.includes("--send")) {
    if (missing.length) console.log("nothing sent. Add --send to open them.");
    return;
  }

  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.WALLET ?? "", "utf8")) as number[]));
  const balance = (await conn.getBalance(payer.publicKey, "confirmed")) / LAMPORTS_PER_SOL;
  if (balance < cost + 0.01) throw new Error(`payer ${payer.publicKey.toBase58()} has ${balance} SOL; needs about ${(cost + 0.01).toFixed(4)}`);

  for (let i = 0; i < missing.length; i += PER_TX) {
    const part = missing.slice(i, i + PER_TX);
    const tx = new Transaction().add(
      ...part.map((m) =>
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, m.ata, owner, new PublicKey(m.mint), new PublicKey(m.program)),
      ),
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`opened ${part.map((p) => p.label).join(", ")}: ${sig}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
