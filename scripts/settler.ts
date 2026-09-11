/* The settler: the program's permissionless cranks, run on a timer.
 *
 *   RPC=... PYTH_API_KEY=... npx tsx scripts/settler.ts
 *
 * Every few seconds it looks for fights that need a hand:
 *
 *   ACCEPTED, two seconds past the accept  -> post the start prices, start_duel
 *   LIVE, past the bell                    -> post the end prices, settle_duel
 *   VOID                                   -> refund_duel
 *
 * IT DECIDES NOTHING, AND IT HOLDS NOTHING. The prices it posts are Pyth's,
 * signed, and the program accepts only the first price at or after each
 * boundary, so the settler can choose when a fight settles and never how. Its
 * key pays transaction fees and the rent of the temporary price accounts,
 * which it gets back when they close. Anyone can run this, or press the button
 * on the fight page that does the same thing.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import {
  buildRefundDuel,
  buildSettleDuel,
  buildStartDuel,
  decodeDuel,
  duelsWithStatus,
  PROGRAM_ID,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  type DuelView,
} from "../src/lib/duel";

loadEnvLocal();

const RPC = process.env.RPC ?? process.env.RPC_URL ?? "https://api.devnet.solana.com";
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? "5000");
const GRACE_SECS = 3; // let Pyth publish, and Hermes index, the first post-boundary print

const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8")),
  ),
);
const hermes = new HermesClient(process.env.HERMES_URL || "https://hermes.pyth.network", {
  accessToken: process.env.PYTH_API_KEY,
  timeout: 10_000,
});
const receiver = new PythSolanaReceiver({ connection: conn, wallet: new Wallet(payer) });

/** Fights we have given up on for this long, so one bad account does not spin. */
const backoff = new Map<string, number>();

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

async function fetchStatus(status: number): Promise<DuelView[]> {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { filters: duelsWithStatus(status) });
  return accounts.map((a) => decodeDuel(a.pubkey, a.account.data));
}

async function postAndRun(d: DuelView, which: "start" | "settle"): Promise<void> {
  const boundary = which === "start" ? d.acceptedTs + START_DELAY_SECS : d.endTs;
  const feeds = [d.creatorFeed, d.opponentFeed];
  const update = await hermes.getPriceUpdatesAtTimestamp(boundary, feeds, { encoding: "base64", parsed: true });

  const parsed = update.parsed ?? [];
  if (parsed.length < 2) throw new Error(`Hermes has ${parsed.length}/2 prices after ${boundary}`);
  for (const p of parsed) {
    const prev = p.metadata?.prev_publish_time;
    if (!(prev !== undefined && prev < boundary && boundary <= p.price.publish_time)) {
      throw new Error(
        `Hermes returned a price that is not the first after ${boundary} for ${p.id.slice(0, 8)} (prev ${prev}, publish ${p.price.publish_time})`,
      );
    }
  }

  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addPostPriceUpdates(update.binary.data);
  await builder.addPriceConsumerInstructions(async (get) => {
    const account = (feed: string) => {
      try {
        return get(`0x${feed}`);
      } catch {
        return get(feed);
      }
    };
    const c = account(d.creatorFeed);
    const o = account(d.opponentFeed);
    const instruction = which === "start" ? buildStartDuel(d, c, o) : buildSettleDuel(d, payer.publicKey, c, o);
    return [{ instruction, signers: [], computeUnits: which === "start" ? 60_000 : 300_000 }];
  });
  const txs = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: Number(process.env.PRIORITY_MICROLAMPORTS ?? "20000"),
    tightComputeBudget: true,
  });
  const sigs = await receiver.provider.sendAll(txs, { skipPreflight: true });
  log(`${which} ${d.address.toBase58().slice(0, 8)} in ${sigs.length} txs, last ${sigs[sigs.length - 1]}`);
}

async function refund(d: DuelView) {
  const tx = new Transaction().add(buildRefundDuel(d, payer.publicKey));
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  log(`refund ${d.address.toBase58().slice(0, 8)} ${sig}`);
}

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const [accepted, live, voids] = await Promise.all([
    fetchStatus(STATUS_ACCEPTED),
    fetchStatus(STATUS_LIVE),
    fetchStatus(STATUS_VOID),
  ]);

  const jobs: [DuelView, () => Promise<void>][] = [];
  for (const d of accepted) {
    if (now >= d.acceptedTs + START_DELAY_SECS + GRACE_SECS) jobs.push([d, () => postAndRun(d, "start")]);
  }
  for (const d of live) {
    if (now >= d.endTs + GRACE_SECS) jobs.push([d, () => postAndRun(d, "settle")]);
  }
  for (const d of voids) jobs.push([d, () => refund(d)]);

  for (const [d, job] of jobs) {
    const key = d.address.toBase58();
    if ((backoff.get(key) ?? 0) > Date.now()) continue;
    try {
      await job();
      backoff.delete(key);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      // A closed market or an unindexed print is routine: try again soon.
      backoff.set(key, Date.now() + (/404|not the first|Hermes has/i.test(msg) ? 15_000 : 60_000));
      log(`skip ${key.slice(0, 8)}: ${msg}`);
    }
  }
}

function loadEnvLocal() {
  const file = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  if (!process.env.PYTH_API_KEY) {
    console.error("PYTH_API_KEY is not set (env or .env.local). Hermes refuses price requests without one.");
    process.exit(1);
  }
  log(`settler ${payer.publicKey.toBase58()} on ${RPC.replace(/api[-_]?key=[^&]+/i, "api-key=***")}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log("tick failed:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
