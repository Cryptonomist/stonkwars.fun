/* DEVNET: real stock fights, opened and left for the settler.
 *
 *   DEVNET=1 npx tsx scripts/seed-stocks.ts [round seconds]
 *
 * Unlike seed-devnet.ts, which fights test assets priced as crypto, these are
 * the actual roster: NVDA, AAPL, SPY and the rest, priced out of hours from
 * their own Solana pools. It creates them and stops. The deployed settler does
 * the rest, which is the point: if the board fills overnight without anybody
 * running anything, the settler works.
 *
 * The same four wallets fight every time, so records accumulate into something
 * a leaderboard can show. Rounds default to twenty minutes, longer than the
 * off-hours sample, so both sides measure a real move rather than sharing most
 * of their window with their own start. */

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
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { buildAcceptDuel, buildCreateDuel, decodeDuel, randomSeed } from "../src/lib/duel";
import { byTicker, stakeAssetFor, STAKE_DECIMALS, tradesAroundTheClock } from "../src/lib/stocks";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
if (!(process.env.DEVNET === "1" && /devnet/.test(RPC))) {
  throw new Error("seed-stocks runs against devnet with DEVNET=1");
}

const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const admin = load(path.join(os.homedir(), ".config/solana/id.json"));
const faucet = load(path.join(ROOT, "keys/faucet-devnet.json"));
const PLAYERS_FILE = path.join(ROOT, "keys/seed-players.devnet.json");

/** Pairs worth showing a judge: names anybody recognises, all pool-priced. */
const CARD: [string, string][] = [
  ["NVDA", "AAPL"],
  ["SPY", "QQQ"],
  ["MSTR", "COIN"],
  ["GME", "HOOD"],
  ["META", "GOOGL"],
  ["AMZN", "MSFT"],
];

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  let last: unknown;
  const sent: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      for (const old of sent) {
        const s = (await conn.getSignatureStatuses([old])).value[0];
        if (s && !s.err && s.confirmationStatus !== "processed") return old;
      }
      const tx = new Transaction().add(...ixs);
      tx.recentBlockhash = (await conn.getLatestBlockhash("finalized")).blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.sign(...signers);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
      sent.push(sig);
      for (let i = 0; i < 45; i++) {
        await sleep(800);
        const s = (await conn.getSignatureStatuses([sig])).value[0];
        if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
        if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
      }
      throw new Error("confirmation timed out");
    } catch (e) {
      last = e;
      await sleep(1_200 * (attempt + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function players(): Keypair[] {
  if (!fs.existsSync(PLAYERS_FILE)) throw new Error("run seed-devnet.ts once first, to make the wallets");
  return (JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8")) as number[][]).map((k) =>
    Keypair.fromSecretKey(Uint8Array.from(k)),
  );
}

/** Make sure `who` holds shares of `ticker`, and enough SOL for the fees. */
async function stock(who: Keypair, ticker: string) {
  const asset = stakeAssetFor(ticker);
  if (!asset) throw new Error(`${ticker} has no devnet token`);
  if ((await conn.getBalance(who.publicKey)) < LAMPORTS_PER_SOL / 50) {
    await send(
      [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: who.publicKey, lamports: LAMPORTS_PER_SOL / 25 })],
      [admin],
    );
  }
  const ata = getAssociatedTokenAddressSync(asset.mint, who.publicKey, false, asset.tokenProgram);
  const have = await conn
    .getTokenAccountBalance(ata)
    .then((b) => BigInt(b.value.amount))
    .catch(() => BigInt(0));
  if (have >= 10n ** BigInt(STAKE_DECIMALS)) return asset;
  await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, who.publicKey, asset.mint, asset.tokenProgram),
      createMintToInstruction(asset.mint, ata, faucet.publicKey, 10n * 10n ** BigInt(STAKE_DECIMALS), [], asset.tokenProgram),
    ],
    [admin, faucet],
  );
  return asset;
}

async function main() {
  const durationSecs = Number(process.argv[2] ?? 1_200);
  const wallets = players();
  const now = Math.floor(Date.now() / 1000);
  const stake = 10n ** BigInt(STAKE_DECIMALS) / 100n; // a hundredth of a share

  let i = 0;
  for (const [t1, t2] of CARD) {
    if (!byTicker(t1) || !byTicker(t2)) {
      log(`skipping ${t1} v ${t2}: not in the roster`);
      continue;
    }
    if (!tradesAroundTheClock(t1) || !tradesAroundTheClock(t2)) {
      // Pyth-priced or pool-less stocks cannot settle while the exchange is
      // shut, and a fight nobody can finish is worse than no fight.
      log(`skipping ${t1} v ${t2}: one of them keeps exchange hours`);
      continue;
    }
    const creator = wallets[i % wallets.length];
    const taker = wallets[(i + 1) % wallets.length];
    i++;

    try {
      const a1 = await stock(creator, t1);
      const a2 = await stock(taker, t2);
      const { instruction, duel } = buildCreateDuel({
        creator: creator.publicKey,
        seed: randomSeed(),
        creatorAsset: a1,
        opponentAsset: a2,
        creatorAmount: stake,
        opponentAmount: stake,
        durationSecs,
        endTs: 0,
        expiresTs: now + 3_600,
        taunt: `${t1} over ${t2}, and the exchange is shut`,
      });
      await send([instruction], [creator]);
      const open = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
      await send([buildAcceptDuel(open, taker.publicKey)], [taker]);
      log(`${t1} v ${t2}  ${duel.toBase58()}`);
    } catch (e) {
      log(`${t1} v ${t2} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  log("opened. the settler finishes them; nothing here waits around.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
