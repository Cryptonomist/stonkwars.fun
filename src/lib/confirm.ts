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
  constructor(readonly signature: string) {
    super("The blockhash expired before the transaction was seen.");
    this.name = "NotSeen";
  }
}

/** Resolves when the signature is confirmed; throws if it failed or expired. */
export async function confirmSignature(conn: Connection, signature: string, latest: Blockhash): Promise<string> {
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
    await new Promise((r) => setTimeout(r, POLL_MS));
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
