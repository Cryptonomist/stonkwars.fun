/* DEVNET ONLY: real settled fights, so the board is not blank on demo day.
 *
 *   DEVNET=1 RPC=https://api.devnet.solana.com npx tsx scripts/seed-devnet.ts
 *
 * Stock markets are shut most of the week, and a fight cannot settle without a
 * price, so these are fought on three test assets priced as crypto: BTC by
 * Pyth, ETH and SOL by the oracle's signed quotes. Everything else is the real
 * thing. Real escrow, real boundary prices, real settlement by the real crank,
 * and records that add up because the same handful of wallets fight again and
 * again.
 *
 * The assets and the wallets are kept in keys/ so a second run adds to the
 * board instead of starting another one. They are deliberately NOT in
 * roster.json, so nobody can pick them for a fight of their own: they exist to
 * give the leaderboard a past.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import { HermesClient } from "@pythnetwork/hermes-client";

import { crankOnce } from "../src/lib/crank";
import {
  assetPda,
  buildAcceptDuel,
  buildCreateDuel,
  coder,
  configPda,
  decodeDuel,
  PROGRAM_ID,
  randomSeed,
  SOURCE_PYTH,
  SOURCE_SIGNED,
  STATUS_REFUNDED,
  STATUS_SETTLED,
} from "../src/lib/duel";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
if (!(process.env.DEVNET === "1" && /devnet/.test(RPC))) {
  throw new Error("seed-devnet runs against devnet with DEVNET=1");
}

for (const line of fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const load = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const admin = load(path.join(os.homedir(), ".config/solana/id.json"));
const faucet = load(path.join(ROOT, "keys/faucet-devnet.json"));
const oracle = load(path.join(ROOT, "keys/oracle-devnet.json"));
const hermes = new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
  accessToken: process.env.PYTH_API_KEY,
  timeout: 10_000,
});

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
type Coin = { symbol: string; feed: string; source: number; quote?: string; mint?: PublicKey };
const COINS: Record<string, Coin> = {
  BTC: { symbol: "BTCt", feed: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", source: SOURCE_PYTH },
  ETH: { symbol: "ETHt", feed: sha("Crypto.ETH/USD"), source: SOURCE_SIGNED, quote: "ETH-USD" },
  SOL: { symbol: "SOLt", feed: sha("Crypto.SOL/USD"), source: SOURCE_SIGNED, quote: "SOL-USD" },
};
const quoteSymbol = (feed: string) => {
  const quote = Object.values(COINS).find((c) => c.feed === feed)?.quote;
  return quote ? { symbol: quote, currency: "USD" } : undefined;
};

const ASSETS_FILE = path.join(ROOT, "keys/seed-assets.devnet.json");
const PLAYERS_FILE = path.join(ROOT, "keys/seed-players.devnet.json");
const ROUND_SECS = 60;
const STAKE = 1_000_000n; // 0.01 of a test share

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Devnet is a public road: finalized blockhashes, no preflight, confirmation
 * by polling, and a look at what we already sent before sending again. */
async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  let last: unknown;
  const sent: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      for (const old of sent) {
        const status = (await conn.getSignatureStatuses([old])).value[0];
        if (status && !status.err && status.confirmationStatus !== "processed") return old;
      }
      const tx = new Transaction().add(...ixs);
      tx.recentBlockhash = (await conn.getLatestBlockhash("finalized")).blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.sign(...signers);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
      sent.push(sig);
      for (let i = 0; i < 40; i++) {
        await sleep(800);
        const status = (await conn.getSignatureStatuses([sig])).value[0];
        if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return sig;
      }
      throw new Error("confirmation timed out");
    } catch (e) {
      last = e;
      await sleep(1_200 * (attempt + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** The three test assets, made once and reused by every later run. */
async function assets() {
  const saved: Record<string, string> = fs.existsSync(ASSETS_FILE)
    ? (JSON.parse(fs.readFileSync(ASSETS_FILE, "utf8")) as Record<string, string>)
    : {};

  for (const [key, coin] of Object.entries(COINS)) {
    if (saved[key] && (await conn.getAccountInfo(assetPda(new PublicKey(saved[key]))))) {
      coin.mint = new PublicKey(saved[key]);
      log(`reusing ${coin.symbol} ${coin.mint.toBase58()}`);
      continue;
    }
    const kp = Keypair.generate();
    coin.mint = kp.publicKey;
    const space = getMintLen([]);
    await send(
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: coin.mint,
          space,
          lamports: await conn.getMinimumBalanceForRentExemption(space),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(coin.mint, 8, faucet.publicKey, null, TOKEN_2022_PROGRAM_ID),
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: configPda(), isSigner: false, isWritable: false },
            { pubkey: assetPda(coin.mint), isSigner: false, isWritable: true },
            { pubkey: coin.mint, isSigner: false, isWritable: false },
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: coder.instruction.encode("register_asset", {
            feed_id: Array.from(Buffer.from(coin.feed, "hex")),
            symbol: coin.symbol,
            source: coin.source,
          }),
        }),
      ],
      [admin, kp],
    );
    saved[key] = coin.mint.toBase58();
    log(`registered ${coin.symbol} ${coin.mint.toBase58()}`);
  }
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(saved, null, 2));
}

