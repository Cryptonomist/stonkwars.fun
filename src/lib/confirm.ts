/* Did it land? Asked by polling, never by subscription.
 *
 * `confirmTransaction` opens a websocket. The browser reaches the chain through
 * /api/rpc, which is a serverless route and cannot hold one, so every
 * confirmation in the app asks the same question over plain HTTP instead.
 *
 * The rule this keeps from Commish: A BLOCKHASH EXPIRING IS NOT A FAILED
 * TRANSACTION. When the window closes with nothing seen, look once more,
 * through history, before telling anybody their stake did not move. */

import type { Connection, TransactionError } from "@solana/web3.js";

import type { Blockhash } from "./send";

const POLL_MS = 700;

export class TransactionFailed extends Error {
  constructor(readonly err: TransactionError) {
    super(`Transaction failed: ${JSON.stringify(err)}`);
    this.name = "TransactionFailed";
  }
}

export class NotSeen extends Error {
  constructor(
    readonly signature: string,
    message = "The blockhash expired before the transaction was seen.",
  ) {
    super(message);
    this.name = "NotSeen";
  }
}

/* A DEADLINE, FOR CALLERS THAT CANNOT WAIT OUT A BLOCKHASH.
 *
 * A blockhash lives for about a minute and a half, and a serverless function
 * that polls for all of it overruns its own time limit and is killed mid-pass,
 * reporting nothing about anything. So a server caller can pass `deadlineMs`
 * (a Date.now() timestamp): when it passes with nothing confirmed, this looks
 * through history exactly as an expiry does, and only then gives up with
 * NotSeen. Giving up is not a verdict on the transaction, which may still
 * land; the next pass reads the fight's status and sees. Browser callers pass
 * nothing and wait for the blockhash, as before. */
export type ConfirmOptions = { deadlineMs?: number };

/** Resolves when the signature is confirmed; throws if it failed or expired,
 *  or if `deadlineMs` passed before it was seen. */
export async function confirmSignature(
  conn: Connection,
  signature: string,
  latest: Blockhash,
  opts: ConfirmOptions = {},
): Promise<string> {
  for (;;) {
    const status = (await conn.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new TransactionFailed(status.err);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;

    // Only worth asking the chain's height when there is nothing to report.
    const height = await conn.getBlockHeight("confirmed").catch(() => 0);
    if (height > latest.lastValidBlockHeight) {
      if (await landed(conn, signature)) return signature;
      throw new NotSeen(signature);
    }

    const left = opts.deadlineMs === undefined ? Infinity : opts.deadlineMs - Date.now();
    if (left <= 0) {
      if (await landed(conn, signature)) return signature;
      throw new NotSeen(signature, "The deadline passed before the transaction was seen.");
    }
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, left)));
  }
}

/** The last word, through history: did this signature land, whatever else happened? */
export async function landed(conn: Connection, signature: string): Promise<boolean> {
  const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
  return (
    !!st?.value &&
    !st.value.err &&
    (st.value.confirmationStatus === "confirmed" || st.value.confirmationStatus === "finalized")
  );
}
