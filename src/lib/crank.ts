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
import { BAR_SETTLE_SECS, firstBarEnd, quoteAt, signedQuoteInstruction } from "./oracle";
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
/** A job, with the earliest unix second its prices can exist (priceClock). */
export type CrankJob = { duel: DuelView; kind: JobKind; readyAt: number; why: ReadyWhy | "refund" };
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
        due.push({ duel, kind, readyAt: now, why: "refund" });
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
      if (at <= now + lookahead) due.push({ duel, kind, readyAt: at, why: clock.why });
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
 * side that is late is asked again a few seconds on. */
function retryAt(d: DuelView, which: "start" | "settle", now: number, lookup: MarketLookup): number | undefined {
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
  return Promise.all(
    feeds.map(async (feed) => {
      const market = opts.quoteSymbol(feed);
      if (!market) throw new Error(`No market symbol for feed ${feed.slice(0, 8)}`);
      const q = await quote({ feed, ...market, boundary });
      if (!q) {
        const now = nowSecs();
        throw new NotYet(`${market.symbol}: waiting for the price at ${boundary} to be final`, retryAt(d, which, now, opts.quoteSymbol));
      }
      return signedQuoteInstruction(oracle, q);
    }),
  );
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

/* The program's refusal when a job has already been done by somebody else.
 * start_duel and settle_duel check the status first, so a start that lost the
 * race is refused with NotAccepted and a settle with NotLive; a refund of a
 * duel no longer void is NotRefundable (the crank refunds VOID duels only,
 * which are always refundable, so on this path it can only mean that). */
const DONE_CODE: Record<JobKind, RegExp> = {
  start: /Error Code: NotAccepted\b/,
  settle: /Error Code: NotLive\b/,
  refund: /Error Code: NotRefundable\b/,
};

function throwIfAlreadyDone(e: unknown, kind: JobKind, fightIndex: number): void {
  if (!(e instanceof SendFailed) || e.stage !== "preflight" || e.index !== fightIndex) return;
  if (DONE_CODE[kind].test([e.message, ...e.logs].join("\n"))) {
    throw new AlreadyDone(`already ${kind === "start" ? "started" : kind === "settle" ? "settled" : "refunded"}; refused in preflight, nothing paid`);
  }
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

/** Post the boundary's prices and run start_duel or settle_duel: Pyth updates
 * for Pyth sides, the oracle's signed quotes for signed sides. Sent with
 * preflight on, so a fight somebody else already moved costs nothing and comes
 * back as AlreadyDone. Returns the fight transaction's signature, and every
 * signature in the order sent (posts, fight, closes). */
export async function postAndRun(
  opts: CrankContext & {
    duel: DuelView;
    which: "start" | "settle";
    /** A Date.now() time to stop waiting for confirmation by. */
    deadlineMs?: number;
    /** Told as each transaction goes out: from then on, it may land. */
    onSent?: (signature: string) => void;
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
        onSent: (sig) => opts.onSent?.(sig),
      });
      return { signature, signatures: [signature] };
    } catch (e) {
      throwIfAlreadyDone(e, which, 0);
      throw e;
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
      onSent: (sig) => opts.onSent?.(sig),
    });
    return { signature: signatures[parts.post.length], signatures };
  } catch (e) {
    throwIfAlreadyDone(e, which, parts.post.length);
    throw e;
  }
}

/** Refund a void duel, sent and confirmed like a fight: preflight on, so a
 *  refund somebody else already made costs nothing. */
export async function refund(
  conn: Connection,
  payer: Keypair,
  d: DuelView,
  opts: { deadlineMs?: number; onSent?: (signature: string) => void } = {},
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
      onSent: opts.onSent,
    });
  } catch (e) {
    throwIfAlreadyDone(e, "refund", 0);
    throw e;
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
};

export type JobOptions = CrankContext & {
  /** Seconds past readyAt before the first try. The cron gives page nudges
   *  this long to go first; a nudge itself uses 0. */
  yieldSecs?: number;
  /** The longest one attempt may run before it has sent anything. */
  attemptTimeoutMs?: number;
  /** Runs an attempt when a slot is free (crankOnce's pool); default: now. */
  slot?: <T>(work: () => Promise<T>) => Promise<T>;
};

/** Seconds of the plan's cron yield, for the route. */
export const CRON_YIELD_SECS = 6;
export const ATTEMPT_TIMEOUT_MS = 20_000;
/** Tries per job per call: a not-yet that keeps recurring is left to the next. */
export const MAX_ATTEMPTS = 5;
/** Retry no sooner than this after a not-yet. */
export const RETRY_FLOOR_MS = 1_500;
/** Not worth waking for a price if less than this is left before the deadline. */
export const MIN_ATTEMPT_MS = 5_000;

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
 * again blind could pay twice. */