/** Four wallets that keep their records between runs. */
async function players(): Promise<Keypair[]> {
  let keys: number[][] = fs.existsSync(PLAYERS_FILE)
    ? (JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8")) as number[][])
    : [];
  if (keys.length < 4) {
    keys = Array.from({ length: 4 }, () => Array.from(Keypair.generate().secretKey));
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(keys));
  }
  const wallets = keys.map((k) => Keypair.fromSecretKey(Uint8Array.from(k)));

  for (const w of wallets) {
    const balance = await conn.getBalance(w.publicKey);
    if (balance < LAMPORTS_PER_SOL / 40) {
      await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w.publicKey, lamports: LAMPORTS_PER_SOL / 20 })], [admin]);
    }
    const ix: TransactionInstruction[] = [];
    for (const c of Object.values(COINS)) {
      const ata = getAssociatedTokenAddressSync(c.mint!, w.publicKey, false, TOKEN_2022_PROGRAM_ID);
      ix.push(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, w.publicKey, c.mint!, TOKEN_2022_PROGRAM_ID));
      ix.push(createMintToInstruction(c.mint!, ata, faucet.publicKey, 100n * 10n ** 8n, [], TOKEN_2022_PROGRAM_ID));
    }
    await send(ix, [admin, faucet]);
  }
  log(`${wallets.length} wallets funded and stocked`);
  return wallets;
}

async function fight(a: Coin, b: Coin, creator: Keypair, taker: Keypair) {
  const asset = (c: Coin) => ({ mint: c.mint!, tokenProgram: TOKEN_2022_PROGRAM_ID });
  const { instruction, duel } = buildCreateDuel({
    creator: creator.publicKey,
    seed: randomSeed(),
    creatorAsset: asset(a),
    opponentAsset: asset(b),
    creatorAmount: STAKE,
    opponentAmount: STAKE,
    durationSecs: ROUND_SECS,
    endTs: 0,
    expiresTs: Math.floor(Date.now() / 1000) + 3_600,
    taunt: `${a.symbol} over ${b.symbol}, all day`,
  });
  await send([instruction], [creator]);
  const open = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
  await send([buildAcceptDuel(open, taker.publicKey)], [taker]);
  log(`${a.symbol} vs ${b.symbol}: ${duel.toBase58().slice(0, 8)} accepted`);
  return duel;
}

async function main() {
  if (!process.env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not set");
  const config = coder.accounts.decode("Config", (await conn.getAccountInfo(configPda()))!.data) as { oracle: PublicKey };
  if (!new PublicKey(config.oracle).equals(oracle.publicKey)) throw new Error("The config names another oracle");

  await assets();
  const [w1, w2, w3, w4] = await players();

  /* A card that leaves a board worth reading: one wallet ahead, one behind,
   * and the middle two trading wins. Who actually wins is the market's call. */
  const card: [Coin, Coin, Keypair, Keypair][] = [
    [COINS.BTC, COINS.ETH, w1, w2],
    [COINS.ETH, COINS.SOL, w3, w4],
    [COINS.SOL, COINS.BTC, w1, w3],
    [COINS.BTC, COINS.SOL, w2, w4],
    [COINS.ETH, COINS.BTC, w1, w4],
    [COINS.SOL, COINS.ETH, w2, w3],
  ];

  const open: PublicKey[] = [];
  for (const [a, b, creator, taker] of card) open.push(await fight(a, b, creator, taker));

  const deadline = Date.now() + 12 * 60_000;
  const settled = new Set<string>();
  while (settled.size < open.length && Date.now() < deadline) {
    const results = await crankOnce({ conn, payer: admin, hermes, oracle, quoteSymbol });
    for (const r of results) if (!r.ok && !/not yet|waiting/i.test(r.detail ?? "")) log(`${r.kind} ${r.duel.slice(0, 8)} ${r.detail}`);
    for (const address of open) {
      const d = decodeDuel(address, (await conn.getAccountInfo(address))!.data);
      const key = address.toBase58();
      if ((d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED) && !settled.has(key)) {
        settled.add(key);
        const winner = d.outcome === 1 ? d.creator : d.outcome === 2 ? d.opponent : null;
        log(`settled ${key.slice(0, 8)}: ${winner ? `${winner.toBase58().slice(0, 8)} takes both` : "a draw, both refunded"}`);
      }
    }
    await sleep(5_000);
  }

  log(`${settled.size} of ${open.length} settled`);
  if (settled.size < open.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
