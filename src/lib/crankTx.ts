/* The transactions that post a fight's prices and run its start or settle,
 * shared by the server crank (crank.ts) and the fight page's "do it yourself"
 * button (pythCrank.ts). Nothing here signs or sends, and nothing here needs
 * Node, so the browser can import it. */

import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type PublicKey,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { buildSettleDuel, buildStartDuel, SOURCE_PYTH, START_DELAY_SECS, type DuelView } from "./duel";

export type SignedTx = { tx: VersionedTransaction; signers: Signer[] };

export const boundaryOf = (d: DuelView, which: "start" | "settle") =>
  which === "start" ? d.acceptedTs + START_DELAY_SECS : d.endTs;

export const pythFeedsOf = (d: DuelView) =>
  [
    d.creatorSource === SOURCE_PYTH ? d.creatorFeed : null,
    d.opponentSource === SOURCE_PYTH ? d.opponentFeed : null,
  ].filter((f): f is string => f !== null);

/** Compute for the fight instruction, plus room for the Ed25519 checks. */
export const fightUnits = (which: "start" | "settle", quotes: number) =>
  (which === "start" ? 60_000 : 300_000) + 10_000 * quotes;

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
 * All of it is signed up front, so a browser wallet asks once, and sent in
 * order, each confirmed before the next. */
export async function crankTransactions(opts: {
  conn: Connection;
  receiver: PythSolanaReceiver;
  payer: PublicKey;
  duel: DuelView;
  which: "start" | "settle";
  /** Hermes update data for the fight's Pyth sides; empty if it has none. */
  pythUpdate: string[];
  quotes: TransactionInstruction[];
  priorityMicroLamports?: number;
}): Promise<SignedTx[]> {
  const { conn, receiver, payer, duel: d, which } = opts;
  const priority = opts.priorityMicroLamports ?? 20_000;
  const fee = { computeUnitPriceMicroLamports: priority, tightComputeBudget: true };

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
  const fight = which === "start" ? buildStartDuel(d, c, o) : buildSettleDuel(d, payer, c, o);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: fightUnits(which, opts.quotes.length) }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
      ...opts.quotes,
      fight,
    ],
  }).compileToV0Message();

  return [...post, { tx: new VersionedTransaction(message), signers: [] }, ...close];
}

/* Send already-signed transactions strictly in order, each confirmed before
 * the next, and when one fails say which and why: the on-chain logs, not the
 * "Unknown action 'undefined'" a batch sender reduces them to. */
export async function sendInOrder(conn: Connection, txs: VersionedTransaction[]): Promise<string[]> {
  const sigs: string[] = [];
  for (const [i, tx] of txs.entries()) {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    const latest = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction(
      { signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) {
      const detail = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = detail?.meta?.logMessages ?? [];
      const named = logs.map((l) => /Error Message: ([^.]+)/.exec(l)?.[1]).find(Boolean);
      const err = new Error(
        `Transaction ${i + 1} of ${txs.length} failed: ${named ?? JSON.stringify(res.value.err)}`,
      ) as Error & { logs?: string[] };
      err.logs = logs;
      throw err;
    }
    sigs.push(sig);
  }
  return sigs;
}
