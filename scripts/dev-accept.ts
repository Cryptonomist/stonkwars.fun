/* LOCAL VALIDATOR ONLY: play "the friend". Takes a fight from a fresh wallet.
 *
 *   RPC=http://127.0.0.1:8899 npx tsx scripts/dev-accept.ts <duel address>
 *
 * Makes a keypair, airdrops it SOL, mints it the opponent's stock with the
 * local faucet key (the test mints' authority), and accepts. */

import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { buildAcceptDuel, decodeDuel } from "../src/lib/duel";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("dev-accept only runs against a local validator");

async function main() {
  const address = new PublicKey(process.argv[2] ?? "");
  const conn = new Connection(RPC, "confirmed");
  const faucet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../keys/faucet-localnet.json"), "utf8"))),
  );
  const info = await conn.getAccountInfo(address);
  if (!info) throw new Error("No such duel");
  const d = decodeDuel(address, info.data);

  const friend = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(friend.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  const ata = getAssociatedTokenAddressSync(d.opponentMint, friend.publicKey, false, d.opponentTokenProgram);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(friend.publicKey, ata, friend.publicKey, d.opponentMint, d.opponentTokenProgram),
      createMintToInstruction(d.opponentMint, ata, faucet.publicKey, d.opponentAmount * BigInt(3), [], d.opponentTokenProgram),
    ),
    [friend, faucet],
  );
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(buildAcceptDuel(d, friend.publicKey)), [friend]);
  console.log(`accepted by ${friend.publicKey.toBase58()}: ${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
