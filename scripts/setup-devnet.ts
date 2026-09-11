/* One-time setup of a cluster for Stonk Wars: config, test stocks, registry.
 *
 *   RPC=https://api.devnet.solana.com FAUCET_SOL=2 npx tsx scripts/setup-devnet.ts
 *
 * Idempotent, so it can be re-run after a partial failure:
 *   1. init_config, signed by the deploy wallet, which becomes the admin;
 *   2. a faucet keypair (keys/faucet-<cluster>.json, gitignored), funded with
 *      FAUCET_SOL, which is the mint authority of every test stock;
 *   3. one Token-2022 mint per stock in the roster, 8 decimals, with its name
 *      and symbol written into the mint by the metadata extension so wallets
 *      show "NVDAx" rather than an address;
 *   4. register_asset for each, next to the stock's real Pyth feed id;
 *   5. src/data/stocks.<cluster>.json, which the app reads, and
 *      FAUCET_SECRET_KEY appended to .env.local if it is not there.
 *
 * THESE ARE TEST TOKENS. They stand in for tokenized shares on a test cluster
 * and are worth nothing. On mainnet the registry would point at an issuer's
 * mints and this script would not run.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  getMintLen,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";

import { assetPda, coder, configPda, PROGRAM_ID } from "../src/lib/duel";
import { ROSTER } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const CLUSTER = process.env.CLUSTER ?? (RPC.includes("localhost") || RPC.includes("127.0.0.1") ? "localnet" : "devnet");
const FAUCET_SOL = Number(process.env.FAUCET_SOL ?? "2");
const SITE = process.env.SITE ?? "https://stonkwars.fun";
const DECIMALS = 8;
const ROOT = path.resolve(__dirname, "..");

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]));
}

async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const admin = loadKeypair(process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));
  console.log(`cluster ${CLUSTER} · program ${PROGRAM_ID.toBase58()} · admin ${admin.publicKey.toBase58()}`);

  const program = await conn.getAccountInfo(PROGRAM_ID);
  if (!program?.executable) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC}`);

  // 1. Config
  const config = configPda();
  if (!(await conn.getAccountInfo(config))) {
    await send(
      conn,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: config, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: coder.instruction.encode("init_config", {}),
        }),
      ],
      [admin],
    );
    console.log("config initialised");
  } else {
    console.log("config exists");
  }

  // 2. Faucet key
  const keysDir = path.join(ROOT, "keys");
  fs.mkdirSync(keysDir, { recursive: true });
  const faucetFile = path.join(keysDir, `faucet-${CLUSTER}.json`);
  if (!fs.existsSync(faucetFile)) {
    fs.writeFileSync(faucetFile, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    console.log(`faucet key written to ${path.relative(ROOT, faucetFile)}`);
  }
  const faucet = loadKeypair(faucetFile);
  const faucetBalance = await conn.getBalance(faucet.publicKey);
  const want = FAUCET_SOL * LAMPORTS_PER_SOL;
  if (faucetBalance < want) {
    await send(
      conn,
      [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: faucet.publicKey, lamports: want - faucetBalance })],
      [admin],
    );
  }
  console.log(`faucet ${faucet.publicKey.toBase58()} holds ${((await conn.getBalance(faucet.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);

  // 3 + 4. Mints and registry
  const dataFile = path.join(ROOT, "src/data", `stocks.${CLUSTER}.json`);
  const existing = fs.existsSync(dataFile)
    ? (JSON.parse(fs.readFileSync(dataFile, "utf8")) as { mints: Record<string, string> })
    : { mints: {} as Record<string, string> };
  const mints: Record<string, string> = { ...existing.mints };

  for (const stock of ROSTER) {
    const symbol = `${stock.ticker}x`;
    let mint = mints[stock.ticker] ? new PublicKey(mints[stock.ticker]) : null;

    if (!mint || !(await conn.getAccountInfo(mint))) {
      const kp = Keypair.generate();
      mint = kp.publicKey;
      const metadata: TokenMetadata = {
        mint,
        name: `${stock.name} (test share)`,
        symbol,
        uri: `${SITE}/tokens/${symbol}.json`,
        additionalMetadata: [["pyth_feed", stock.feed]],
      };
      const mintLen = getMintLen([ExtensionType.MetadataPointer]);
      const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
      const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen);
      await send(
        conn,
        [
          SystemProgram.createAccount({
            fromPubkey: admin.publicKey,
            newAccountPubkey: mint,
            space: mintLen,
            lamports,
            programId: TOKEN_2022_PROGRAM_ID,
          }),
          createInitializeMetadataPointerInstruction(mint, faucet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
          createInitializeMintInstruction(mint, DECIMALS, faucet.publicKey, null, TOKEN_2022_PROGRAM_ID),
          createInitializeInstruction({
            programId: TOKEN_2022_PROGRAM_ID,
            metadata: mint,
            updateAuthority: faucet.publicKey,
            mint,
            mintAuthority: faucet.publicKey,
            name: metadata.name,
            symbol: metadata.symbol,
            uri: metadata.uri,
          }),
        ],
        [admin, kp, faucet],
      );
      mints[stock.ticker] = mint.toBase58();
      console.log(`${symbol.padEnd(7)} mint ${mint.toBase58()}`);
    }

    const asset = assetPda(mint);
    if (!(await conn.getAccountInfo(asset))) {
      await send(
        conn,
        [
          new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
              { pubkey: config, isSigner: false, isWritable: false },
              { pubkey: asset, isSigner: false, isWritable: true },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: admin.publicKey, isSigner: true, isWritable: true },
              { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: coder.instruction.encode("register_asset", {
              feed_id: Array.from(Buffer.from(stock.feed, "hex")),
              symbol,
            }),
          }),
        ],
        [admin],
      );
      console.log(`${symbol.padEnd(7)} registered with feed ${stock.feed.slice(0, 10)}...`);
    }

    // Save as we go, so a failure halfway keeps what was made.
    fs.writeFileSync(
      dataFile,
      JSON.stringify({ tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), decimals: DECIMALS, mints }, null, 2) + "\n",
    );
  }

  // 5. The faucet secret, for the server. Devnet test authority only. A local
  // validator's faucet is read from keys/ by the dev server instead, so a
  // localnet run never overwrites the devnet key in .env.local.
  if (CLUSTER === "devnet") {
    const envFile = path.join(ROOT, ".env.local");
    const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    const line = `FAUCET_SECRET_KEY=${JSON.stringify(Array.from(faucet.secretKey))}`;
    const next = /^FAUCET_SECRET_KEY=.*$/m.test(env)
      ? env.replace(/^FAUCET_SECRET_KEY=.*$/m, line)
      : `${env}${env && !env.endsWith("\n") ? "\n" : ""}${line}\n`;
    fs.writeFileSync(envFile, next, { mode: 0o600 });
    console.log("FAUCET_SECRET_KEY written to .env.local");
  }

  console.log(`done: ${Object.keys(mints).length} stocks in ${path.relative(ROOT, dataFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
