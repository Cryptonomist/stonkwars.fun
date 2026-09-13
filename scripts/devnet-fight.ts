/* DEVNET: one fight between two real stocks, start to settlement.
 *
 *   DEVNET=1 npx tsx scripts/devnet-fight.ts TSLA NVDA [round seconds]
 *
 * The point of this one is the hour. With the exchange shut, a fight settles on
 * whichever market is still open: a perpetual futures market on the stock for
 * most of them, and for a handful with no perp, a trimmed mean of the token's
 * own recent one-minute closes on its Solana pool. During the session it is the
 * exchange, and nothing else changes. That a fight can run at all at 3am is the
 * whole argument for a share being on a chain.
 *
 * It prints the prices the program recorded next to the ones the source gives
 * when asked again, so the claim is checkable rather than asserted.
 *
 * HANDS_OFF=1 creates the fight and then touches nothing, which turns this into
 * a test of the DEPLOYED settler rather than of the program: if the fight
 * reaches a result, something else did the work, and the fee payers printed at
 * the end say which something. */

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
import { HermesClient } from "@pythnetwork/hermes-client";

import { crankOnce } from "../src/lib/crank";
import {
  buildAcceptDuel,
  buildCreateDuel,
  coder,
  configPda,
  decodeDuel,
  randomSeed,
  SOURCE_PYTH,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  type DuelView,
} from "../src/lib/duel";
import { SITE_URL } from "../src/lib/brand";
import { quoteAt, sourceAt } from "../src/lib/oracle";
import { byTicker, quoteSymbolFor, stakeAssetFor, STAKE_DECIMALS } from "../src/lib/stocks";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
if (!(process.env.DEVNET === "1" && /devnet/.test(RPC))) {
  throw new Error("devnet-fight runs against devnet with DEVNET=1");
}

for (const line of fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const admin = load(path.join(os.homedir(), ".config/solana/id.json"));
const faucet = load(path.join(ROOT, "keys/faucet-devnet.json"));
const oracle = load(path.join(ROOT, "keys/oracle-devnet.json"));
const hermes = process.env.PYTH_API_KEY
  ? new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
      accessToken: process.env.PYTH_API_KEY,
      timeout: 10_000,
    })
  : undefined;

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

/** A funded wallet holding one share of `ticker`. */
async function player(ticker: string): Promise<Keypair> {
  const asset = stakeAssetFor(ticker);
  if (!asset) throw new Error(`${ticker} has no token on devnet`);
  const kp = Keypair.generate();
  await send(
    [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: LAMPORTS_PER_SOL / 25 })],
    [admin],
  );
  const ata = getAssociatedTokenAddressSync(asset.mint, kp.publicKey, false, asset.tokenProgram);
  await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, kp.publicKey, asset.mint, asset.tokenProgram),
      createMintToInstruction(asset.mint, ata, faucet.publicKey, 10n * 10n ** BigInt(STAKE_DECIMALS), [], asset.tokenProgram),
    ],
    [admin, faucet],
  );
  return kp;
}

const px = (p: { price: bigint; expo: number }) => Number(p.price) * 10 ** p.expo;

/** Ask the sources again, independently, and hold them against the chain. */
async function verify(d: DuelView, t1: string, t2: string) {
  for (const [which, boundary] of [
    ["start", d.acceptedTs + 2],
    ["settle", d.endTs],
  ] as const) {
    for (const [ticker, source, point] of [
      [t1, d.creatorSource, which === "start" ? d.creatorStart : d.creatorEnd],
      [t2, d.opponentSource, which === "start" ? d.opponentStart : d.opponentEnd],
    ] as const) {
      const market = quoteSymbolFor(byTicker(ticker)!.feed)!;
      const read = sourceAt(boundary, market);
      let expected: number | null = null;
      if (source === SOURCE_PYTH && hermes) {
        const u = await hermes.getPriceUpdatesAtTimestamp(boundary, [byTicker(ticker)!.feed], { parsed: true });
        const p = u.parsed![0].price;
        expected = Number(p.price) * 10 ** p.expo;
      } else {
        const q = await quoteAt({ feed: byTicker(ticker)!.feed, ...market, boundary });
        expected = q ? px(q) : null;
      }
      const got = px(point);
      const ok = expected !== null && Math.abs(got - expected) < 1e-9 * Math.max(1, expected);
      log(
        `  ${which.padEnd(6)} ${ticker.padEnd(6)} via ${read.padEnd(8)} on chain ${got.toFixed(4)}` +
          `  source ${expected === null ? "unavailable" : expected.toFixed(4)}  ${ok ? "MATCH" : "MISMATCH"}`,
      );
      if (!ok) process.exitCode = 1;
    }
  }
}

