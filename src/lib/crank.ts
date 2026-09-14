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
  VersionedTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";
import type { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import {
  boundaryOf,
  CLEANUP_GRACE_MS,
  crankTransactionParts,
  fightUnits,
  pythFeedsOf,
  sendInOrder,
  sendSigned,
  SendFailed,
} from "./crankTx";
import {
  buildRefundDuel,
  buildSettleDuel,
  buildStartDuel,
  decodeDuel,
  duelsWithStatus,
  PROGRAM_ID,
  readableProgramError,
  SOURCE_SIGNED,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  type DuelView,
} from "./duel";
import {
  BAR_SETTLE_SECS,
  exchangeBarFinal,
  firstBarEnd,
  poolWindowThin,
  quoteAt,
  signedQuoteInstruction,
  sourceAt,
} from "./oracle";
import { readyAt as clockReadyAt, PYTH_GRACE_SECS, type MarketLookup, type ReadyWhy } from "./priceClock";
import { quoteSymbolFor } from "./stocks";

export { boundaryOf, crankTransactions, pythFeedsOf, type SignedTx } from "./crankTx";

/** Where the oracle finds a signed stock's price, by feed id: its symbol at
 * the market data source, the currency that source quotes it in, and the
 * Solana pool and perpetual market that price it while its exchange is shut. */
export type QuoteSymbol = (
  feed: string,
) => { symbol: string; currency: string; market?: string; pool?: string; perp?: string } | undefined;

/** A job that cannot run yet and should be retried, not reported as broken.
 *  `readyAt` (unix seconds), when known, is the earliest worth trying again. */
export class NotYet extends Error {
  constructor(
    message: string,
    readonly readyAt?: number,
  ) {
    super(message);
    this.name = "NotYet";
  }
}

/** The job is already done: the duel's status moved, or the program said so in
 *  preflight, and nothing was paid for finding out. */
export class AlreadyDone extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyDone";
  }
}

/* THE PYTH RECEIVER WANTS A WALLET, NOT A KEYPAIR.
 *
 * Anchor ships one, but only as a CommonJS export: bundled for the server as
 * ESM, `Wallet` comes through undefined and constructing it throws, which is a
 * failure that shows up in production and nowhere else. It is three methods,
 * so we write them here and depend on nothing.
 *
 * It signs whatever it is handed and holds no policy: the caller decides what
 * a crank sends. */
function keypairWallet(payer: Keypair): Wallet {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([payer]);
    else tx.partialSign(payer);
    return tx;
  };
  return {
    publicKey: payer.publicKey,
    payer,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  } as Wallet;
}

const nowSecs = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/* Timers run on the monotonic clock and readyAt is wall-clock time, and the
 * two drift: a timer can come back a millisecond before Date.now() reaches its
 * mark, and under WSL the wall clock is stepped by whole seconds. So a wait for
 * a price checks the wall clock when it wakes and sleeps the rest if it is
 * early, rather than asking for a price a moment before it can exist. */
async function sleepUntil(ms: number): Promise<void> {
  while (Date.now() < ms) await sleep(ms - Date.now());
}

/* ─── What is due ──────────────────────────────────────────────────────────── */

export type JobKind = "start" | "settle" | "refund";
/** A job, with the earliest unix second its prices can exist (priceClock).
 *  `since` is when it became due, a time that does not move with the clock,
 *  for ordering (chooseJobs); readyAt is when to wake for it, and for a refund
 *  that is simply now. Without `since`, readyAt stands in. */
export type CrankJob = { duel: DuelView; kind: JobKind; readyAt: number; why: ReadyWhy | "refund"; since?: number };
/** A job whose market is shut: nothing can price it, so nothing is tried. */
export type ParkedJob = { duel: string; kind: "start" | "settle"; shut: string[] };
export type JobListing = { due: CrankJob[]; parked: ParkedJob[]; errors: string[] };

const STATUS_FOR: Record<JobKind, number> = { start: STATUS_ACCEPTED, settle: STATUS_LIVE, refund: STATUS_VOID };

/* EVERYTHING THAT IS DUE, AND NOTHING THAT CANNOT RUN.
 *
 * Three lists, one per status. They used to be read with Promise.all, so one
 * rate-limited read failed the whole pass with a 500, and enough of those in a
 * row got the cron job switched off. Now each list stands alone: a pass with
 * two of three still does the work in those two, and only a pass that can read
 * nothing at all throws. An account that will not decode is skipped and named,
 * rather than taking its whole list down with it.
 *
 * Each job carries the price clock's readyAt. A job is due once that time is
 * within `lookaheadSecs` of now, so a pass can wait for a price about to exist
 * instead of leaving it to the next ping a minute later. GRACE_SECS, the old
 * fixed "boundary plus three seconds", is gone: a minute-bar price is not
 * final until forty-odd seconds after that, and treating it as due early spent
 * the pass on a certain "not yet".
 *
 * A job whose market is shut is PARKED, not due: it gets no Hermes call, no
 * price source call and no slot. Before this, a Pyth fight accepted on a
 * Saturday (4yf7) was tried, and refused, on every pass all weekend. */
