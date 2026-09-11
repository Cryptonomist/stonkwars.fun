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
    const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    return signature;
  } catch (err) {
    const st = await connection
      .getSignatureStatus(signature, { searchTransactionHistory: true })
      .catch(() => null);
    const landed =
      !!st?.value &&
      !st.value.err &&
      (st.value.confirmationStatus === "confirmed" || st.value.confirmationStatus === "finalized");
    if (!landed) throw err;
    return signature;
  }
}