export async function crankJob(opts: JobOptions, job: CrankJob, deadlineMs: number): Promise<JobOutcome> {
  const slot = opts.slot ?? ((work) => work());
  const yieldMs = (opts.yieldSecs ?? 0) * 1_000;
  const timeoutMs = opts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  let wakeMs = job.readyAt * 1_000 + yieldMs;
  let readyAt = job.readyAt;
  let lastNotYet = "";

  for (let attempt = 1; ; attempt++) {
    if (wakeMs > Date.now()) {
      if (wakeMs + MIN_ATTEMPT_MS > deadlineMs) {
        return { state: "not-yet", detail: lastNotYet || `ready at ${readyAt}, after this call's deadline`, readyAt };
      }
      await sleepUntil(wakeMs);
    }

    const outcome = await slot(async (): Promise<JobOutcome | NotYet> => {
      const left = deadlineMs - Date.now();
      if (left < MIN_ATTEMPT_MS / 2) return new NotYet("no time left in this call", readyAt);

      /* The latest signature sent. Pyth's closes are sent without telling
       * anyone, so after the fight transaction this stays the fight's. */
      const sent: { sig?: string } = {};
      const work = (async (): Promise<JobOutcome> => {
        const info = await opts.conn.getAccountInfo(job.duel.address, "confirmed").catch(() => undefined);
        if (info === null) return { state: "done", detail: "the duel account is gone" };
        // A failed read is not a verdict: build from the listed view, and let preflight judge.
        const duel = info ? decodeDuel(job.duel.address, info.data) : job.duel;
        if (duel.status !== STATUS_FOR[job.kind]) {
          return { state: "done", detail: `status is now ${duel.status}; somebody else got there` };
        }
        const onSent = (sig: string) => {
          sent.sig = sig;
        };
        const signature =
          job.kind === "refund"
            ? await refund(opts.conn, opts.payer, duel, { deadlineMs, onSent })
            : (await postAndRun({ ...opts, duel, which: job.kind, deadlineMs, onSent })).signature;
        return { state: "sent", detail: signature, signature };
      })();

      /* Before anything is sent, an attempt gets attemptTimeoutMs. Once
       * something is out, it gets until the deadline plus the cleanup grace,
       * so Pyth's closes are not cut off with their rent still held; every
       * wait inside is bounded by those same deadlines, so this is a ceiling
       * and not a wait. */
      const firstWait = Math.min(timeoutMs, left);
      try {
        const result = await raceTimeout(work, firstWait, () =>
          sent.sig ? deadlineMs + CLEANUP_GRACE_MS - Date.now() : null,
        );
        if (result === TIMED_OUT) {
          // The work goes on in the background; its answer is no longer ours to wait for.
          work.catch(() => undefined);
          return sent.sig
            ? { state: "sent", detail: `${sent.sig} (not confirmed by the deadline)`, signature: sent.sig }
            : { state: "failed", detail: `timed out after ${Math.round(firstWait / 1000)}s before sending` };
        }
        return result;
      } catch (e) {
        if (e instanceof NotYet) return e;
        if (e instanceof AlreadyDone) return { state: "done", detail: e.message };
        if (e instanceof SendFailed && e.stage === "unseen" && e.signature) {
          return { state: "sent", detail: `${e.signature} (not confirmed yet: ${e.message})`, signature: e.signature };
        }
        /* Refused or failed, whether or not a price post went out first: the
         * fight did not move, and a later call may try again. */
        return { state: "failed", detail: readableProgramError(e) };
      }
    });

    if (!(outcome instanceof NotYet)) return outcome;
    lastNotYet = `not yet: ${outcome.message}`;
    readyAt = outcome.readyAt ?? readyAt;
    if (attempt >= MAX_ATTEMPTS) return { state: "not-yet", detail: lastNotYet, readyAt };
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
 * The newest by readyAt first, because a fight that just became due has two
 * people watching it, plus a couple of the oldest, so a job that keeps coming
 * back unanswered cannot starve behind a stream of new ones, and one that can
 * never succeed cannot hold every slot either. The shuffle this replaces gave
 * every job the same chance, which is fair to jobs and unfair to people. */
export function chooseJobs(jobs: CrankJob[], limit: number): CrankJob[] {
  const newestFirst = [...jobs].sort((a, b) => b.readyAt - a.readyAt);
  if (newestFirst.length <= limit) return newestFirst;
  const oldest = Math.min(2, Math.floor(limit / 3));
  return [...newestFirst.slice(0, limit - oldest), ...newestFirst.slice(newestFirst.length - oldest)];
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
  const jobs = chooseJobs(
    listing.due.filter((j) => !opts.skip?.(j.duel.address.toBase58())),
    opts.limit ?? Infinity,
  );
  const slot = limiter(opts.concurrency ?? DEFAULT_CONCURRENCY);

  return Promise.all(
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
}
