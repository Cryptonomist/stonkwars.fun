/* LOCAL VALIDATOR ONLY: the settler, with Pyth faked through surfpool.
 *
 *   RPC=http://127.0.0.1:8899 npx tsx scripts/dev-crank.ts
 *
 * Writes PriceUpdateV2 accounts straight into the local validator with the
 * surfnet_setAccount cheatcode, owned by the Pyth receiver's address and laid
 * out byte for byte as the real ones, carrying the synthetic prices of
 * src/lib/devPrices.ts with publish times that satisfy the boundary rule. Then
 * it runs start_duel / settle_duel / refund_duel exactly as the real settler
 * does. Refuses to talk to anything that is not localhost.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

import {
  buildRefundDuel,
  buildSettleDuel,
  buildStartDuel,
  decodeDuel,
  duelsWithStatus,
  PROGRAM_ID,
  PYTH_RECEIVER_ID,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  type DuelView,
} from "../src/lib/duel";
import { DEV_EXPO, devPrice } from "../src/lib/devPrices";
import { byFeed } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("dev-crank only runs against a local validator");

const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
);
const DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

function priceUpdateData(feedHex: string, price: bigint, publishTime: number, prev: number): Buffer {
  const d = Buffer.alloc(134);
  DISC.copy(d, 0);
  let at = 40;
  d[at++] = 1; // VerificationLevel::Full
  Buffer.from(feedHex, "hex").copy(d, at);
  at += 32;
  d.writeBigInt64LE(price, at);
  at += 8;
  d.writeBigUInt64LE(BigInt(2000), at);
  at += 8;
  d.writeInt32LE(DEV_EXPO, at);
  at += 4;
  d.writeBigInt64LE(BigInt(publishTime), at);
  at += 8;
  d.writeBigInt64LE(BigInt(prev), at);
  at += 8;
  d.writeBigInt64LE(price, at);
  at += 8;
  d.writeBigUInt64LE(BigInt(2000), at);
  at += 8;
  d.writeBigUInt64LE(BigInt(1), at);
  return d;
}

async function fakePrice(feedHex: string, boundary: number): Promise<PublicKey> {
  const ticker = byFeed(feedHex)?.ticker ?? "SPY";
  const address = Keypair.generate().publicKey;
  const data = priceUpdateData(feedHex, devPrice(ticker, boundary), boundary, boundary - 1);
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setAccount",
      params: [
        address.toBase58(),
        {
          lamports: 2_000_000,
          data: data.toString("hex"),
          owner: PYTH_RECEIVER_ID.toBase58(),
          executable: false,
          rentEpoch: 0,
        },
      ],
    }),
  });
  const body = (await res.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`surfnet_setAccount: ${body.error.message}`);
  return address;
}

async function send(ix: Parameters<Transaction["add"]>[0]) {
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: "confirmed" });
}

async function byStatus(status: number): Promise<DuelView[]> {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { filters: duelsWithStatus(status) });
  return accounts.map((a) => decodeDuel(a.pubkey, a.account.data));
}

async function tick() {
  // The validator's clock, not ours: surfpool can drift or time-travel.
  const now = (await conn.getBlockTime(await conn.getSlot())) ?? Math.floor(Date.now() / 1000);
  for (const d of await byStatus(STATUS_ACCEPTED)) {
    const boundary = d.acceptedTs + START_DELAY_SECS;
    if (now < boundary + 1) continue;
    const c = await fakePrice(d.creatorFeed, boundary);
    const o = await fakePrice(d.opponentFeed, boundary);
    const sig = await send(buildStartDuel(d, c, o));
    console.log(`start  ${d.address.toBase58().slice(0, 8)} ${sig.slice(0, 16)}...`);
  }
  for (const d of await byStatus(STATUS_LIVE)) {
    if (now < d.endTs + 1) continue;
    const c = await fakePrice(d.creatorFeed, d.endTs);
    const o = await fakePrice(d.opponentFeed, d.endTs);
    const sig = await send(buildSettleDuel(d, payer.publicKey, c, o));
    console.log(`settle ${d.address.toBase58().slice(0, 8)} ${sig.slice(0, 16)}...`);
  }
  for (const d of await byStatus(STATUS_VOID)) {
    const sig = await send(buildRefundDuel(d, payer.publicKey));
    console.log(`refund ${d.address.toBase58().slice(0, 8)} ${sig.slice(0, 16)}...`);
  }
}

async function main() {
  console.log(`dev-crank on ${RPC} as ${payer.publicKey.toBase58()}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.log("tick failed:", e instanceof Error ? e.message.split("\n")[0] : e);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

main();
