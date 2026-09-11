/* One-time setup of a cluster for Stonk Wars: config, oracle, test stocks,
 * registry.
 *
 *   RPC=https://api.devnet.solana.com FAUCET_SOL=2 npx tsx scripts/setup-devnet.ts
 *
 * Idempotent, so it can be re-run after a partial failure:
 *   1. init_config, signed by the deploy wallet, which becomes the admin;
 *   2. an oracle keypair (keys/oracle-<cluster>.json, gitignored), named in
 *      the config with set_oracle; it signs the quotes for "signed" stocks;
 *   3. a faucet keypair (keys/faucet-<cluster>.json, gitignored), funded with
 *      FAUCET_SOL, which is the mint authority of every test stock;
 *   4. one Token-2022 mint per stock in the roster, 8 decimals; the best known
 *      METADATA_FOR (default 60) carry their name and symbol in the mint by the
 *      metadata extension, so wallets show "NVDAx" rather than an address;
 *   5. register_asset for each, with its feed id and price source, in the same
 *      transaction as its mint, CONCURRENCY (default 8) at a time;
 *   6. src/data/stocks.<cluster>.json, which the app reads, and on devnet
 *      FAUCET_SECRET_KEY and ORACLE_SECRET_KEY written to .env.local.
 *
 * THESE ARE TEST TOKENS. They stand in for tokenized shares on a test cluster
 * and are worth nothing. On mainnet the registry would point at the issuers'
 * mints (src/data/stocks.mainnet-beta.json) and this script would not run.
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

import { assetPda, coder, configPda, PROGRAM_ID, SOURCE_PYTH, SOURCE_SIGNED } from "../src/lib/duel";
import mainnet from "../src/data/stocks.mainnet-beta.json";
import { ROSTER, type Token } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const CLUSTER = process.env.CLUSTER ?? (RPC.includes("localhost") || RPC.includes("127.0.0.1") ? "localnet" : "devnet");
const FAUCET_SOL = Number(process.env.FAUCET_SOL ?? "2");
const SITE = process.env.SITE ?? "https://stonkwars.fun";
const DECIMALS = 8;
/** Stocks set up at once. */
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "8");
/** How many of the roster's first stocks get wallet-visible metadata. */
const METADATA_FOR = Number(process.env.METADATA_FOR ?? "60");
const ROOT = path.resolve(__dirname, "..");

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]));
}

/** A keypair kept in keys/, made on first use. */
function localKey(keysDir: string, name: string): Keypair {
  const file = path.join(keysDir, `${name}-${CLUSTER}.json`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    console.log(`${name} key written to ${path.relative(ROOT, file)}`);
  }
  return loadKeypair(file);
}

