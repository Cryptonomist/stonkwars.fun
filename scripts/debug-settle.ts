/* LOCAL VALIDATOR ONLY: run one fight's start or settle the way the crank
 * does, but send the transactions one at a time with preflight on, so the one
 * that fails says why (the batch sender hides it behind "Unknown action").
 *
 *   RPC=http://127.0.0.1:8899 DUEL=<address> WHICH=start|settle SYMBOL=ETH-USD \
 *     npx tsx scripts/debug-settle.ts */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { boundaryOf, crankTransactions, pythUpdateAt, signedQuotes } from "../src/lib/crank";
import { decodeDuel } from "../src/lib/duel";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));

async function main() {
  const rpc = process.env.RPC ?? "http://127.0.0.1:8899";
  if (!/localhost|127\.0\.0\.1/.test(rpc)) throw new Error("local validator only: this sends real transactions");
  const conn = new Connection(rpc, "confirmed");
  const payer = load(path.join(os.homedir(), ".config/solana/id.json"));
  const oracle = load(path.join(ROOT, "keys/oracle-localnet.json"));
  const which = (process.env.WHICH ?? "settle") as "start" | "settle";
  const address = new PublicKey(process.env.DUEL!);
  const d = decodeDuel(address, (await conn.getAccountInfo(address))!.data);
  const hermes = new HermesClient(process.env.HERMES_URL!, { accessToken: process.env.PYTH_API_KEY });
  const boundary = boundaryOf(d, which);
  const quotes = await signedQuotes({
    duel: d,
    boundary,
    oracle,
    quoteSymbol: () => ({ symbol: process.env.SYMBOL ?? "ETH-USD", currency: process.env.CURRENCY ?? "USD" }),
  });
  const pythUpdate = await pythUpdateAt(hermes, d, boundary);
  const receiver = new PythSolanaReceiver({ connection: conn, wallet: new Wallet(payer) });
  const txs = await crankTransactions({ conn, receiver, payer: payer.publicKey, duel: d, which, pythUpdate, quotes });

  for (const [i, { tx, signers }] of txs.entries()) {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    tx.message.recentBlockhash = blockhash;
    tx.sign([payer, ...(signers as Keypair[])]);
    const keys = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex].toBase58().slice(0, 6));
    try {
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction(sig, "confirmed");
      console.log(`tx ${i} [${keys.join(" ")}] ${tx.serialize().length} bytes: ok ${sig.slice(0, 12)}`);
    } catch (e) {
      const logs = (e as { logs?: string[]; transactionLogs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs;
      console.log(`tx ${i} [${keys.join(" ")}] FAILED: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      if (logs) console.log(logs.slice(-15).join("\n"));
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
