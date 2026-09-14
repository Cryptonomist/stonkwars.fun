/* THE HANDLE THE CHAIN VOUCHES FOR, READ ON THE SERVER.
 *
 * The same test useProfiles applies in the browser: a Profile names an X
 * account, and it only counts while that X account's claim points back at the
 * same wallet. A profile left behind when somebody moved wallets goes quiet on
 * its own, and a page title or share card must not resurrect it.
 *
 * Bounded, because a title and a share card must never hang on a slow node:
 * past the deadline, or on any error, the answer is "no handle" and the caller
 * shows the wallet's short address, which is true either way. */

import { Connection, PublicKey } from "@solana/web3.js";

import { decodeProfile, decodeXClaim, profilePda, PROGRAM_ID, xClaimPda } from "@/lib/duel";

export const serverConnection = () =>
  new Connection(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com");

export async function readVouchedHandle(conn: Connection, wallet: PublicKey, ms: number): Promise<string | null> {
  const read = (async () => {
    const info = await conn.getAccountInfo(profilePda(wallet), "confirmed");
    if (!info || !info.owner.equals(PROGRAM_ID)) return null;
    const profile = decodeProfile(info.data);
    if (!profile.wallet.equals(wallet)) return null;
    const claim = await conn.getAccountInfo(xClaimPda(profile.xId), "confirmed");
    if (!claim || !claim.owner.equals(PROGRAM_ID)) return null;
    return decodeXClaim(claim.data).wallet.equals(wallet) ? profile.handle : null;
  })().catch(() => null);
  return withDeadline(read, ms, null);
}

/** `work`, or `fallback` once `ms` have passed. */
export function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