export async function listJobs(
  conn: Connection,
  now: number,
  opts: { lookaheadSecs?: number; lookup?: MarketLookup } = {},
): Promise<JobListing> {
  const lookahead = opts.lookaheadSecs ?? 0;
  const lookup = opts.lookup ?? quoteSymbolFor;
  const errors: string[] = [];

  const read = async (status: number) => {
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, { filters: duelsWithStatus(status) });
    return accounts.flatMap((a) => {
      try {
        return [decodeDuel(a.pubkey, a.account.data)];
      } catch (e) {
        errors.push(`${a.pubkey.toBase58()}: does not decode (${e instanceof Error ? e.message : e})`);
        return [];
      }
    });
  };
  const kinds: JobKind[] = ["start", "settle", "refund"];
  const lists = await Promise.allSettled(kinds.map((k) => read(STATUS_FOR[k])));
  const failed = lists.flatMap((l, i) => (l.status === "rejected" ? [`${kinds[i]} list: ${readableProgramError(l.reason)}`] : []));
  if (failed.length === lists.length) throw new Error(`Could not list any duels: ${failed.join("; ")}`);
  errors.unshift(...failed);

  const due: CrankJob[] = [];
  const parked: ParkedJob[] = [];
  lists.forEach((list, i) => {
    if (list.status !== "fulfilled") return;
    const kind = kinds[i];
    for (const duel of list.value) {
      if (kind === "refund") {
        /* A duel is voided only by start_duel, which records the price time it
         * found (start_ts) before deciding the start came too late: that is
         * when the refund became due, and it stays put. */
        due.push({ duel, kind, readyAt: now, why: "refund", since: duel.startTs || boundaryOf(duel, "start") });
        continue;
      }
      // A settle is not a job before its bell, however close the bell is.
      const boundary = boundaryOf(duel, kind);
      if (kind === "settle" && now + lookahead < boundary) continue;
      const clock = clockReadyAt(duel, kind, now, lookup);
      if ("shut" in clock) {
        parked.push({ duel: duel.address.toBase58(), kind, shut: clock.shut });
        continue;
      }
      // Never earlier than the boundary itself, whatever a session rule says.
      const at = Math.max(clock.at, boundary);
      if (at <= now + lookahead) due.push({ duel, kind, readyAt: at, why: clock.why, since: at });
    }
  });
  return { due, parked, errors };
}

/** The jobs that are due now (or within `lookaheadSecs`). */
export async function pendingJobs(
  conn: Connection,
  now: number,
  opts: { lookaheadSecs?: number; lookup?: MarketLookup } = {},
): Promise<CrankJob[]> {
  return (await listJobs(conn, now, opts)).due;
}

/* ─── Prices ───────────────────────────────────────────────────────────────── */

/* When to ask again after the oracle said "not yet". Before the clock's time,
 * at the clock's time. After it, the price is late: for a bar that means the
 * minute had no trade and the price moved to a later bar, which cannot be
 * final before the next bar closes and settles, so asking every second and a
 * half until then would only be load on somebody else's API. A pool or Pyth
 * side that is late is asked again a few seconds on.
 *
 * A POOL TOO QUIET TO PRICE WAITS FOR THE EXCHANGE, NOT FIVE SECONDS. The
 * oracle then falls back to the exchange's first bar after the boundary, which
 * cannot exist before the exchange opens: on a Saturday, that is Monday. The
 * clock cannot see this (it would have to read the pool), so it keeps calling
 * the side due at boundary + 20, and retrying it every five seconds meant a
 * page open all weekend kept a function busy asking for a price all weekend.
 * Once this instance has read the pool and found it thin, the retry is the
 * exchange's own time. A pool this instance was told to stop asking (a rate
 * limit) has not been read, and is retried a few seconds on as before.
 * Exported for tests. */
