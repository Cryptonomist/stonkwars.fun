import "server-only";

import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";

import { PROGRAM_ID, profilePda } from "@/lib/duel";
import { MEMO_PROGRAM_ID, readAvatarMemo } from "@/lib/xLink";

/* A fighter's X picture, as the chain records it.
 *
 * The picture is a memo in the transaction that linked the handle (see
 * app/api/x/attest). That transaction only lands if the program accepted the
 * oracle's signature on it, so a memo found beside a successful link_handle
 * for this wallet is one the oracle vouched for. Only the newest link counts:
 * linking again without a picture clears it, and an unlinked wallet (its
 * profile account closed) has none.
 *
 * Nothing here is stored. Answers are kept in memory for a few minutes, and the
 * route in front of this caches the image itself. */

const LINK_DISCRIMINATOR = crypto.createHash("sha256").update("global:link_handle").digest().subarray(0, 8);
const TTL_MS = 5 * 60_000;
/** A wallet with no picture yet is asked about again soon: it may be linking right now. */
const NONE_TTL_MS = 20_000;
const seen = new Map<string, { at: number; url: string | null }>();

const connection = () => new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");

export async function avatarUrlFor(wallet: PublicKey): Promise<string | null> {
  const key = wallet.toBase58();
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < (hit.url ? TTL_MS : NONE_TTL_MS)) return hit.url;
  const url = await lookup(wallet).catch(() => null);
  seen.set(key, { at: Date.now(), url });
  return url;
}

async function lookup(wallet: PublicKey): Promise<string | null> {
  const conn = connection();
  const profile = profilePda(wallet);
  if (!(await conn.getAccountInfo(profile, "confirmed"))) return null;

  const sigs = await conn.getSignaturesForAddress(profile, { limit: 20 }, "confirmed");
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) continue;
    const message = tx.transaction.message;
    const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).staticAccountKeys;
    let linked = false;
    let memo: string | null = null;
    for (const ix of message.compiledInstructions) {
      const program = keys[ix.programIdIndex]?.toBase58();
      const data = Buffer.from(ix.data);
      if (program === PROGRAM_ID.toBase58() && data.subarray(0, 8).equals(LINK_DISCRIMINATOR)) {
        linked = keys[ix.accountKeyIndexes[0]]?.equals(wallet) ?? false;
      } else if (program === MEMO_PROGRAM_ID) {
        memo = data.toString("utf8");
      }
    }
    // The newest successful link decides, picture or not.
    if (linked) return readAvatarMemo(memo);
  }
  return null;
}
