/* WHO WOULD THE $HOLD GIVEAWAY PAY, IF IT PAID TODAY?
 *
 *   npx tsx scripts/winners.ts
 *
 * The gate: an X handle linked on chain, and at least one finished fight. One
 * payout per handle, not per fight, so nobody farms it by fighting the
 * sparring wallet all afternoon.
 *
 * A handle counts only when the link points both ways, which is the program's
 * own rule: the Profile names an X id, and that X id's claim names the same
 * wallet back. A profile left behind by somebody moving wallets goes quiet on
 * its own, and a handle nobody proved cannot be paid.
 *
 * The sparring wallet is disclosed and left off the ranks, so it is left out
 * here too. It is also read-only: it reads chain state and pays nobody. */

import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  allDuels,
  allProfiles,
  allXClaims,
  decodeDuel,
  decodeProfile,
  decodeXClaim,
  PROGRAM_ID,
  STATUS_SETTLED,
  type DuelView,
} from "../src/lib/duel";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const SPAR = process.env.NEXT_PUBLIC_SPAR_WALLET ?? "";

async function main() {
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");

  const [duelAccts, profileAccts, claimAccts] = await Promise.all([
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allDuels() }),
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allProfiles() }),
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allXClaims() }),
  ]);

  /* Both directions, or it does not count. */
  const claimedBy = new Map<string, string>();
  for (const c of claimAccts) {
    try {
      const claim = decodeXClaim(c.account.data);
      claimedBy.set(claim.xId.toString(), claim.wallet.toBase58());
    } catch {
      /* not a claim this build can read */
    }
  }
  const handleOf = new Map<string, string>();
  for (const p of profileAccts) {
    try {
      const profile = decodeProfile(p.account.data);
      const wallet = profile.wallet.toBase58();
      if (claimedBy.get(profile.xId.toString()) === wallet) handleOf.set(wallet, profile.handle);
    } catch {
      /* not a profile this build can read */
    }
  }

  const duels: DuelView[] = [];
  for (const d of duelAccts) {
    try {
      duels.push(decodeDuel(d.pubkey, d.account.data));
    } catch {
      /* not a duel this build can read */
    }
  }
  const settled = duels.filter((d) => d.status === STATUS_SETTLED);

  /* Every wallet that finished a fight, and how many it finished. */
  const fights = new Map<string, number>();
  for (const d of settled) {
    for (const w of [d.creator.toBase58(), d.opponent.toBase58()]) {
      if (w === SPAR || w === PublicKey.default.toBase58()) continue;
      fights.set(w, (fights.get(w) ?? 0) + 1);
    }
  }

  const paid: { handle: string; wallet: string; fights: number }[] = [];
  const unnamed: { wallet: string; fights: number }[] = [];
  for (const [wallet, n] of fights) {
    const handle = handleOf.get(wallet);
    if (handle) paid.push({ handle, wallet, fights: n });
    else unnamed.push({ wallet, fights: n });
  }
  paid.sort((a, b) => b.fights - a.fights || a.handle.localeCompare(b.handle));
  unnamed.sort((a, b) => b.fights - a.fights);

  console.log(`fights on chain: ${duels.length} total, ${settled.length} finished`);
  console.log(`handles linked (both ways): ${handleOf.size}`);
  console.log(`wallets that finished a fight: ${fights.size}${SPAR ? " (sparring wallet excluded)" : ""}`);
  console.log("");
  console.log(`WOULD BE PAID TODAY: ${paid.length}`);
  for (const p of paid) console.log(`  @${p.handle.padEnd(16)} ${p.wallet}  ${p.fights} finished`);
  console.log("");
  console.log(`FOUGHT BUT NO HANDLE (the gap to close): ${unnamed.length}`);
  for (const u of unnamed.slice(0, 20)) console.log(`  ${u.wallet}  ${u.fights} finished`);

  /* Linked but never finished a fight: one nudge away from qualifying. */
  const idle = [...handleOf.entries()].filter(([w]) => !fights.has(w));
  console.log("");
  console.log(`LINKED BUT NO FINISHED FIGHT: ${idle.length}`);
  for (const [w, h] of idle.slice(0, 20)) console.log(`  @${h.padEnd(16)} ${w}`);

  /* IS THIS AN AUDIENCE, OR IS IT ME TESTING?
   *
   * A fight the sparring wallet is in had no second person in it, and fights
   * bunched on the days work happened are development, not demand. Worth
   * knowing before reading 48 wallets as 48 people. */
  const withSpar = settled.filter((d) => [d.creator.toBase58(), d.opponent.toBase58()].includes(SPAR)).length;
  const byDay = new Map<string, number>();
  for (const d of settled) {
    const day = new Date(Number(d.createdTs) * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  console.log("");
  console.log(`finished fights involving the sparring wallet: ${withSpar} of ${settled.length}`);
  console.log("finished fights by day created:");
  for (const [day, n] of [...byDay].sort()) console.log(`  ${day}  ${n}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