export function retryAt(
  d: DuelView,
  which: "start" | "settle",
  now: number,
  lookup: MarketLookup,
  side?: { market?: string; pool?: string; perp?: string },
): number | undefined {
  const boundary = boundaryOf(d, which);
  if (side?.pool && sourceAt(boundary, side) === "pool" && poolWindowThin(side.pool, boundary)) {
    const final = exchangeBarFinal(boundary, side.market);
    if (final !== null) return final > now ? final : firstBarEnd(now - BAR_SETTLE_SECS) + BAR_SETTLE_SECS;
  }
  const clock = clockReadyAt(d, which, now, lookup);
  if ("shut" in clock) return undefined;
  if (clock.at > now) return clock.at;
  if (clock.why === "minute-close") return firstBarEnd(now - BAR_SETTLE_SECS) + BAR_SETTLE_SECS;
  return now + 5;
}

/** The Ed25519 instructions carrying the oracle's quotes for a duel's signed
 * sides at a boundary. Throws NotYet, with when to try again, while a minute
 * bar is still forming. */
export async function signedQuotes(opts: {
  duel: DuelView;
  boundary: number;
  which?: "start" | "settle";
  oracle?: Keypair;
  quoteSymbol: QuoteSymbol;
  /** The oracle's quote function; tests pass a stub. */
  quoteAt?: typeof quoteAt;
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
  const quote = opts.quoteAt ?? quoteAt;
  const which = opts.which ?? (boundary === d.endTs ? "settle" : "start");
  // Both sides at once: they are different sources, and neither waits on the other.
  const settled = await Promise.allSettled(
    feeds.map(async (feed) => {
      const market = opts.quoteSymbol(feed);
      if (!market) throw new Error(`No market symbol for feed ${feed.slice(0, 8)}`);
      const q = await quote({ feed, ...market, boundary });
      if (!q) {
        const now = nowSecs();
        throw new NotYet(
          `${market.symbol}: waiting for the price at ${boundary} to be final`,
          retryAt(d, which, now, opts.quoteSymbol, market),
        );
      }
      return signedQuoteInstruction(oracle, q);
    }),
  );
  /* A broken side is reported first, since waiting will not mend it. Two
   * sides that are both waiting wait for the later of them: the fight needs
   * both, and asking at the earlier time only earns another "not yet". */
  const broken = settled.find((s): s is PromiseRejectedResult => s.status === "rejected" && !(s.reason instanceof NotYet));
  if (broken) throw broken.reason;
  const waits = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as NotYet] : []));
  if (waits.length) {
    const times = waits.flatMap((w) => (w.readyAt === undefined ? [] : [w.readyAt]));
    throw new NotYet(waits.map((w) => w.message).join("; "), times.length ? Math.max(...times) : undefined);
  }
  return settled.map((s) => (s as PromiseFulfilledResult<TransactionInstruction>).value);
}

/** Hermes' update data for the fight's Pyth sides at a boundary, checked to be
 * the unique first price after it (the program would refuse anything else). */
