/* Set the platform fee, and open the treasury's token accounts it is paid into.
 *
 *   DEVNET=1 npx tsx scripts/set-fee.ts 0 <TREASURY>                 # fee off, treasury named
 *   DEVNET=1 npx tsx scripts/set-fee.ts 250 <TREASURY> --accounts    # 2.5%, from a week from now
 *   DEVNET=1 npx tsx scripts/set-fee.ts show
 *
 * The program caps the fee at 5% (500 bps). A raise reaches only duels created a
 * week after it is set; a cut reaches every duel at once (programs/duel/src/fee.rs).
 * `--accounts` opens the treasury's associated token account for every stock
 * that can be staked, which the fee needs: a settlement whose treasury account
 * is missing pays the winner in full instead.
 *
 * Signed by the config admin (WALLET, default ~/.config/solana/id.json). Devnet
 * with DEVNET=1. On mainnet it runs only with MAINNET=1 and CONFIRM_FEE set to
 * the same number of basis points, and should be run by the person who holds
 * the admin key, never by an assistant. */

import fs from "fs";
import os from "os";
import path from "path";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

import {
  ataFor,
  buildSetFee,
  coder,
  configPda,
  decodeFeeConfig,
  feeConfigPda,
  feeRateFor,
  MAX_FEE_BPS,
} from "../src/lib/duel";
import { STAKEABLE, tokensFor } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const devnet = process.env.DEVNET === "1" && /devnet/.test(RPC);
const mainnet = process.env.MAINNET === "1" && /mainnet/.test(RPC);
if (!devnet && !mainnet) throw new Error("set-fee runs with DEVNET=1 (devnet RPC) or MAINNET=1 (mainnet RPC)");

const args = process.argv.slice(2);
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const when = (ts: number) => (ts ? new Date(ts * 1000).toISOString().replace(".000Z", "Z") : "always");

async function show(label: string) {
  const info = await conn.getAccountInfo(feeConfigPda(), "confirmed");
  if (!info) {
    console.log(`${label}: no fee config (no fee)`);
    return;
  }
  const f = decodeFeeConfig(info.data);
  const now = Math.floor(Date.now() / 1000);
  console.log(
    `${label}: treasury ${f.treasury.toBase58()}, ${pct(f.feeBps)} for duels created from ${when(f.fromTs)}, ` +
      `at most ${pct(Math.min(f.feeBps, f.priorBps))} before that; a duel created now pays ${pct(feeRateFor(f, now))}`,
  );
}

async function send(ixs: TransactionInstruction[], admin: Keypair) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(admin);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  if (args[0] === "show") return show("fee");

  const bps = Number(args[0]);
  const treasury = new PublicKey(args[1] ?? "");
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) throw new Error(`fee must be 0..${MAX_FEE_BPS} bps`);
  if (mainnet && process.env.CONFIRM_FEE !== String(bps)) throw new Error("on mainnet, set CONFIRM_FEE to the same bps");

  const admin = load(process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));
  const config = coder.accounts.decode("Config", (await conn.getAccountInfo(configPda()))!.data) as { admin: PublicKey };
  if (!new PublicKey(config.admin).equals(admin.publicKey)) {
    throw new Error(`this wallet ${admin.publicKey.toBase58()} is not the config admin ${new PublicKey(config.admin).toBase58()}`);
  }

  await show("before");
  console.log(`set_fee ${bps} bps, treasury ${treasury.toBase58()}: ${await send([buildSetFee(admin.publicKey, bps, treasury)], admin)}`);
  await show("after");

  if (args.includes("--accounts")) {
    const ixs = STAKEABLE.map((stock) => {
      const t = tokensFor(stock.ticker)[0];
      const mint = new PublicKey(t.mint);
      const program = new PublicKey(t.tokenProgram);
      return createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ataFor(treasury, mint, program), treasury, mint, program);
    });
    for (let i = 0; i < ixs.length; i += 8) {
      console.log(`treasury accounts ${i + 1}..${Math.min(i + 8, ixs.length)} of ${ixs.length}: ${await send(ixs.slice(i, i + 8), admin)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