/** Set KEY=value in .env.local, replacing any earlier value. */
function writeEnv(key: string, value: string) {
  const envFile = path.join(ROOT, ".env.local");
  const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(env) ? env.replace(pattern, line) : `${env}${env && !env.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(envFile, next, { mode: 0o600 });
  console.log(`${key} written to .env.local`);
}

/** The symbol a stock's first mainnet issuer uses (the list is in issuer
 * order: xStocks, then Ondo, then Backpack), for the test token. */
const MAINNET_SYMBOL = new Map<string, string>();
for (const t of (mainnet as { tokens: Token[] }).tokens) {
  if (!MAINNET_SYMBOL.has(t.ticker)) MAINNET_SYMBOL.set(t.ticker, t.symbol);
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

  const keysDir = path.join(ROOT, "keys");
  fs.mkdirSync(keysDir, { recursive: true });

  // 2. Oracle key, named in the config
  const oracle = localKey(keysDir, "oracle");
  const configData = await conn.getAccountInfo(config);
  const current = configData
    ? new PublicKey((coder.accounts.decode("Config", configData.data) as { oracle: PublicKey }).oracle)
    : null;
  if (!current?.equals(oracle.publicKey)) {
    await send(
      conn,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: config, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          ],
          data: coder.instruction.encode("set_oracle", { oracle: oracle.publicKey }),
        }),
      ],
      [admin],
    );
  }
  console.log(`oracle ${oracle.publicKey.toBase58()}`);

  // 3. Faucet key
  const faucet = localKey(keysDir, "faucet");
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

  // 4 + 5. Mints and registry
  const dataFile = path.join(ROOT, "src/data", `stocks.${CLUSTER}.json`);
  const existing = fs.existsSync(dataFile)
    ? (JSON.parse(fs.readFileSync(dataFile, "utf8")) as { tokens?: Token[]; mints?: Record<string, string> })
    : {};
  // Earlier runs wrote { mints: { TICKER: mint } }; keep those mints.
  const mints: Record<string, string> = {
    ...(existing.mints ?? {}),
    ...Object.fromEntries((existing.tokens ?? []).map((t) => [t.ticker, t.mint])),
  };
  // Compact: the app fills in issuer "test", 8 decimals and Token-2022.
  const tokens = () =>
    ROSTER.filter((s) => mints[s.ticker]).map((s) => ({
      ticker: s.ticker,
      symbol: MAINNET_SYMBOL.get(s.ticker) ?? `${s.ticker}x`,
      mint: mints[s.ticker],
    }));

  const save = () => fs.writeFileSync(dataFile, JSON.stringify({ tokens: tokens() }).replace(/},{/g, "},\n{") + "\n");
  const register = (stock: (typeof ROSTER)[number], mint: PublicKey, symbol: string) =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: assetPda(mint), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: coder.instruction.encode("register_asset", {
        feed_id: Array.from(Buffer.from(stock.feed, "hex")),
        symbol,
        source: stock.source === "pyth" ? SOURCE_PYTH : SOURCE_SIGNED,
      }),
    });

  /* One transaction per new stock: the mint, and its registration. The first
   * METADATA_FOR stocks (the roster's best known) also carry a name and
   * symbol in the mint so wallets show "NVDAx"; the rest skip it, which on a
   * thousand stocks saves a few devnet SOL. */
  async function ensure(stock: (typeof ROSTER)[number], index: number) {
    const symbol = MAINNET_SYMBOL.get(stock.ticker) ?? `${stock.ticker}x`;
    const known = mints[stock.ticker] ? new PublicKey(mints[stock.ticker]) : null;
    if (known && (await conn.getAccountInfo(known))) {
      if (!(await conn.getAccountInfo(assetPda(known)))) await send(conn, [register(stock, known, symbol)], [admin]);
      return;
    }
    const kp = Keypair.generate();
    const mint = kp.publicKey;
    const withMetadata = index < METADATA_FOR;
    const ixs: TransactionInstruction[] = [];
    if (withMetadata) {
      const metadata: TokenMetadata = {
        mint,
        name: `${stock.name} (test share)`.slice(0, 48),
        symbol,
        uri: `${SITE}/tokens/${symbol}.json`,
        additionalMetadata: [],
      };
      const mintLen = getMintLen([ExtensionType.MetadataPointer]);
      const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
      ixs.push(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint,
          space: mintLen,
          lamports: await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen),
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
      );
    } else {
      const mintLen = getMintLen([]);
      ixs.push(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint,
          space: mintLen,
          lamports: await conn.getMinimumBalanceForRentExemption(mintLen),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(mint, DECIMALS, faucet.publicKey, null, TOKEN_2022_PROGRAM_ID),
      );
    }
    ixs.push(register(stock, mint, symbol));
    await send(conn, ixs, withMetadata ? [admin, kp, faucet] : [admin, kp]);
    mints[stock.ticker] = mint.toBase58();
    done++;
    if (done % 25 === 0) {
      save();
      console.log(`${done} new stocks so far (last: ${symbol}, ${stock.source})`);
    }
  }

  let done = 0;
  let next = 0;
  const failures: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let i = next++; i < ROSTER.length; i = next++) {
        try {
          await ensure(ROSTER[i], i);
        } catch (e) {
          failures.push(`${ROSTER[i].ticker}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        }
      }
    }),
  );
  save();
  if (failures.length) {
    console.log(`${failures.length} stocks failed; run again to retry them:\n  ${failures.slice(0, 10).join("\n  ")}`);
  }

  // 6. The faucet and oracle secrets, for the server. Devnet test keys only.
  // A local validator's keys are read from keys/ instead, so a localnet run
  // never overwrites the devnet keys in .env.local.
  if (CLUSTER === "devnet") {
    writeEnv("FAUCET_SECRET_KEY", JSON.stringify(Array.from(faucet.secretKey)));
    writeEnv("ORACLE_SECRET_KEY", JSON.stringify(Array.from(oracle.secretKey)));
  }

  console.log(`done: ${tokens().length} stocks in ${path.relative(ROOT, dataFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