export async function pythUpdateAt(hermes: HermesClient | undefined, d: DuelView, boundary: number): Promise<string[]> {
  const feeds = pythFeedsOf(d);
  if (!feeds.length) return [];
  if (!hermes) throw new Error("This fight has a Pyth side and this crank has no Pyth key");
  let update: Awaited<ReturnType<HermesClient["getPriceUpdatesAtTimestamp"]>>;
  try {
    update = await hermes.getPriceUpdatesAtTimestamp(boundary, feeds, { encoding: "base64", parsed: true });
  } catch (e) {
    /* Just past a boundary, Hermes answers 404 until it has indexed the first
     * print after it. The price clock has already parked every side whose
     * market is shut, so a 404 here is Hermes being a moment behind. */
    if (/status: 404/.test(e instanceof Error ? e.message : String(e))) {
      throw new NotYet(`Hermes has no price after ${boundary} yet`, nowSecs() + PYTH_GRACE_SECS);
    }
    throw e;
  }
  const parsed = update.parsed ?? [];
  if (parsed.length < feeds.length) {
    throw new NotYet(`Hermes has ${parsed.length}/${feeds.length} prices after ${boundary}`, nowSecs() + PYTH_GRACE_SECS);
  }
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

/* ─── Sending ──────────────────────────────────────────────────────────────── */

/* THE PROGRAM'S REFUSAL WHEN A JOB HAS ALREADY BEEN DONE BY SOMEBODY ELSE.
 *
 * start_duel checks the status first, so a start that lost the race is
 * refused with NotAccepted. settle_duel and refund_duel are different: both
 * close the duel's two escrow accounts, so a second one never reaches its
 * status check. Anchor refuses it while loading accounts, with
 * AccountNotInitialized on creator_escrow (tests/duel.ts pins exactly that for
 * a second settlement). An escrow is open from the accept until the settle or
 * refund, so on this path a missing escrow can only mean the job is done.
 * NotLive and NotRefundable stay for completeness. */
const ESCROW_GONE = /caused by account: (?:creator|opponent)_escrow\. Error Code: AccountNotInitialized\b/;
const DONE_CODE: Record<JobKind, RegExp> = {
  start: /Error Code: NotAccepted\b/,
  settle: new RegExp(`Error Code: NotLive\\b|${ESCROW_GONE.source}`),
  refund: new RegExp(`Error Code: NotRefundable\\b|${ESCROW_GONE.source}`),
};

/* A refusal of the fight transaction in preflight is also read against the
 * duel itself: if its status has moved, somebody else did the job, whatever
 * words the refusal used. Preflight ran at "confirmed", and so does this read,
 * so the two see the same chain. Nothing was paid either way. */
async function throwIfAlreadyDone(conn: Connection, d: DuelView, kind: JobKind, e: unknown, fightIndex: number): Promise<void> {
  if (!(e instanceof SendFailed) || e.stage !== "preflight" || e.index !== fightIndex) return;
  const done = `already ${kind === "start" ? "started" : kind === "settle" ? "settled" : "refunded"}; refused in preflight, nothing paid`;
  if (DONE_CODE[kind].test([e.message, ...e.logs].join("\n"))) throw new AlreadyDone(done);
  const info = await conn.getAccountInfo(d.address, "confirmed").catch(() => undefined);
  if (info === null || (info && decodeDuel(d.address, info.data).status !== STATUS_FOR[kind])) throw new AlreadyDone(done);
}

/** Say whether a send failure stopped on the fight transaction itself. */
function markFight(e: unknown, fightIndex: number): unknown {
  if (e instanceof SendFailed) e.fight = e.index === fightIndex;
  return e;
}

export type CrankContext = {
  conn: Connection;
  payer: Keypair;
  hermes?: HermesClient;
  oracle?: Keypair;
  quoteSymbol: QuoteSymbol;
  priorityMicroLamports?: number;
  /** The oracle's quote function; tests pass a stub. */
  quoteAt?: typeof quoteAt;
};

/** The confirmation wait after a send, inside whatever deadline the caller has. */
export const CONFIRM_WAIT_MS = 25_000;
/* What one transaction of a Pyth crank is budgeted to be sent and confirmed
 * in. Confirmation is polled every 700ms and devnet usually confirms in one to
 * three seconds; this leaves room for a slow slot without letting a crank
 * begin a chain of posts it cannot see through. */
export const PYTH_MS_PER_TX = 5_000;

/** Told as each transaction goes out, and whether it is the fight transaction
 *  (a Pyth crank sends its price posts first). */
export type OnSent = (signature: string, fight: boolean) => void;

/** Post the boundary's prices and run start_duel or settle_duel: Pyth updates
 * for Pyth sides, the oracle's signed quotes for signed sides. Sent with
 * preflight on, so a fight somebody else already moved costs nothing and comes
 * back as AlreadyDone. Returns the fight transaction's signature, and every
 * signature in the order sent (posts, fight, closes). */
export async function postAndRun(
  opts: CrankContext & {
    duel: DuelView;
    which: "start" | "settle";
    /** A Date.now() time to stop waiting for confirmation by. Nothing is sent
     *  after it. */
    deadlineMs?: number;
    /** Told as each transaction goes out: from then on, it may land. */
    onSent?: OnSent;
    /** Asked right before each send; false holds it back (see sendSigned). */
    maySend?: () => boolean;
  },
): Promise<{ signature: string; signatures: string[] }> {
  const { conn, payer, duel: d, which } = opts;
  const boundary = boundaryOf(d, which);
  const quotes = await signedQuotes({ ...opts, boundary, which });
  const pythUpdate = await pythUpdateAt(opts.hermes, d, boundary);
  const confirmBy = Math.min(opts.deadlineMs ?? Infinity, Date.now() + CONFIRM_WAIT_MS);

  // Both sides signed: one ordinary transaction, no Pyth at all.
  if (!pythUpdate.length) {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: fightUnits(which, quotes.length) }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.priorityMicroLamports ?? 20_000 }),
      ...quotes,
      which === "start" ? buildStartDuel(d, null, null) : buildSettleDuel(d, payer.publicKey, null, null),
    );
    const latest = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    try {
      const signature = await sendSigned(conn, tx, {
        preflight: true,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        deadlineMs: confirmBy,
        maySend: opts.maySend,
        onSent: (sig) => opts.onSent?.(sig, true),
      });
      return { signature, signatures: [signature] };
    } catch (e) {
      await throwIfAlreadyDone(conn, d, which, e, 0);
      throw markFight(e, 0);
    }
  }

  /* A PYTH SIDE COSTS REAL MONEY BEFORE THE FIGHT TRANSACTION IS EVEN TRIED.
   *
   * Posting prices pays fees and holds rent, and the Hermes fetch and the
   * build take seconds, in which somebody else may have started or settled
   * the fight. So the status is read once more right before anything goes out,
   * and the closes are sent whatever happens to the fight. */
  const receiver = new PythSolanaReceiver({ connection: conn, wallet: keypairWallet(payer) });
  const parts = await crankTransactionParts({
    conn,
    receiver,
    payer: payer.publicKey,
    duel: d,
    which,
    pythUpdate,
    quotes,
    priorityMicroLamports: opts.priorityMicroLamports,
  });
  const all = [...parts.post, parts.fight, ...parts.close];
  for (const { tx, signers } of all) tx.sign([payer, ...signers]);
  const fightIndex = parts.post.length;

  /* NOT STARTED UNLESS IT CAN BE FINISHED.
   *
   * The posts and the fight go out one after another, each confirmed before
   * the next. Begun a few seconds before the deadline, the fight would be
   * sent and then given up on unconfirmed, and its closes would have to choose
   * between racing it and leaving rent behind. So a chain with too little time
   * left for every transaction in it is not begun: nothing is paid, and the
   * next call starts it with time to spare. */
  const leftMs = (opts.deadlineMs ?? Infinity) - Date.now();
  const needMs = (fightIndex + 1) * PYTH_MS_PER_TX;
  if (leftMs < needMs) {
    throw new NotYet(
      `${Math.max(0, Math.round(leftMs / 1_000))}s left in this call, too few to post ${fightIndex} price update(s) and run the fight`,
      nowSecs(),
    );
  }

  const fresh = await conn.getAccountInfo(d.address, "confirmed").catch(() => undefined);
  if (fresh === null || (fresh && decodeDuel(d.address, fresh.data).status !== STATUS_FOR[which])) {
    throw new AlreadyDone(`status moved before the prices were posted; nothing paid`);
  }
  try {
    // sendInOrder returns the main list first, so the fight is right after the posts.
    const signatures = await sendInOrder(conn, [...parts.post, parts.fight].map((t) => t.tx), {
      preflight: true,
      cleanup: parts.close.map((t) => t.tx),
      deadlineMs: opts.deadlineMs,
      lastValidBlockHeight: parts.lastValidBlockHeight,
      maySend: opts.maySend,
      onSent: (sig, i) => opts.onSent?.(sig, i === fightIndex),
    });
    return { signature: signatures[fightIndex], signatures };
  } catch (e) {
    await throwIfAlreadyDone(conn, d, which, e, fightIndex);
    throw markFight(e, fightIndex);
  }
}

