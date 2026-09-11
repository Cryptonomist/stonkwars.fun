/* LOCAL VALIDATOR ONLY: whole fights, start to settlement, on real prices, at
 * any hour.
 *
 *   RPC=http://127.0.0.1:8899 npx tsx scripts/e2e-live.ts
 *
 * Stocks sleep at night and on weekends; crypto does not. So this registers
 * throwaway test tokens priced as crypto (BTC by Pyth, ETH and SOL by the
 * oracle from their one-minute bars), opens one-minute fights between fresh
 * wallets, and runs the real crank (src/lib/crank.ts) until they settle:
 *
 *   BTC vs ETH   a Pyth side and a signed side in one transaction
 *   ETH vs SOL   two signed sides, no Pyth at all
 *
 * Then it checks each price the program recorded against the sources, asked
 * again independently. Needs PYTH_API_KEY (.env.local) and the local oracle
 * and faucet keys from the setup script.
 */

import crypto from "crypto";
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
import { TOKEN_2022_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { HermesClient } from "@pythnetwork/hermes-client";

import { boundaryOf, crankOnce } from "../src/lib/crank";
import {
  assetPda,
  buildAcceptDuel,
  buildCreateDuel,
  coder,
  configPda,
  decodeDuel,
  randomSeed,
  SOURCE_PYTH,
  SOURCE_SIGNED,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  type DuelView,
} from "../src/lib/duel";
import { quoteAt } from "../src/lib/oracle";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("e2e-live only runs against a local validator");

for (const line of fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const load = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const admin = load(path.join(os.homedir(), ".config/solana/id.json"));
const faucet = load(path.join(ROOT, "keys/faucet-localnet.json"));
const oracle = load(path.join(ROOT, "keys/oracle-localnet.json"));
const hermes = new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
  accessToken: process.env.PYTH_API_KEY,
  timeout: 10_000,
});

type Coin = { symbol: string; feed: string; source: number; quote?: string; mint?: PublicKey };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const COINS: Record<string, Coin> = {
  BTC: { symbol: "BTCt", feed: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", source: SOURCE_PYTH },
  ETH: { symbol: "ETHt", feed: sha("Crypto.ETH/USD"), source: SOURCE_SIGNED, quote: "ETH-USD" },
  SOL: { symbol: "SOLt", feed: sha("Crypto.SOL/USD"), source: SOURCE_SIGNED, quote: "SOL-USD" },
};
const quoteSymbol = (feed: string) => {
  const quote = Object.values(COINS).find((c) => c.feed === feed)?.quote;
  return quote ? { symbol: quote, currency: "USD" } : undefined;
};

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const send = (ixs: TransactionInstruction[], signers: Keypair[]) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });

async function register(c: Coin) {
  c.mint = await createMint(conn, admin, faucet.publicKey, null, 8, Keypair.generate(), { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  await send(
    [
      new TransactionInstruction({
        programId: (await import("../src/lib/duel")).PROGRAM_ID,
        keys: [
          { pubkey: configPda(), isSigner: false, isWritable: false },
          { pubkey: assetPda(c.mint), isSigner: false, isWritable: true },
          { pubkey: c.mint, isSigner: false, isWritable: false },
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: coder.instruction.encode("register_asset", {
          feed_id: Array.from(Buffer.from(c.feed, "hex")),
          symbol: c.symbol,
          source: c.source,
        }),
      }),
    ],
    [admin],
  );
  log(`registered ${c.symbol} (${c.source === SOURCE_PYTH ? "Pyth" : "signed"}) ${c.mint.toBase58()}`);
}

async function player(): Promise<Keypair> {
  const p = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: LAMPORTS_PER_SOL })], [admin]);
  for (const c of Object.values(COINS)) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, admin, c.mint!, p.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
    await mintTo(conn, admin, c.mint!, ata.address, faucet, 10n * 10n ** 8n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  }
  return p;
}

