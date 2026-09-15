/* The transactions that post a fight's prices and run its start or settle,
 * shared by the server crank (crank.ts) and the fight page's "do it yourself"
 * button (pythCrank.ts), and the one way both send them. Nothing here signs,
 * and nothing here needs Node, so the browser can import it. */

import {
  ComputeBudgetProgram,
  SendTransactionError,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type PublicKey,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import type { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { confirmSignature, NotSeen, TransactionFailed } from "./confirm";
import {
  buildSettleDuel,
  buildStartDuel,
  feeAccountsFor,
  SOURCE_PYTH,
  START_DELAY_SECS,
  type DuelView,
  type FeeView,
} from "./duel";

/** Solana's limit on a serialized transaction, signatures included. */
export const MAX_TX_BYTES = 1_232;

/* THE FEE NEVER COSTS A SETTLEMENT.
 *
 * A settle transaction is close to the size limit already (payout accounts,
 * price accounts or signed quotes), and the fee adds three accounts. So the
 * settle instruction is built with them, measured, and built again without
 * them if the transaction would not fit: the program then pays the winner in
 * full. `measure` is the byte length of the transaction the caller would send. */
export function settleWithFee<T>(
  d: DuelView,
  fee: FeeView | null | undefined,
  build: (feeKeys: ReturnType<typeof feeAccountsFor>) => T,
  measure: (built: T) => number,
): T {
  const keys = feeAccountsFor(d, fee);
  if (!keys.length) return build([]);
  const withFee = build(keys);
  try {
    if (measure(withFee) <= MAX_TX_BYTES) return withFee;
  } catch {
    /* too large to serialize at all */
  }
  return build([]);
}

export type SignedTx = { tx: VersionedTransaction; signers: Signer[] };

export const boundaryOf = (d: Pick<DuelView, "acceptedTs" | "endTs">, which: "start" | "settle") =>
  which === "start" ? d.acceptedTs + START_DELAY_SECS : d.endTs;

export const pythFeedsOf = (d: DuelView) =>
  [
    d.creatorSource === SOURCE_PYTH ? d.creatorFeed : null,
    d.opponentSource === SOURCE_PYTH ? d.opponentFeed : null,
  ].filter((f): f is string => f !== null);

/** Compute for the fight instruction, plus room for the Ed25519 checks. */
export const fightUnits = (which: "start" | "settle", quotes: number) =>
  (which === "start" ? 60_000 : 300_000) + 10_000 * quotes;

export type CrankParts = {
  /** Pyth's price posts, in order; empty for a fight with no Pyth side. */
  post: SignedTx[];
  /** The quotes and start_duel or settle_duel, together. */
  fight: SignedTx;
  /** Pyth's account closes, which return the posts' rent. */
  close: SignedTx[];
  /** The expiry height of the blockhash fetched before any of these was built. */
  lastValidBlockHeight: number;
};

/* ONE FIGHT INSTRUCTION, ONE TRANSACTION, WITH ITS QUOTES.
 *
 * The program looks for a signed quote only inside the transaction that runs
 * the fight instruction, so the two must never be split. Pyth's transaction
 * builder packs instructions greedily and would split them whenever the fight
 * instruction does not fit beside the last price post (a settle, with its
 * payout accounts, usually does not). So Pyth's SDK only posts and closes its
 * accounts; the fight transaction is built here:
 *
 *   post Pyth updates (if any)  ->  quotes + start/settle  ->  close Pyth accounts
 *
 * Returned as its three parts, so a server sender can treat the closes as
 * cleanup that goes out whatever happened to the fight.
 *
 * THE EXPIRY HEIGHT IS READ BEFORE BUILDING, NOT AFTER SENDING.
 *
 * A blockhash's last valid height is fixed when the blockhash is issued, and
 * reading it again after a send gets a later blockhash's height, which waits
 * past the real expiry for a transaction that can no longer land. The fight
 * transaction uses exactly the blockhash read here. Pyth's builder reads its
 * own a moment later, whose expiry is the same or a few blocks later, so this
 * height is a floor for those: at worst a sender asks history a few blocks
 * early, and history is asked before anything is called unseen. */
export async function crankTransactionParts(opts: {
  conn: Connection;
  receiver: PythSolanaReceiver;
  payer: PublicKey;
  duel: DuelView;
  which: "start" | "settle";
  /** Hermes update data for the fight's Pyth sides; empty if it has none. */
  pythUpdate: string[];
  quotes: TransactionInstruction[];
  priorityMicroLamports?: number;
  /** The platform fee (readFeeConfig); a settle passes its accounts when they fit. */
  fee?: FeeView | null;
}): Promise<CrankParts> {
  const { conn, receiver, payer, duel: d, which } = opts;
  const priority = opts.priorityMicroLamports ?? 20_000;
  const latest = await conn.getLatestBlockhash("confirmed");
  /* NOT a tight compute budget on Pyth's own transactions.
   *
   * `tightComputeBudget` sizes them to an estimate with no headroom, and the
   * cost of verifying a Wormhole signature is not constant, so posting a price
   * fails with ComputationalBudgetExceeded now and again. It is retried and
   * gets there, but a settler that fails a third of the time is a settler
   * nobody should trust. The headroom costs a few thousand lamports of
   * priority fee, which is nothing against a fight not starting. */
  const fee = { computeUnitPriceMicroLamports: priority };

  let post: SignedTx[] = [];
  let close: SignedTx[] = [];
  let accountFor: (feed: string) => PublicKey | null = () => null;
  if (opts.pythUpdate.length) {
    const built = await receiver.buildPostPriceUpdateInstructions(opts.pythUpdate);
    const map = built.priceFeedIdToPriceUpdateAccount;
    accountFor = (feed) => map[`0x${feed}`] ?? map[feed] ?? null;
    post = await receiver.batchIntoVersionedTransactions(built.postInstructions, fee);
    close = await receiver.batchIntoVersionedTransactions(built.closeInstructions, fee);
  }

  const pythAccount = (feed: string, source: number) => {
    if (source !== SOURCE_PYTH) return null;
    const account = accountFor(feed);
    if (!account) throw new Error(`No Pyth update posted for feed ${feed.slice(0, 8)}`);
    return account;
  };
  const c = pythAccount(d.creatorFeed, d.creatorSource);
  const o = pythAccount(d.opponentFeed, d.opponentSource);
  const compile = (fight: TransactionInstruction) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: fightUnits(which, opts.quotes.length) }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
          ...opts.quotes,
          fight,
        ],
      }).compileToV0Message(),
    );
  const tx =
    which === "start"
      ? compile(buildStartDuel(d, c, o))
      : settleWithFee(
          d,
          opts.fee,
          (feeKeys) => compile(buildSettleDuel(d, payer, c, o, feeKeys)),
          (built) => built.serialize().length,
        );

  return {
    post,
    fight: { tx, signers: [] },
    close,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

/** All of a crank's transactions in sending order, for a sender that signs
 *  them in one go (the page's wallet asks once) and sends them as one list. */
export async function crankTransactions(opts: Parameters<typeof crankTransactionParts>[0]): Promise<SignedTx[]> {
  const { post, fight, close } = await crankTransactionParts(opts);
  return [...post, fight, ...close];
}

/* WHY A SEND STOPPED, SAID PRECISELY ENOUGH TO ACT ON.
 *
 *   preflight  the RPC simulated it and refused to forward it: nothing was
 *              paid, and the logs say why (a fight already started, say)
 *   held       it was never handed to the RPC at all: its deadline had passed,
 *              or the attempt it belonged to had been given up
 *   chain      it landed and failed: the fee was paid
 *   unseen     it went out and was not seen confirmed in time: it may still
 *              land, so nobody should send it again blind
 *
 * The message keeps the old wording, "Transaction 2 of 3 failed: ...", and
 * `logs` carries the program's own lines for readableProgramError. */
export class SendFailed extends Error {
  /** Whether the transaction that stopped is the one that runs the fight
   *  instruction. Only its caller knows (a list of price posts then the fight),
   *  so postAndRun and refund set it; a crank reads it to tell "the fight may
   *  land" from "a price post may land and the fight was never sent". */
  fight?: boolean;

  constructor(
    message: string,
    readonly stage: "preflight" | "held" | "chain" | "unseen",
    readonly index: number,
    readonly logs: string[] = [],
    readonly signature?: string,
  ) {
    super(message);
    this.name = "SendFailed";
  }
}

export type SendOptions = {
  /** Simulate before forwarding, so a transaction that would fail costs nothing. */
  preflight?: boolean;
  /** Sent after the main list whether it succeeded or not (Pyth's closes, so
   *  the posts' rent comes back even when the fight transaction fails). */
  cleanup?: VersionedTransaction[];
  /** A Date.now() time to stop waiting for confirmations by. Nothing is sent
   *  once it has passed. */
  deadlineMs?: number;
  /** The expiry height of the blockhash the transactions were built with. */
  lastValidBlockHeight?: number;
  /** Called as each main transaction goes out: from then on it may land. */
  onSent?: (signature: string, index: number) => void;
  /** Asked immediately before each transaction is handed to the RPC, with no
   *  wait in between; false holds it back. A caller that may give up on this
   *  send uses it so nothing goes out after it has stopped listening. */
  maySend?: () => boolean;
};

/** Cleanup is worth a little time past the deadline: it is rent coming back. */
export const CLEANUP_GRACE_MS = 5_000;
/** Of that grace, what is kept for sending the closes themselves. */
export const CLOSE_RESERVE_MS = 2_500;

const signatureOf = (tx: Transaction | VersionedTransaction) => {
  const sig = tx instanceof VersionedTransaction ? tx.signatures[0] : tx.signature;
  return sig ? utils.bytes.bs58.encode(sig) : "";
};

const namedError = (logs: string[]) => logs.map((l) => /Error Message: ([^.]+)/.exec(l)?.[1]).find(Boolean);

/** Wait for a signature that has gone out, reporting a stop as SendFailed. */
async function confirmSent(
  conn: Connection,
  sig: string,
  which: string,
  index: number,
  latest: { blockhash: string; lastValidBlockHeight: number },
  deadlineMs: number | undefined,
): Promise<void> {
  try {
    await confirmSignature(conn, sig, latest, { deadlineMs });
  } catch (e) {
    if (e instanceof NotSeen) throw new SendFailed(`${which} was not seen confirmed: ${e.message}`, "unseen", index, [], sig);
    if (!(e instanceof TransactionFailed)) {
      throw new SendFailed(`${which} could not be confirmed: ${e instanceof Error ? e.message : e}`, "unseen", index, [], sig);
    }
    const detail = await conn
      .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    const logs = detail?.meta?.logMessages ?? [];
    throw new SendFailed(`${which} failed: ${namedError(logs) ?? JSON.stringify(e.err)}`, "chain", index, logs, sig);
  }
}

/** Send one signed transaction and wait for it, reporting a stop as SendFailed. */
export async function sendSigned(
  conn: Connection,
  tx: Transaction | VersionedTransaction,
  opts: SendOptions & { blockhash: string; index?: number; total?: number },
): Promise<string> {
  const index = opts.index ?? 0;
  const total = opts.total ?? 1;
  const which = `Transaction ${index + 1} of ${total}`;
  const lastValidBlockHeight =
    opts.lastValidBlockHeight ?? (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;

  /* NOTHING GOES OUT AFTER ITS CALLER HAS STOPPED LISTENING.
   *
   * A server crank that gives up on an attempt, or runs out of its deadline,
   * returns an answer and moves on; the work it started does not stop by
   * itself. Before this, a quote that came back a moment after the crank said
   * "timed out before sending" was still posted, after the deadline, where the
   * next call would crank the same fight again. So both checks sit right
   * before the transaction is handed over, with nothing awaited in between:
   * a crank that has given up can never be told "held back" and then have the
   * transaction go out anyway. Browser callers pass neither. */
  if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
    throw new SendFailed(`${which} was held back: its deadline had passed`, "held", index);
  }
  if (opts.maySend && !opts.maySend()) {
    throw new SendFailed(`${which} was held back: the attempt it belongs to was given up`, "held", index);
  }

  let sig: string;
  try {
    sig = await conn.sendRawTransaction(
      tx.serialize(),
      opts.preflight
        ? { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }
        : { skipPreflight: true, maxRetries: 3 },
    );
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (e instanceof SendTransactionError || /Simulation failed/i.test(text)) {
      const logs = (e as { logs?: string[] }).logs ?? [];
      const named = namedError(logs) ?? text.split("\n").find((l) => /Message:/.test(l))?.replace(/^.*Message:\s*/, "");
      throw new SendFailed(`${which} was refused before sending: ${named ?? text.split("\n")[0]}`, "preflight", index, logs);
    }
    /* The RPC may have forwarded it before the connection broke, so this is
     * not a refusal: the signature is known from the transaction itself. */
    throw new SendFailed(`${which} may have been sent: ${text.split("\n")[0]}`, "unseen", index, [], signatureOf(tx));
  }
  opts.onSent?.(sig, index);

  await confirmSent(conn, sig, which, index, { blockhash: opts.blockhash, lastValidBlockHeight }, opts.deadlineMs);
  return sig;
}

/* Send already-signed transactions strictly in order, each confirmed before
 * the next, and when one fails say which and why: the on-chain logs, not the
 * "Unknown action 'undefined'" a batch sender reduces them to.
 *
 * With no options this is what the page has always had: no preflight, waiting
 * out each blockhash. The server crank turns on preflight, gives a deadline,
 * and hands over Pyth's closes as cleanup. Returns the main signatures, then
 * any cleanup signatures that confirmed. */
export async function sendInOrder(
  conn: Connection,
  txs: VersionedTransaction[],
  opts: SendOptions = {},
): Promise<string[]> {
  const sigs: string[] = [];
  let failure: unknown = null;
  for (const [i, tx] of txs.entries()) {
    try {
      sigs.push(
        await sendSigned(conn, tx, { ...opts, blockhash: tx.message.recentBlockhash, index: i, total: txs.length }),
      );
    } catch (e) {
      failure = e;
      break;
    }
  }
  if (!opts.cleanup?.length) {
    if (failure) throw failure;
    return sigs;
  }

  const cleanupBy = opts.deadlineMs === undefined ? undefined : Math.max(opts.deadlineMs, Date.now()) + CLEANUP_GRACE_MS;

  /* NOTHING IS CLOSED UNDER A TRANSACTION THAT MAY STILL LAND.
   *
   * "Unseen" means sent and not yet seen, not failed: a fight transaction
   * that missed its deadline by a second is usually confirmed a second later.
   * Closing the price accounts straight away, as this used to, raced it: the
   * close could land first and the fight fail on chain with its fee paid, or
   * a post's close could be refused for an account that did not exist yet and
   * the post then land with its rent stranded. So an unseen transaction is
   * given most of the cleanup grace to settle first. If the last of the list
   * landed, the list succeeded; if a post landed, nothing after it was sent;
   * if it failed on chain, that is the failure. If it is still unseen and it
   * is the last of the list, the one that reads the accounts, the closes are
   * held back: rent left for a reclaim costs less than a fight made to fail.
   * An unseen post is different: nothing after it was sent, so nothing can
   * read what the closes remove, and they go out. */
  let lastMayLand = false;
  if (failure instanceof SendFailed && failure.stage === "unseen" && failure.signature) {
    const i = failure.index;
    const sig = failure.signature;
    const which = `Transaction ${i + 1} of ${txs.length}`;
    const lastValidBlockHeight =
      opts.lastValidBlockHeight ?? (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
    try {
      await confirmSent(
        conn,
        sig,
        which,
        i,
        { blockhash: txs[i].message.recentBlockhash, lastValidBlockHeight },
        cleanupBy === undefined ? undefined : cleanupBy - CLOSE_RESERVE_MS,
      );
      // It landed after all.
      sigs.push(sig);
      if (i === txs.length - 1) {
        failure = null;
      } else {
        failure = new SendFailed(
          `Transaction ${i + 2} of ${txs.length} was held back: the one before it was confirmed only after its deadline`,
          "held",
          i + 1,
        );
      }
    } catch (e) {
      if (e instanceof SendFailed && e.stage === "chain") failure = e;
      else lastMayLand = i === txs.length - 1;
    }
  }

  /* THE CLOSES GO OUT EVEN WHEN THE FIGHT DID NOT.
   *
   * A price post holds rent until its account is closed, and before this the
   * closes were simply the tail of the list, so a fight transaction that
   * failed (somebody else started it first) left the posts' rent stranded.
   * Now they are sent whatever happened, with the exception above. The other
   * case skipped is a list whose very first transaction never went out
   * (refused in preflight, or held back): nothing was posted, so there is
   * nothing to close. With preflight on, a close for an account that does not
   * exist is refused for free, so trying costs nothing. */
  const nothingSent =
    sigs.length === 0 && failure instanceof SendFailed && (failure.stage === "preflight" || failure.stage === "held");
  if (lastMayLand) {
    console.warn(
      `cleanup held back: transaction ${txs.length} of ${txs.length} may still land and reads the accounts ` +
        `${opts.cleanup.length} close transaction(s) would remove; their rent stays until reclaimed`,
    );
  } else if (!nothingSent) {
    for (const [i, tx] of opts.cleanup.entries()) {
      try {
        sigs.push(
          await sendSigned(conn, tx, {
            preflight: opts.preflight,
            lastValidBlockHeight: opts.lastValidBlockHeight,
            deadlineMs: cleanupBy,
            maySend: opts.maySend,
            blockhash: tx.message.recentBlockhash,
            index: i,
            total: opts.cleanup.length,
          }),
        );
      } catch (e) {
        // Rent left behind is worth a line in the log, never a failed fight.
        console.warn(`cleanup: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (failure) throw failure;
  return sigs;
}