/** Refund a void duel, sent and confirmed like a fight: preflight on, so a
 *  refund somebody else already made costs nothing. */
export async function refund(
  conn: Connection,
  payer: Keypair,
  d: DuelView,
  opts: { deadlineMs?: number; onSent?: OnSent; maySend?: () => boolean } = {},
): Promise<string> {
  const tx = new Transaction().add(buildRefundDuel(d, payer.publicKey));
  const latest = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  try {
    return await sendSigned(conn, tx, {
      preflight: true,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      deadlineMs: Math.min(opts.deadlineMs ?? Infinity, Date.now() + CONFIRM_WAIT_MS),
      maySend: opts.maySend,
      onSent: (sig) => opts.onSent?.(sig, true),
    });
  } catch (e) {
    await throwIfAlreadyDone(conn, d, "refund", e, 0);
    throw markFight(e, 0);
  }
}

/* ─── One job ──────────────────────────────────────────────────────────────── */

export type JobState = "sent" | "done" | "not-yet" | "failed";
export type JobOutcome = {
  state: JobState;
  /** The fight's signature when sent; otherwise what happened, in words. */
  detail: string;
  signature?: string;
  /** For not-yet: the earliest worth trying again, when known. */
  readyAt?: number;
  /** Whether anything went to the RPC in this call, so a fee may have been
   *  paid. A preflight refusal, a held-back send and a failure before sending
   *  are not; an unconfirmed send is. The nudge gives its send budget back
   *  when this is false. */
  forwarded?: boolean;
};

export type JobOptions = CrankContext & {
  /** Seconds past readyAt before the first try. The cron gives page nudges
   *  this long to go first; a nudge itself uses 0. */
  yieldSecs?: number;
  /** The same, for a start or settle with a Pyth side; default yieldSecs. */
  pythYieldSecs?: number;
  /** The longest one attempt may run before it has sent anything. */
  attemptTimeoutMs?: number;
  /** Runs an attempt when a slot is free (crankOnce's pool); default: now. */
  slot?: <T>(work: () => Promise<T>) => Promise<T>;
};