async function fight(a: Coin, b: Coin): Promise<DuelView> {
  const [alice, bob] = [await player(), await player()];
  const now = Math.floor(Date.now() / 1000);
  const asset = (c: Coin) => ({ mint: c.mint!, tokenProgram: TOKEN_2022_PROGRAM_ID });
  const { instruction, duel } = buildCreateDuel({
    creator: alice.publicKey,
    seed: randomSeed(),
    creatorAsset: asset(a),
    opponentAsset: asset(b),
    creatorAmount: 1_000_000n,
    opponentAmount: 2_000_000n,
    durationSecs: 60,
    endTs: 0,
    expiresTs: now + 3_600,
    taunt: `${a.symbol} by the bell`,
  });
  await send([instruction], [alice]);
  const open = decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
  await send([buildAcceptDuel(open, bob.publicKey)], [bob]);
  log(`${a.symbol} vs ${b.symbol}: ${duel.toBase58()} accepted`);
  return decodeDuel(duel, (await conn.getAccountInfo(duel))!.data);
}

async function verify(d: DuelView, a: Coin, b: Coin) {
  const px = (p: { price: bigint; expo: number }) => Number(p.price) * 10 ** p.expo;
  for (const [which, boundary] of [["start", boundaryOf(d, "start")], ["settle", d.endTs]] as const) {
    for (const [coin, point] of [
      [a, which === "start" ? d.creatorStart : d.creatorEnd],
      [b, which === "start" ? d.opponentStart : d.opponentEnd],
    ] as const) {
      let expected: number;
      if (coin.source === SOURCE_PYTH) {
        const u = await hermes.getPriceUpdatesAtTimestamp(boundary, [coin.feed], { parsed: true });
        const p = u.parsed![0].price;
        expected = Number(p.price) * 10 ** p.expo;
      } else {
        const q = (await quoteAt({ feed: coin.feed, symbol: coin.quote!, boundary }))!;
        expected = Number(q.price) * 10 ** q.expo;
      }
      const got = px(point);
      const ok = Math.abs(got - expected) < 1e-9 * Math.max(1, expected);
      log(`  ${which.padEnd(6)} ${coin.symbol}: on chain ${got.toFixed(4)}, source says ${expected.toFixed(4)} ${ok ? "MATCH" : "MISMATCH"}`);
      if (!ok) process.exitCode = 1;
    }
  }
}

async function main() {
  if (!process.env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not set");
  const config = coder.accounts.decode("Config", (await conn.getAccountInfo(configPda()))!.data) as { oracle: PublicKey };
  if (!new PublicKey(config.oracle).equals(oracle.publicKey)) throw new Error("The config names another oracle; run the setup script");

  for (const c of Object.values(COINS)) await register(c);
  const fights = [
    { d: await fight(COINS.BTC, COINS.ETH), a: COINS.BTC, b: COINS.ETH },
    { d: await fight(COINS.ETH, COINS.SOL), a: COINS.ETH, b: COINS.SOL },
  ];

  const deadline = Date.now() + 8 * 60_000;
  const done = new Set<string>();
  while (done.size < fights.length && Date.now() < deadline) {
    const results = await crankOnce({ conn, payer: admin, hermes, oracle, quoteSymbol });
    for (const r of results) log(`${r.kind.padEnd(6)} ${r.duel.slice(0, 8)} ${r.ok ? "ok" : r.detail}`);
    for (const f of fights) {
      const d = decodeDuel(f.d.address, (await conn.getAccountInfo(f.d.address))!.data);
      if ((d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED) && !done.has(d.address.toBase58())) {
        done.add(d.address.toBase58());
        const winner = d.outcome === 1 ? f.a.symbol : d.outcome === 2 ? f.b.symbol : "tie";
        log(`${f.a.symbol} vs ${f.b.symbol} settled: ${winner}`);
        await verify(d, f.a, f.b);
      }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (done.size < fights.length) {
    console.error(`timed out with ${fights.length - done.size} fight(s) unsettled`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
