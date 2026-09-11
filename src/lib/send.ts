/* Send a signed transaction, and find out honestly whether it landed.
 *
 * Carried over from Commish, where it was learned the hard way: A BLOCKHASH
 * EXPIRING IS NOT A FAILED TRANSACTION. A phone that switches to its wallet app
 * and back, or somebody who reads the popup carefully, routinely outlives the
 * blockhash, and `confirmTransaction` then throws while the transaction may
 * well have landed. Telling somebody their stake did not move when it did is
 * worse than any other error, so an expiry asks the chain rather than assuming.
 */

import type { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

import { confirmSignature, landed, TransactionFailed } from "./confirm";

export type Blockhash = { blockhash: string; lastValidBlockHeight: number };

export async function sendAndConfirm(
  connection: Connection,
  signed: Transaction | VersionedTransaction,
  latest: Blockhash,
  onSent?: (signature: string) => void,
): Promise<string> {
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    preflightCommitment: "confirmed",
  });
  onSent?.(signature);

  try {
    return await confirmSignature(connection, signature, latest);
  } catch (err) {
    // A transaction the chain rejected is settled; anything else, ask again.
    if (err instanceof TransactionFailed) throw err;
    if (await landed(connection, signature)) return signature;
    throw err;
  }
}
