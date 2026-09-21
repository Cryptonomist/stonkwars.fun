/* The numbers the submission should quote, counted from the chain.
 *
 *   npx tsx scripts/submission-numbers.ts
 *
 * Every figure here is one a judge could recount from the program's own
 * accounts, which is the point: the traction claim has to be checkable or it
 * is worth less than no claim at all.
 *
 * Reads chain state. Sends nothing. */

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
  SOURCE_PYTH,
  STATUS_SETTLED,
  type DuelView,
} from "../src/lib/duel";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const SPAR = process.env.NEXT_PUBLIC_SPAR_WALLET ?? "";

/** Midnight New York for the day a unix second falls in. */
const nyDay = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const [duelAccts, profileAccts, claimAccts] = await Promise.all([
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allDuels() }),
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allProfiles() }),
    conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allXClaims() }),
  ]);

  const claimedBy = new Map<string, string>();
  for (const c of claimAccts) {
    try {
      const claim = decodeXClaim(c.account.data);
      claimedBy.set(claim.xId.toString(), claim.wallet.toBase58());
    } catch {
      /* unreadable */
    }
  }
  const handleOf = new Map<string, string>();
  for (const p of profileAccts) {
    try {
      const pr = decodeProfile(p.account.data);
      if (claimedBy.get(pr.xId.toString()) === pr.wallet.toBase58()) handleOf.set(pr.wallet.toBase58(), pr.handle);
    } catch {
      /* unreadable */
    }
  }

  const duels: DuelView[] = [];
  for (const a of duelAccts) {
    try {
      duels.push(decodeDuel(a.pubkey, a.account.data));
    } catch {
      /* unreadable */
    }
  }

  const settled = duels.filter((d) => d.status === STATUS_SETTLED);
  const fighters = new Set<string>();
  const humanVsHuman = settled.filter((d) => {
    const a = d.creator.toBase58();
    const b = d.opponent.toBase58();
    for (const w of [a, b]) if (w !== SPAR && w !== PublicKey.default.toBase58()) fighters.add(w);
    return a !== SPAR && b !== SPAR && handleOf.has(a) && handleOf.has(b);
  });

  const byDay = new Map<string, number>();
  for (const d of duels) byDay.set(nyDay(Number(d.createdTs)), (byDay.get(nyDay(Number(d.createdTs))) ?? 0) + 1);
  const today = nyDay(Math.floor(Date.now() / 1000));

  const pythSettled = settled.filter((d) => d.creatorSource === SOURCE_PYTH || d.opponentSource === SOURCE_PYTH);

  console.log(`fights created, all time:        ${duels.length}`);
  console.log(`fights created today (${today}): ${byDay.get(today) ?? 0}`);
  console.log(`fights finished:                 ${settled.length}`);
  console.log(`distinct people who finished one: ${fighters.size}   (sparring wallet excluded)`);
  console.log(`X handles linked, both ways:     ${handleOf.size}`);
  console.log(`finished, both sides a named person: ${humanVsHuman.length}`);
  console.log("");
  console.log(`Pyth-settled fights: ${pythSettled.length}`);
  for (const d of pythSettled.slice(-3)) console.log(`  ${d.address.toBase58()}`);
  console.log("");
  console.log("fights created per day:");
  for (const [day, n] of [...byDay].sort()) console.log(`  ${day}  ${n}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
