/* LOCAL VALIDATOR ONLY: a live fight to look at, in one command.
 *
 *   RPC=http://127.0.0.1:8899 npx tsx scripts/dev-fight.ts NVDA TSLA [seconds]
 *
 * Makes two funded wallets, mints each the stock it is backing with the local
 * faucet key, creates the challenge and takes it. Prints the fight's URL. The
 * dev crank does the rest; nothing here decides anything. */

import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { buildAcceptDuel, buildCreateDuel, decodeDuel, randomSeed } from "../src/lib/duel";
import { tokensFor } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("dev-fight only runs against a local validator");

const ROOT = path.resolve(__dirname, "..");
const conn = new Connection(RPC, "confirmed");
const faucet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, "keys/faucet-localnet.json"), "utf8")) as number[]),
);
const send = (ixs: TransactionInstruction[], signers: Keypair[]) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });

const find = (ticker: string) => {
  const [t] = tokensFor(ticker.toUpperCase());
  if (!t) throw new Error(`${ticker} is not registered on this validator`);
  return { ticker: t.ticker, mint: new PublicKey(t.mint), tokenProgram: new PublicKey(t.tokenProgram) };
};

/** A wallet holding SOL for fees and 10 shares of the stock it is backing. */
async function wallet(asset: ReturnType<typeof find>) {
  const kp = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  const ata = getAssociatedTokenAddressSync(asset.mint, kp.publicKey, false, asset.tokenProgram);
  await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, kp.publicKey, asset.mint, asset.tokenProgram),
      createMintToInstruction(asset.mint, ata, faucet.publicKey, 10n * 10n ** 8n, [], asset.tokenProgram),
    ],
    [faucet],
  );
  return kp;
}

async function main() {
  const [a, b] = [find(process.argv[2] ?? "NVDA"), find(process.argv[3] ?? "TSLA")];
  const durationSecs = Number(process.argv[4] ?? 300);
  const [alice, bob] = [await wallet(a), await wallet(b)];

  const { instruction, duel } = buildCreateDuel({
    creator: alice.publicKey,
    seed: randomSeed(),
    creatorAsset: { mint: a.mint, tokenProgram: a.tokenProgram },
    opponentAsset: { mint: b.mint, tokenProgram: b.tokenProgram },
    creatorAmount: 100_000_000n,
    opponentAmount: 100_000_000n,
    durationSecs,
    endTs: 0,
    expiresTs: Math.floor(Date.now() / 1000) + 3_600,
    taunt: `${a.ticker} eats ${b.ticker} for breakfast`,
  });
  await send([instruction], [alice]);
  // OPEN=1 leaves the challenge for a person to take in the app.
  if (process.env.OPEN !== "1") {
    const open = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
    await send([buildAcceptDuel(open, bob.publicKey)], [bob]);
  }

  console.log(`${a.ticker} vs ${b.ticker}, ${durationSecs}s round${process.env.OPEN === "1" ? ", open" : ""}`);
  console.log(`http://localhost:3000/f/${duel.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
