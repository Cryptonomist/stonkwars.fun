/* The permissionless cranks, as one function both hosts share: the long-running
 * scripts/settler.ts, and the /api/crank route an external cron pings.
 *
 *   ACCEPTED, past the start boundary  -> post the start prices, start_duel
 *   LIVE, past the bell                -> post the end prices, settle_duel
 *   VOID                               -> refund_duel
 *
 * IT DECIDES NOTHING, AND IT HOLDS NOTHING. A Pyth side's price is Pyth's,
 * signed by Pyth, and the program accepts only the first price at or after
 * each boundary. A signed side's price is the oracle's answer to the same
 * question, from completed minute bars (see oracle.ts). Either way a crank
 * chooses when a fight settles and never how. Its key pays fees and the rent
 * of the temporary price accounts, which come back when the accounts close.
 * No "server-only" import: scripts run this from Node too.
 */

import {
  ComputeBudgetProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import type { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { boundaryOf, crankTransactions, fightUnits, pythFeedsOf, sendInOrder } from "./crankTx";
import {
  buildRefundDuel,
  buildSettleDuel,
  buildStartDuel,
  decodeDuel,
  duelsWithStatus,
  PROGRAM_ID,
  readableProgramError,
  SOURCE_SIGNED,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  type DuelView,
} from "./duel";
import { quoteAt, signedQuoteInstruction } from "./oracle";

export { boundaryOf, crankTransactions, pythFeedsOf, type SignedTx } from "./crankTx";

/** Where the oracle finds a signed stock's price, by feed id: its symbol at
 * the market data source, the currency that source quotes it in, and the
 * Solana pool that prices it while its exchange is shut. */
export type QuoteSymbol = (
  feed: string,
) => { symbol: string; currency: string; market?: string; pool?: string } | undefined;

/** A job that cannot run yet and should be retried, not reported as broken. */
export class NotYet extends Error {}

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

/** The Ed25519 instructions carrying the oracle's quotes for a duel's signed
 * sides at a boundary. Throws NotYet while a minute bar is still forming. */
export async function signedQuotes(opts: {
  duel: DuelView;
  boundary: number;
  oracle?: Keypair;
  quoteSymbol: QuoteSymbol;
}): Promise<TransactionInstruction[]> {
  const { duel: d, boundary } = opts;
  const feeds = [
    d.creatorSource === SOURCE_SIGNED ? d.creatorFeed : null,
    d.opponentSource === SOURCE_SIGNED ? d.opponentFeed : null,
  ].filter((f): f is string => f !== null);
  if (feeds.length === 0) return [];

  const oracle = opts.oracle;
  if (!oracle) throw new Error("This fight has a signed side and this crank holds no oracle key");
  if (!oracle.publicKey.equals(d.oracle)) {
    throw new Error(`This fight trusts oracle ${d.oracle.toBase58()}; this crank holds ${oracle.publicKey.toBase58()}`);
  }
  const out: TransactionInstruction[] = [];
  for (const feed of feeds) {
    const market = opts.quoteSymbol(feed);
    if (!market) throw new Error(`No market symbol for feed ${feed.slice(0, 8)}`);
    const q = await quoteAt({ feed, ...market, boundary });
    if (!q) throw new NotYet(`${market.symbol}: waiting for the price at ${boundary} to be final`);
    out.push(signedQuoteInstruction(oracle, q));
  }
  return out;
}

/** Hermes' update data for the fight's Pyth sides at a boundary, checked to be
 * the unique first price after it (the program would refuse anything else). */
export async function pythUpdateAt(hermes: HermesClient | undefined, d: DuelView, boundary: number): Promise<string[]> {
  const feeds = pythFeedsOf(d);
  if (!feeds.length) return [];
  if (!hermes) throw new Error("This fight has a Pyth side and this crank has no Pyth key");
  const update = await hermes.getPriceUpdatesAtTimestamp(boundary, feeds, { encoding: "base64", parsed: true });
  const parsed = update.parsed ?? [];
  if (parsed.length < feeds.length) throw new NotYet(`Hermes has ${parsed.length}/${feeds.length} prices after ${boundary}`);
  for (const p of parsed) {
    const prev = p.metadata?.prev_publish_time;
    if (!(typeof prev === "number" && prev < boundary && boundary <= p.price.publish_time)) {
      throw new Error(
        `Hermes returned a price that is not the first after ${boundary} for ${p.id.slice(0, 8)} (prev ${prev}, publish ${p.price.publish_time})`,
      );
    }
  }
  return update.binary.data;
}

/** Post the boundary's prices and run start_duel or settle_duel: Pyth updates
 * for Pyth sides, the oracle's signed quotes for signed sides. */
export async function postAndRun(opts: {
  conn: Connection;
  payer: Keypair;
  hermes?: HermesClient;
  oracle?: Keypair;
  quoteSymbol: QuoteSymbol;
  duel: DuelView;
  which: "start" | "settle";
  priorityMicroLamports?: number;
}): Promise<string[]> {
  const { conn, payer, duel: d, which } = opts;
  const boundary = boundaryOf(d, which);
  const quotes = await signedQuotes({ ...opts, boundary });
  const pythUpdate = await pythUpdateAt(opts.hermes, d, boundary);

  // Both sides signed: one ordinary transaction, no Pyth at all.
  if (!pythUpdate.length) {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: fightUnits(which, quotes.length) }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.priorityMicroLamports ?? 20_000 }),
      ...quotes,
      which === "start" ? buildStartDuel(d, null, null) : buildSettleDuel(d, payer.publicKey, null, null),
    );
    return [await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" })];
  }

  const receiver = new PythSolanaReceiver({ connection: conn, wallet: new Wallet(payer) });
  const txs = await crankTransactions({
    conn,
    receiver,
    payer: payer.publicKey,
    duel: d,
    which,
    pythUpdate,
    quotes,
    priorityMicroLamports: opts.priorityMicroLamports,
  });
  for (const { tx, signers } of txs) tx.sign([payer, ...signers]);
  return sendInOrder(conn, txs.map((t) => t.tx));
}

export async function refund(conn: Connection, payer: Keypair, d: DuelView): Promise<string> {
  const tx = new Transaction().add(buildRefundDuel(d, payer.publicKey));
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
}

/** One pass: every job that is due, up to `limit`, each isolated from the rest. */
export async function crankOnce(opts: {
  conn: Connection;
  payer: Keypair;
  hermes?: HermesClient;
  oracle?: Keypair;
  quoteSymbol: QuoteSymbol;
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
      /* A failed send can arrive as web3.js's "Unknown action 'undefined'"
       * with the program's logs attached; the logs say what actually went
       * wrong. */
      const detail = readableProgramError(e);
      results.push({ duel: key, kind: job.kind, ok: false, detail: e instanceof NotYet ? `not yet: ${detail}` : detail });
    }
  }
  return results;
}