async function main() {
  const [t1, t2] = [(process.argv[2] ?? "TSLA").toUpperCase(), (process.argv[3] ?? "NVDA").toUpperCase()];
  const durationSecs = Number(process.argv[4] ?? 300);
  for (const t of [t1, t2]) if (!byTicker(t)) throw new Error(`${t} is not in the roster`);

  const config = coder.accounts.decode("Config", (await conn.getAccountInfo(configPda()))!.data) as { oracle: PublicKey };
  if (!new PublicKey(config.oracle).equals(oracle.publicKey)) throw new Error("The config names another oracle");

  const now = Math.floor(Date.now() / 1000);
  for (const t of [t1, t2]) {
    const market = quoteSymbolFor(byTicker(t)!.feed)!;
    log(`${t}: priced by ${sourceAt(now + durationSecs, market)}${market.pool ? ` (pool ${market.pool.slice(0, 8)})` : ""}`);
  }

  const [alice, bob] = [await player(t1), await player(t2)];
  const a1 = stakeAssetFor(t1)!;
  const a2 = stakeAssetFor(t2)!;
  const stake = 10n ** BigInt(STAKE_DECIMALS) / 100n; // a hundredth of a share

  const { instruction, duel } = buildCreateDuel({
    creator: alice.publicKey,
    seed: randomSeed(),
    creatorAsset: a1,
    opponentAsset: a2,
    creatorAmount: stake,
    opponentAmount: stake,
    durationSecs,
    endTs: 0,
    expiresTs: now + 3_600,
    taunt: `${t1} beats ${t2}, exchange open or shut`,
  });
  await send([instruction], [alice]);
  const open = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
  await send([buildAcceptDuel(open, bob.publicKey)], [bob]);
  log(`${t1} vs ${t2}: ${duel.toBase58()}`);
  log(`${process.env.SITE_URL ?? SITE_URL}/f/${duel.toBase58()}`);

  /* HANDS_OFF=1 makes this a test of the DEPLOYED settler rather than of the
   * program. Nothing here touches the fight after it is accepted, so if it
   * reaches a result at all, something else did the work: the cron, or a
   * visitor pressing "Settle it yourself". Which one is answered by the fee
   * payer, printed below. Without this flag the script cranks the fight itself,
   * which proves the chain logic and says nothing about whether the cron runs. */
  const handsOff = process.env.HANDS_OFF === "1";
  if (handsOff) log(`hands off: not cranking. Waiting to see whether the deployed settler does it.`);

  const deadline = Date.now() + 20 * 60_000;
  let seen = open.status;
  while (Date.now() < deadline) {
    if (!handsOff) {
      const results = await crankOnce({ conn, payer: admin, hermes, oracle, quoteSymbol: quoteSymbolFor });
      for (const r of results) if (!r.ok && !/not yet|waiting|final/i.test(r.detail ?? "")) log(`${r.kind} ${r.detail}`);
    }
    const d = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
    if (d.status !== seen) {
      log(`status ${seen} -> ${d.status}${handsOff ? "  (nobody here did that)" : ""}`);
      seen = d.status;
    }
    if (d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED) {
      const winner = d.outcome === 1 ? t1 : d.outcome === 2 ? t2 : "nobody";
      log(`settled: ${winner} takes both`);
      if (handsOff) await whoDidIt(duel);
      await verify(d, t1, t2);
      return;
    }
    await sleep(handsOff ? 15_000 : 5_000);
  }
  console.error(handsOff ? "nothing settled it within 20 minutes: the deployed settler is not running" : "timed out before it settled");
  process.exitCode = 1;
}

/** Who paid for the transactions on this fight. The crank wallet means the
 * deployed settler did it; anyone else means a person pressed the button. */
async function whoDidIt(duel: PublicKey) {
  const sigs = await conn.getSignaturesForAddress(duel, { limit: 10 });
  const payers = new Set<string>();
  for (const s of sigs.reverse()) {
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    const payer = tx?.transaction.message.getAccountKeys().get(0)?.toBase58();
    if (payer) payers.add(payer);
  }
  log(`fee payers on this fight: ${[...payers].join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