/** Seconds of the plan's cron yield, for the route. */
export const CRON_YIELD_SECS = 6;
/* THE CRON YIELDS LONGER TO A PYTH CRANK.
 *
 * A page nudge on a signed fight is one transaction, confirmed a second or
 * two after readyAt, so six seconds is enough for the cron to find it done.
 * A Pyth side is two or three transactions confirmed one after another, often
 * after a Hermes 404 and a retry, and the page's crank can take half a minute.
 * A cron that went in at six seconds found the fight still ACCEPTED and posted
 * a second set of prices, paying their fees again, on most watched Pyth
 * fights. So it waits out the nudge's whole budget (JOB_MS in the nudge route)
 * first. When no page is open that only makes the backstop later, which is
 * what a backstop is for. */
export const CRON_PYTH_YIELD_SECS = 45;
export const ATTEMPT_TIMEOUT_MS = 20_000;
/** Tries per job per call: a not-yet that keeps recurring is left to the next. */
export const MAX_ATTEMPTS = 5;
/** Retry no sooner than this after a not-yet. */
export const RETRY_FLOOR_MS = 1_500;
/** Not worth waking for a price if less than this is left before the deadline. */
export const MIN_ATTEMPT_MS = 5_000;
/** The same for a job with a Pyth side: Hermes, a build, and two or three
 *  transactions confirmed in turn (see PYTH_MS_PER_TX). */
export const PYTH_MIN_ATTEMPT_MS = 20_000;

/** Whether a job needs Pyth: a start or settle with a Pyth side. A refund does not. */
const needsPyth = (job: CrankJob) => job.kind !== "refund" && pythFeedsOf(job.duel).length > 0;
const minAttemptMs = (job: CrankJob) => (needsPyth(job) ? PYTH_MIN_ATTEMPT_MS : MIN_ATTEMPT_MS);
const yieldMsFor = (opts: JobOptions, job: CrankJob) =>
  ((needsPyth(job) ? opts.pythYieldSecs ?? opts.yieldSecs : opts.yieldSecs) ?? 0) * 1_000;

/* ONE JOB, SEEN THROUGH TO AN ANSWER INSIDE A DEADLINE.
 *
 *   wait until readyAt (+ yieldSecs)  ->  re-read the duel  ->  post and run
 *                ^                                                    |
 *                +------------ not yet, and time left ----------------+
 *
 * Waiting only waits. The price is still decided by quoteAt, which refuses
 * before its bar is final, and by the program, which demands publish_time at
 * or after the boundary; this only chooses when to ask.
 *
 * The re-read is what makes a late crank free: a fight a page nudge (or a
 * person) already moved comes back "done" with no quote fetched. An attempt
 * that hangs before sending is abandoned after attemptTimeoutMs, so it
 * cannot hold the pass; once something has been sent, it is waited on until
 * its confirmation deadline instead, and never retried, because sending it
 * again blind could pay twice.
 *
 * ABANDONED MEANS ABANDONED. The work of a given-up attempt cannot be
 * cancelled: a quote or a Hermes fetch in flight comes back when it comes
 * back. So every send asks `maySend` first, and from the moment an attempt is
 * given up it says no, so the answer "timed out before sending" stays true.
 * The other way round is covered too: once a send has been let through, the
 * attempt is no longer abandoned but waited on, so a transaction can never go
 * out behind an answer that says nothing did. */
