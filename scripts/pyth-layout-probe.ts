/* Is the PriceUpdateV2 layout the program parses still the one on chain after
 * the Pyth Core upgrade? Read real accounts and parse them the way pyth.rs
 * does. Also: which equity feeds have a sponsored push account on Solana?
 *
 *   RPC=https://api.mainnet-beta.solana.com npx tsx scripts/pyth-layout-probe.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const PUSH_PROGRAM = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

const FEEDS: Record<string, string> = {
  "SOL/USD": "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  NVDA: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  AAPL: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  SPY: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
};

function pushAccount(feedHex: string, shard = 0): PublicKey {
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([shardBuf, Buffer.from(feedHex, "hex")], PUSH_PROGRAM)[0];
}

function parse(data: Buffer) {
  if (!data.subarray(0, 8).equals(DISC)) return { error: "discriminator mismatch", head: data.subarray(0, 16).toString("hex") };
  let at = 40;
  const level = data[at];
  at += level === 1 ? 1 : 2;
  const feed = data.subarray(at, at + 32).toString("hex");
  at += 32;
  const price = data.readBigInt64LE(at);
  at += 8;
  const conf = data.readBigUInt64LE(at);
  at += 8;
  const expo = data.readInt32LE(at);
  at += 4;
  const publish = Number(data.readBigInt64LE(at));
  at += 8;
  const prev = Number(data.readBigInt64LE(at));
  return { len: data.length, level: level === 1 ? "Full" : `Partial(${data[41]})`, feed, price, conf, expo, publish: new Date(publish * 1000).toISOString(), prevGap: publish - prev };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log("rpc", RPC.replace(/api-key=[^&]+/, "api-key=***"));
  for (const [name, feed] of Object.entries(FEEDS)) {
    const addr = pushAccount(feed);
    const info = await conn.getAccountInfo(addr);
    if (!info) {
      console.log(name.padEnd(8), addr.toBase58(), "no push account");
      continue;
    }
    console.log(name.padEnd(8), addr.toBase58(), "owner", info.owner.equals(RECEIVER) ? "receiver" : info.owner.toBase58());
    console.log("         ", parse(info.data));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
