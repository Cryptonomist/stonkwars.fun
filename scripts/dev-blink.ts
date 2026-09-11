/* LOCAL VALIDATOR ONLY: open a fight, then take it through the Blink.
 *
 *   RPC=http://127.0.0.1:8899 SITE=http://localhost:3000 npx tsx scripts/dev-blink.ts
 *
 * Wallet A opens NVDA vs AAPL; wallet B asks the Action endpoint for a
 * transaction, exactly as a Blink client would, signs it and sends it. Proves
 * the POST hands back a transaction a wallet can sign and the program accepts. */

import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmRawTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { buildCreateDuel, decodeDuel, randomSeed, STATUS_ACCEPTED } from "../src/lib/duel";
import stocks from "../src/data/stocks.localnet.json";
import { stakeAssetFor } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const SITE = process.env.SITE ?? "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("dev-blink only runs against a local validator");

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const faucet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../keys/faucet-localnet.json"), "utf8"))),
  );
  const nvda = stakeAssetFor("NVDA")!;
  const aapl = stakeAssetFor("AAPL")!;
  void stocks;

  async function fund(kp: Keypair, asset: typeof nvda, amount: bigint) {
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
    const ata = getAssociatedTokenAddressSync(asset.mint, kp.publicKey, false, asset.tokenProgram);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ata, kp.publicKey, asset.mint, asset.tokenProgram),
        createMintToInstruction(asset.mint, ata, faucet.publicKey, amount, [], asset.tokenProgram),
      ),
      [kp, faucet],
    );
  }

  const a = Keypair.generate();
  const b = Keypair.generate();
  await fund(a, nvda, BigInt(100_000_000));
  await fund(b, aapl, BigInt(100_000_000));

  const now = Math.floor(Date.now() / 1000);
  const { instruction, duel } = buildCreateDuel({
    creator: a.publicKey,
    seed: randomSeed(),
    creatorAsset: nvda,
    opponentAsset: aapl,
    creatorAmount: BigInt(11_800_000),
    opponentAmount: BigInt(8_200_000),
    durationSecs: 300,
    endTs: 0,
    expiresTs: now + 3_600,
    taunt: "Taken from a Blink.",
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(instruction), [a]);
  console.log(`opened ${duel.toBase58()}`);

  const get = await (await fetch(`${SITE}/api/actions/fight/${duel.toBase58()}`)).json();
  console.log(`GET: ${get.title} · ${get.label} · disabled=${get.disabled}`);

  const res = await fetch(`${SITE}/api/actions/fight/${duel.toBase58()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: b.publicKey.toBase58() }),
  });
  const post = (await res.json()) as { transaction?: string; message?: string };
  if (!res.ok || !post.transaction) throw new Error(`POST failed: ${post.message}`);
  const tx = Transaction.from(Buffer.from(post.transaction, "base64"));
  tx.sign(b);
  const sig = await sendAndConfirmRawTransaction(conn, tx.serialize(), { commitment: "confirmed" });
  const state = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
  console.log(`POST -> signed -> ${sig.slice(0, 16)}...; status ${state.status === STATUS_ACCEPTED ? "ACCEPTED" : state.status}`);
  console.log(`message: ${post.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