export async function crankJob(opts: JobOptions, job: CrankJob, deadlineMs: number): Promise<JobOutcome> {
  const slot = opts.slot ?? ((work) => work());
  const timeoutMs = opts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const minMs = minAttemptMs(job);
  let wakeMs = job.readyAt * 1_000 + yieldMsFor(opts, job);
  let readyAt = job.readyAt;
  let lastNotYet = "";
  // Across every attempt in this call: did anything reach the RPC?
  let forwarded = false;

  for (let attempt = 1; ; attempt++) {
    if (wakeMs > Date.now()) {
      if (wakeMs + minMs > deadlineMs) {
        return { state: "not-yet", detail: lastNotYet || `ready at ${readyAt}, after this call's deadline`, readyAt, forwarded };
      }
      await sleepUntil(wakeMs);
    }

    const outcome = await slot(async (): Promise<JobOutcome | NotYet> => {
      const left = deadlineMs - Date.now();
      if (left < minMs / 2) return new NotYet("no time left in this call", readyAt);

      const flight = { abandoned: false, letThrough: false, forwarded: false, fightSig: undefined as string | undefined };
      // Checked and marked with no await between, so giving up and sending cannot interleave.
      const maySend = () => {
        if (flight.abandoned) return false;
        flight.letThrough = true;
        return true;
      };
      const onSent: OnSent = (sig, fight) => {
        flight.forwarded = true;
        if (fight) flight.fightSig = sig;
      };
      const work = (async (): Promise<JobOutcome> => {
        const info = await opts.conn.getAccountInfo(job.duel.address, "confirmed").catch(() => undefined);
        if (info === null) return { state: "done", detail: "the duel account is gone" };
        // A failed read is not a verdict: build from the listed view, and let preflight judge.
        const duel = info ? decodeDuel(job.duel.address, info.data) : job.duel;
        if (duel.status !== STATUS_FOR[job.kind]) {
          return { state: "done", detail: `status is now ${duel.status}; somebody else got there` };
        }
        const signature =
          job.kind === "refund"
            ? await refund(opts.conn, opts.payer, duel, { deadlineMs, onSent, maySend })
            : (await postAndRun({ ...opts, duel, which: job.kind, deadlineMs, onSent, maySend })).signature;
        return { state: "sent", detail: signature, signature };
      })();

      /* Before anything is sent, an attempt gets attemptTimeoutMs. Once a send
       * has been let through, it gets until the deadline plus the cleanup
       * grace, so Pyth's closes are not cut off with their rent still held;
       * every wait inside is bounded by those same deadlines, so this is a
       * ceiling and not a wait. */
      const firstWait = Math.min(timeoutMs, left);
      try {
        const result = await raceTimeout(work, firstWait, () => {
          if (flight.letThrough) return deadlineMs + CLEANUP_GRACE_MS - Date.now();
          flight.abandoned = true;
          return null;
        });
        if (result === TIMED_OUT) {
          // The work goes on in the background, and can send nothing more if it was abandoned.
          work.catch(() => undefined);
          if (flight.fightSig) {
            flight.forwarded = true;
            return { state: "sent", detail: `${flight.fightSig} (not confirmed by the deadline)`, signature: flight.fightSig };
          }
          if (flight.letThrough) {
            // Something may be on its way (a price post, or a send not yet answered): count it.
            flight.forwarded = true;
            return { state: "failed", detail: "timed out while sending; the fight transaction was not seen to go out" };
          }
          return { state: "failed", detail: `timed out after ${Math.round(firstWait / 1000)}s before sending; nothing was sent` };
        }
        return result;
      } catch (e) {
        if (e instanceof SendFailed && e.stage === "unseen") flight.forwarded = true;
        if (e instanceof NotYet) return e;
        if (e instanceof AlreadyDone) return { state: "done", detail: e.message };
        /* Sent and not seen is "sent" only for the fight transaction itself. A
         * price post that was not seen means the fight was never sent, and a
         * later call must try it: that is a failure, not a send to wait on. */
        if (e instanceof SendFailed && e.stage === "unseen" && e.signature && e.fight) {
          return { state: "sent", detail: `${e.signature} (not confirmed yet: ${e.message})`, signature: e.signature };
        }
        /* Refused or failed, whether or not a price post went out first: the
         * fight did not move, and a later call may try again. */
        return { state: "failed", detail: readableProgramError(e) };
      } finally {
        forwarded ||= flight.forwarded;
      }
    });

    if (!(outcome instanceof NotYet)) return { ...outcome, forwarded };
    lastNotYet = `not yet: ${outcome.message}`;
    readyAt = outcome.readyAt ?? readyAt;
    if (attempt >= MAX_ATTEMPTS) return { state: "not-yet", detail: lastNotYet, readyAt, forwarded };
    // No yield on a retry: the nudges have had their turn.
    wakeMs = Math.max((outcome.readyAt ?? 0) * 1_000, Date.now() + RETRY_FLOOR_MS);
  }
}

const TIMED_OUT = Symbol("timed out");

/* Race work against a timer that can be extended: when it fires, `extend`
 * says how much longer to wait (the work has sent something and is now only
 * confirming it) or null to give up. */
