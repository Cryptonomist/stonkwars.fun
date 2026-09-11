/* The permissionless cranks, as one function both hosts share: the long-running
 * scripts/settler.ts, and the /api/crank route an external cron pings.
 *
 *   ACCEPTED, past the start boundary  -> post the start prices, start_duel
 *   LIVE, past the bell                -> post the end prices, settle_duel
 *   VOID                               -> refund_duel
 *
 * IT DECIDES NOTHING, AND IT HOLDS NOTHING. The prices it posts are Pyth's,
 * signed, and the program accepts only the first price at or after each
 * boundary, so a crank chooses when a fight settles and never how. Its key pays
 * fees and the rent of the temporary price accounts, which come back when the
 * accounts close. No "server-only" import: scripts run this from Node too.
 */

import { Transaction, sendAndConfirmTransaction, type Connection, type Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import type { HermesClient } from "@pythnetwork/hermes-client";
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
} from "./duel";

/** Seconds past a boundary before trying: Pyth has to print, Hermes to index. */
export const GRACE_SECS = 3;

export type CrankJob = { duel: DuelView; kind: "start" | "settle" | "refund" };
export type CrankResult = { duel: string; kind: CrankJob["kind"]; ok: boolean; detail: string };

export async function pendingJobs(conn: Connection, now: number): Promise<CrankJob[]> {
  const fetch = async (status: number) =>
    (await conn.getProgramAccounts(PROGRAM_ID, { filters: duelsWithStatus(status) })).map((a) =>
      decodeDuel(a.pubkey, a.account.data),
    );
  const [accepted, live, voids] = await Promise.all([
    fetch(STATUS_ACCEPTED),
    fetch(STATUS_LIVE),
    fetch(STATUS_VOID),
  ]);
  return [
    ...accepted
      .filter((d) => now >= d.acceptedTs + START_DELAY_SECS + GRACE_SECS)
      .map((duel) => ({ duel, kind: "start" as const })),
    ...live.filter((d) => now >= d.endTs + GRACE_SECS).map((duel) => ({ duel, kind: "settle" as const })),
    ...voids.map((duel) => ({ duel, kind: "refund" as const })),
  ];
}

/** Post the boundary's signed prices and run start_duel or settle_duel. */
export async function postAndRun(opts: {
  conn: Connection;
  payer: Keypair;
  hermes: HermesClient;
  duel: DuelView;
  which: "start" | "settle";
  priorityMicroLamports?: number;
}): Promise<string[]> {
  const { conn, payer, hermes, duel: d, which } = opts;
  const boundary = which === "start" ? d.acceptedTs + START_DELAY_SECS : d.endTs;
  const update = await hermes.getPriceUpdatesAtTimestamp(boundary, [d.creatorFeed, d.opponentFeed], {
    encoding: "base64",
    parsed: true,
  });

  const parsed = update.parsed ?? [];
  if (parsed.length < 2) throw new Error(`Hermes has ${parsed.length}/2 prices after ${boundary}`);
  for (const p of parsed) {
    const prev = p.metadata?.prev_publish_time;
    if (!(typeof prev === "number" && prev < boundary && boundary <= p.price.publish_time)) {
      throw new Error(
        `Hermes returned a price that is not the first after ${boundary} for ${p.id.slice(0, 8)} (prev ${prev}, publish ${p.price.publish_time})`,
      );
    }
  }

  const receiver = new PythSolanaReceiver({ connection: conn, wallet: new Wallet(payer) });
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
    computeUnitPriceMicroLamports: opts.priorityMicroLamports ?? 20_000,
    tightComputeBudget: true,
  });
  return receiver.provider.sendAll(txs, { skipPreflight: true });
}

export async function refund(conn: Connection, payer: Keypair, d: DuelView): Promise<string> {
  const tx = new Transaction().add(buildRefundDuel(d, payer.publicKey));
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
}

/** One pass: every job that is due, up to `limit`, each isolated from the rest. */
export async function crankOnce(opts: {
  conn: Connection;
  payer: Keypair;
  hermes: HermesClient;
  now?: number;
  limit?: number;
  skip?: (key: string) => boolean;
}): Promise<CrankResult[]> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const jobs = (await pendingJobs(opts.conn, now)).filter((j) => !opts.skip?.(j.duel.address.toBase58()));
  const results: CrankResult[] = [];
  for (const job of jobs.slice(0, opts.limit ?? Infinity)) {
    const key = job.duel.address.toBase58();
    try {
      const detail =
        job.kind === "refund"
          ? await refund(opts.conn, opts.payer, job.duel)
          : (await postAndRun({ ...opts, duel: job.duel, which: job.kind })).slice(-1)[0] ?? "";
      results.push({ duel: key, kind: job.kind, ok: true, detail });
    } catch (e) {
      results.push({ duel: key, kind: job.kind, ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
  }
  return results;
}
