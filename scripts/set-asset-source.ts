/* Re-point registered stocks at a price source for NEW fights.
 *
 *   DEVNET=1 npx tsx scripts/set-asset-source.ts signed TSLA QQQ
 *   DEVNET=1 npx tsx scripts/set-asset-source.ts pyth TSLA QQQ      # undo
 *
 * The program's set_asset keeps the asset's feed id and enabled flag and
 * changes only its source. Duels already created keep the source they copied,
 * so a fight in flight is priced exactly as it was. Signed by the config admin
 * (WALLET, default ~/.config/solana/id.json). Devnet only: it refuses any RPC
 * that is not devnet. */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { assetPda, coder, configPda, PROGRAM_ID, SOURCE_PYTH, SOURCE_SIGNED } from "../src/lib/duel";
import { stakeAssetFor } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
if (!(process.env.DEVNET === "1" && /devnet/.test(RPC))) throw new Error("set-asset-source runs against devnet with DEVNET=1");

const [which, ...tickers] = process.argv.slice(2);
const source = which === "signed" ? SOURCE_SIGNED : which === "pyth" ? SOURCE_PYTH : null;
if (source === null || tickers.length === 0) throw new Error("usage: set-asset-source.ts signed|pyth TICKER...");

const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));
const admin = load(process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));
const conn = new Connection(RPC, "confirmed");

type Asset = { mint: PublicKey; symbol: string; source: number; enabled: boolean; feed_id: number[] };
const readAsset = async (pda: PublicKey) => {
  const info = await conn.getAccountInfo(pda, "confirmed");
  return info ? (coder.accounts.decode("Asset", info.data) as Asset) : null;
};
const words = (s: number) => (s === SOURCE_PYTH ? "pyth" : s === SOURCE_SIGNED ? "signed" : `source ${s}`);

async function main() {
  const config = coder.accounts.decode("Config", (await conn.getAccountInfo(configPda()))!.data) as { admin: PublicKey };
  if (!new PublicKey(config.admin).equals(admin.publicKey)) {
    throw new Error(`this wallet ${admin.publicKey.toBase58()} is not the config admin ${new PublicKey(config.admin).toBase58()}`);
  }
  for (const ticker of tickers) {
    const stake = stakeAssetFor(ticker);
    if (!stake) throw new Error(`${ticker} has no token on this cluster`);
    const pda = assetPda(stake.mint);
    const before = await readAsset(pda);
    if (!before) throw new Error(`${ticker} is not registered`);
    if (before.source === source) {
      console.log(`${ticker}: already ${words(source)}`);
      continue;
    }
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda(), isSigner: false, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      data: coder.instruction.encode("set_asset", { feed_id: before.feed_id, enabled: before.enabled, source }),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(admin);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    const after = await readAsset(pda);
    console.log(`${ticker}: ${words(before.source)} -> ${words(after!.source)} (enabled ${after!.enabled}) ${sig}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
