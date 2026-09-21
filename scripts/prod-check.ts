/* IS THE DEPLOYED CRANK KEEPING UP?
 *
 *   npx tsx scripts/prod-check.ts [seconds]
 *
 * Nothing on this machine may be taking fights while this runs, or it measures
 * itself. Takes a census of open challenges the sparring wallet ought to sweep
 * and of live fights past their bell, waits, and takes it again. What moved in
 * between was production doing it, because nothing here did.
 *
 * Reads chain state. Sends nothing. */

import fs from "fs";
import path from "path";
import { Connection } from "@solana/web3.js";

import {
  allDuels,
  decodeDuel,
  isInviteOnly,
  PROGRAM_ID,
  STATUS_LIVE,
  STATUS_OPEN,
  type DuelView,
} from "../src/lib/duel";
import { SPAR_OPEN_GRACE_SECS } from "../src/lib/spar";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const WAIT = Number(process.argv[2] ?? 180);
const SPAR = process.env.NEXT_PUBLIC_SPAR_WALLET ?? "";
const et = () => new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });

async function census(conn: Connection) {
  const now = Math.floor(Date.now() / 1000);
  const accts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allDuels() });
  const duels: DuelView[] = [];
  for (const a of accts) {
    try {
      duels.push(decodeDuel(a.pubkey, a.account.data));
    } catch {
      /* not a duel this build can read */
    }
  }
  /* Open, past the grace, not the sparring wallet's own: exactly what a tick
   * should be sweeping up. */
  const sweepable = new Set(
    duels
      .filter(
        (d) =>
          d.status === STATUS_OPEN &&
          !isInviteOnly(d) &&
          d.creator.toBase58() !== SPAR &&
          now - Number(d.createdTs) >= SPAR_OPEN_GRACE_SECS,
      )
      .map((d) => d.address.toBase58()),
  );
  /* Live and past the bell by a minute: what the settler should have closed. */
  const overdue = new Set(
    duels
      .filter((d) => d.status === STATUS_LIVE && Number(d.endTs) > 0 && now - Number(d.endTs) > 60)
      .map((d) => d.address.toBase58()),
  );
  return { sweepable, overdue, total: duels.length };
}

async function main() {
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const before = await census(conn);
  console.log(`${et()} ET  waiting ${WAIT}s. nothing on this machine is taking fights.`);
  console.log(`  open and ripe for the sweep: ${before.sweepable.size}`);
  console.log(`  live and past the bell:      ${before.overdue.size}`);

  await new Promise((r) => setTimeout(r, WAIT * 1000));

  const after = await census(conn);
  const swept = [...before.sweepable].filter((a) => !after.sweepable.has(a));
  const settled = [...before.overdue].filter((a) => !after.overdue.has(a));

  console.log("");
  console.log(`${et()} ET  after ${WAIT}s`);
  console.log(`  swept by production:   ${swept.length} of ${before.sweepable.size}`);
  console.log(`  settled by production: ${settled.length} of ${before.overdue.size}`);
  console.log(`  still open and ripe:   ${after.sweepable.size}`);
  console.log(`  still past the bell:   ${after.overdue.size}`);
  console.log("");
  console.log(
    swept.length || settled.length
      ? "VERDICT: the deployed crank is doing work."
      : "VERDICT: the deployed crank did nothing in this window.",
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