async function raceTimeout<T>(work: Promise<T>, ms: number, extend: () => number | null): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    const arm = (wait: number) => {
      timer = setTimeout(() => {
        const more = extend();
        if (more !== null && more > 0) arm(more);
        else resolve(TIMED_OUT);
      }, Math.max(0, wait));
    };
    arm(ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ─── A pass ───────────────────────────────────────────────────────────────── */

export type CrankResult = {
  duel: string;
  kind: JobKind;
  /** Sent, or found already done. */
  ok: boolean;
  state: JobState;
  detail: string;
  readyAt?: number;
};

/* WHICH JOBS A PASS TAKES WHEN THERE ARE MORE THAN IT CAN.
 *
 * The newest first, because a fight that just became due has two people
 * watching it, and a couple of the rest chosen at random, so nothing behind
 * them is left out for good: not a job that keeps coming back unanswered, and
 * not a crowd of jobs that can never succeed.
 *
 * "Newest" is by `since`, when a job became due, never by readyAt. A refund's
 * readyAt is simply now, and a time that moves with the clock is the newest on
 * every pass: six refunds that kept failing took the six fresh slots every
 * minute, and a fight that missed one pass ranked below them on every pass
 * after. The two spare slots were the two oldest, which is a fixed pair too,
 * so a third old job never got a turn; the shuffle this replaced had been
 * written to stop exactly that, so the spares are drawn at random. */
export function chooseJobs(jobs: CrankJob[], limit: number, random: () => number = Math.random): CrankJob[] {
  const key = (j: CrankJob) => j.since ?? j.readyAt;
  const newestFirst = [...jobs].sort((a, b) => key(b) - key(a));
  if (newestFirst.length <= limit) return newestFirst;
  const spare = Math.min(2, Math.floor(limit / 3));
  const fresh = newestFirst.slice(0, limit - spare);
  const rest = newestFirst.slice(limit - spare);
  // The first `spare` places of a partial Fisher-Yates shuffle.
  for (let i = 0; i < spare; i++) {
    const j = i + Math.floor(random() * (rest.length - i));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...fresh, ...rest.slice(0, spare)];
}

/** At most `n` pieces of work at once; the rest wait their turn, in order. */
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((r) => queue.push(r));
    try {
      return await work();
    } finally {
      // Hand the slot straight to the next in line, or give it back.
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_PASS_MS = 50_000;

/* ONE PASS: every job that is due, up to `limit`, each isolated from the rest,
 * several at once, all answered by a deadline.
 *
 * Jobs used to run one after another, so one fight whose price source hung
 * held every fight behind it, and a pass that overran its function was killed
 * reporting nothing. Now `concurrency` attempts run together (waiting for a
 * price does not hold a slot, only trying does), each attempt is bounded, and
 * the pass returns by `deadlineMs`.
 *
 * A job whose first try would come too late for this pass (a Pyth side the
 * cron is still yielding to a page for, say) is answered "not yet" at once and
 * does not count against `limit`, so it cannot crowd out a job that can run.
 *
 * `now` moves only the listing; waiting is always by the real clock. */
export async function crankOnce(
  opts: JobOptions & {
    now?: number;
    limit?: number;
    skip?: (key: string) => boolean;
    concurrency?: number;
    /** A Date.now() time by which the pass answers. Default: 50s from now. */
    deadlineMs?: number;
    lookaheadSecs?: number;
    /** A listing already made (the route lists first, to answer at once). */
    listing?: JobListing;
  },
): Promise<CrankResult[]> {
  const startedMs = Date.now();
  const now = opts.now ?? Math.floor(startedMs / 1000);
  const deadlineMs = opts.deadlineMs ?? startedMs + DEFAULT_PASS_MS;
  const listing =
    opts.listing ?? (await listJobs(opts.conn, now, { lookaheadSecs: opts.lookaheadSecs, lookup: opts.quoteSymbol }));

  const later: CrankResult[] = [];
  const runnable = listing.due.filter((job) => {
    if (opts.skip?.(job.duel.address.toBase58())) return false;
    const wakeMs = job.readyAt * 1_000 + yieldMsFor(opts, job);
    if (wakeMs <= startedMs || wakeMs + minAttemptMs(job) <= deadlineMs) return true;
    later.push({
      duel: job.duel.address.toBase58(),
      kind: job.kind,
      ok: false,
      state: "not-yet",
      detail: `not yet: first try at ${Math.ceil(wakeMs / 1_000)}, too late for this pass`,
      readyAt: job.readyAt,
    });
    return false;
  });
  const jobs = chooseJobs(runnable, opts.limit ?? Infinity);
  const slot = limiter(opts.concurrency ?? DEFAULT_CONCURRENCY);

  const results = await Promise.all(
    jobs.map(async (job): Promise<CrankResult> => {
      const key = job.duel.address.toBase58();
      const o = await crankJob({ ...opts, slot }, job, deadlineMs).catch(
        (e): JobOutcome => ({ state: "failed", detail: readableProgramError(e) }),
      );
      return {
        duel: key,
        kind: job.kind,
        ok: o.state === "sent" || o.state === "done",
        state: o.state,
        detail: o.state === "not-yet" && !o.detail.startsWith("not yet") ? `not yet: ${o.detail}` : o.detail,
        ...(o.readyAt !== undefined ? { readyAt: o.readyAt } : {}),
      };
    }),
  );
  return [...results, ...later];
}
