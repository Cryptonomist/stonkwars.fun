/* Post the boundary prices and run start_duel or settle_duel, from the
 * browser, with the visitor's wallet paying. The settler does this within a
 * minute on its own; this is the proof that it does not have to be us.
 *
 * A Pyth side's update comes from /api/pyth (which holds the Hermes key) and is
 * public, signed data: the key buys access, not trust. The receiver program
 * checks the guardian signatures, and the duel program then checks it is the
 * one first-after-the-boundary price. A signed side's quote comes from
 * /api/quote, already signed by the oracle; the Ed25519 program checks the
 * signature in the same transaction. Every transaction is signed in one
 * wallet prompt (see crankTransactions). Loaded on demand, so the Pyth SDK is
 * not in the bundle of every page. */

import {
  Ed25519Program,
  PublicKey,
  type Connection,
  type Transaction,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { boundaryOf, crankTransactions, pythFeedsOf, sendInOrder } from "@/lib/crankTx";
import { readFeeConfig, SOURCE_SIGNED, type DuelView } from "@/lib/duel";

type AnyTx = Transaction | VersionedTransaction;

export type BrowserWallet = {
  publicKey: PublicKey;
  signTransaction: <T extends AnyTx>(tx: T) => Promise<T>;
  signAllTransactions: <T extends AnyTx>(txs: T[]) => Promise<T[]>;
};

async function signedQuotes(duel: DuelView, which: "start" | "settle"): Promise<TransactionInstruction[]> {
  if (duel.creatorSource !== SOURCE_SIGNED && duel.opponentSource !== SOURCE_SIGNED) return [];
  const r = await fetch(`/api/quote?duel=${duel.address.toBase58()}&which=${which}`, { cache: "no-store" });
  const body = (await r.json()) as {
    oracle?: string;
    quotes?: { message: string; signature: string }[];
    error?: string;
  };
  if (!r.ok || !body.oracle || !body.quotes) throw new Error(body.error ?? "The oracle has no quote yet.");
  const publicKey = new PublicKey(body.oracle).toBytes();
  return body.quotes.map((q) =>
    Ed25519Program.createInstructionWithPublicKey({
      publicKey,
      message: Buffer.from(q.message, "base64"),
      signature: Buffer.from(q.signature, "base64"),
    }),
  );
}

async function pythUpdate(duel: DuelView, boundary: number): Promise<string[]> {
  const feeds = pythFeedsOf(duel);
  if (!feeds.length) return [];
  const r = await fetch(`/api/pyth?feeds=${feeds.join(",")}&t=${boundary}`, { cache: "no-store" });
  const body = (await r.json()) as { binary?: string[]; error?: string };
  if (!r.ok || !body.binary?.length) {
    throw new Error(body.error ?? "Pyth has no price after that boundary yet. Is the market open?");
  }
  return body.binary;
}

export async function crankFromBrowser(opts: {
  connection: Connection;
  wallet: BrowserWallet;
  which: "start" | "settle";
  duel: DuelView;
}): Promise<string[]> {
  const { connection, wallet, which, duel } = opts;
  const boundary = boundaryOf(duel, which);
  const [quotes, update, fee] = await Promise.all([
    signedQuotes(duel, which),
    pythUpdate(duel, boundary),
    which === "settle" ? readFeeConfig(connection) : Promise.resolve(null),
  ]);

  // The SDK is typed against Anchor's NodeWallet; the adapter's signers are
  // the same shape.
  const receiver = new PythSolanaReceiver({ connection, wallet: wallet as never });
  const txs = await crankTransactions({
    conn: connection,
    receiver,
    payer: wallet.publicKey,
    duel,
    which,
    pythUpdate: update,
    quotes,
    fee,
  });
  // The throwaway accounts sign first; then the wallet signs everything in
  // one prompt.
  for (const { tx, signers } of txs) if (signers.length) tx.sign(signers);
  const signed = await wallet.signAllTransactions(txs.map((t) => t.tx));
  return sendInOrder(connection, signed);
}
