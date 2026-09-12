/* Does the deployed program take a handle, and refuse a forged one?
 *
 *   RPC=https://api.devnet.solana.com npx tsx scripts/link-probe.ts
 *
 * Runs the real link_handle against whatever is deployed, with a throwaway
 * wallet, then unlinks so nothing is left behind. Checks the part that matters:
 * that the oracle's signature alone cannot name a wallet, and a wallet alone
 * cannot claim a handle. Needs the oracle key (keys/ or ORACLE_SECRET_KEY). */

import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { buildLinkHandle, buildUnlinkHandle, decodeProfile, decodeXClaim, profilePda, xClaimPda } from "../src/lib/duel";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
if (/mainnet/.test(RPC)) throw new Error("not against mainnet");

for (const line of fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const cluster = /localhost|127\.0\.0\.1/.test(RPC) ? "localnet" : "devnet";
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));
const conn = new Connection(RPC, "confirmed");
const admin = load(path.join(process.env.HOME ?? "", ".config/solana/id.json"));
const oracle = load(path.join(ROOT, `keys/oracle-${cluster}.json`));

const X_ID = 1_500_000_000_000_000_001n; // Nobody's: a probe, not a claim.
const HANDLE = "linkprobe";

const send = (ixs: Transaction["instructions"], signers: Keypair[]) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });

async function main() {
  const wallet = Keypair.generate();
  console.log(`probe wallet ${wallet.publicKey.toBase58()}`);
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet.publicKey, lamports: LAMPORTS_PER_SOL / 50 })], [admin]);

  const link = buildLinkHandle(wallet.publicKey, oracle.publicKey, X_ID, HANDLE);

  // The oracle alone must not be able to name a wallet.
  try {
    await send([link], [oracle]);
    throw new Error("FAIL: the oracle wrote a handle without the wallet");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FAIL")) throw e;
    console.log("refused without the wallet's signature: ok");
  }

  // And a wallet alone must not be able to claim one.
  try {
    await send([link], [wallet]);
    throw new Error("FAIL: a wallet claimed a handle with no oracle signature");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FAIL")) throw e;
    console.log("refused without the oracle's signature: ok");
  }

  await send([link], [wallet, oracle]);
  const profile = decodeProfile((await conn.getAccountInfo(profilePda(wallet.publicKey)))!.data);
  const claim = decodeXClaim((await conn.getAccountInfo(xClaimPda(X_ID)))!.data);
  console.log(`linked @${profile.handle} to ${profile.wallet.toBase58()}`);
  if (profile.handle !== HANDLE) throw new Error("the handle came back wrong");
  if (claim.wallet.toBase58() !== wallet.publicKey.toBase58()) throw new Error("the claim points elsewhere");
  console.log("the claim points back at the profile: ok");

  await send([buildUnlinkHandle(wallet.publicKey, X_ID)], [wallet]);
  if (await conn.getAccountInfo(profilePda(wallet.publicKey))) throw new Error("the profile outlived the unlink");
  if (await conn.getAccountInfo(xClaimPda(X_ID))) throw new Error("the claim outlived the unlink");
  console.log("unlinked, nothing left behind: ok");

  // Sweep the probe wallet's remaining SOL back.
  const left = await conn.getBalance(wallet.publicKey);
  if (left > 10_000) {
    await send([SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: admin.publicKey, lamports: left - 5_000 })], [wallet]);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
