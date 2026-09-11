/* LOCAL VALIDATOR ONLY: the settler, with prices faked.
 *
 *   RPC=http://127.0.0.1:8899 npx tsx scripts/dev-crank.ts
 *
 * For a Pyth side, writes a PriceUpdateV2 account straight into the local
 * validator with the surfnet_setAccount cheatcode, owned by the Pyth receiver's
 * address and laid out byte for byte as the real ones. For a signed side,
 * signs a quote with the local oracle key (keys/oracle-localnet.json, from the
 * setup script). Both carry the synthetic prices of src/lib/devPrices.ts at
 * the boundary. Then it runs start_duel / settle_duel / refund_duel exactly as
 * the real settler does. Refuses to talk to anything that is not localhost.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  buildRefundDuel,
  buildSettleDuel,
  buildStartDuel,
  decodeDuel,
  duelsWithStatus,
  PROGRAM_ID,
  PYTH_RECEIVER_ID,
  SOURCE_SIGNED,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  type DuelView,
} from "../src/lib/duel";
import { DEV_EXPO, devPrice } from "../src/lib/devPrices";
import { signedQuoteInstruction } from "../src/lib/oracle";
import { byFeed } from "../src/lib/stocks";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
if (!/localhost|127\.0\.0\.1/.test(RPC)) throw new Error("dev-crank only runs against a local validator");

const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
);
const oracleFile = path.resolve(__dirname, "../keys/oracle-localnet.json");
const oracle = fs.existsSync(oracleFile)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(oracleFile, "utf8"))))
  : null;

/** One side's price for a boundary: a faked Pyth account, or a signed quote. */
async function sidePrice(
  feed: string,
  source: number,
  boundary: number,
): Promise<{ account: PublicKey | null; quote: TransactionInstruction[] }> {
  if (source !== SOURCE_SIGNED) return { account: await fakePrice(feed, boundary), quote: [] };
  if (!oracle) throw new Error("No keys/oracle-localnet.json; run the setup script");
  const ticker = byFeed(feed)?.ticker ?? "SPY";
  const q = { feed, boundary, price: devPrice(ticker, boundary), expo: DEV_EXPO, publishTime: boundary };
  return { account: null, quote: [signedQuoteInstruction(oracle, q)] };
}
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

async function send(...ixs: TransactionInstruction[]) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: "confirmed" });
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
    const c = await sidePrice(d.creatorFeed, d.creatorSource, boundary);
    const o = await sidePrice(d.opponentFeed, d.opponentSource, boundary);
    const sig = await send(...c.quote, ...o.quote, buildStartDuel(d, c.account, o.account));
    console.log(`start  ${d.address.toBase58().slice(0, 8)} ${sig.slice(0, 16)}...`);
  }
  for (const d of await byStatus(STATUS_LIVE)) {
    if (now < d.endTs + 1) continue;
    const c = await sidePrice(d.creatorFeed, d.creatorSource, d.endTs);
    const o = await sidePrice(d.opponentFeed, d.opponentSource, d.endTs);
    const sig = await send(...c.quote, ...o.quote, buildSettleDuel(d, payer.publicKey, c.account, o.account));
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
