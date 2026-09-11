/* Post the boundary prices from Pyth and run start_duel or settle_duel, from
 * the browser, with the visitor's wallet paying. The settler does this within a
 * minute on its own; this is the proof that it does not have to be us.
 *
 * The update data comes from /api/pyth (which holds the Hermes key) and is
 * public, signed data: the key buys access, not trust. The receiver program
 * checks the guardian signatures, and the duel program then checks it is the
 * one first-after-the-boundary price. Loaded on demand, so the Pyth SDK is not
 * in the bundle of every page. */

import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

import { buildSettleDuel, buildStartDuel, START_DELAY_SECS, type DuelView } from "@/lib/duel";

type AnyTx = Transaction | VersionedTransaction;

export type BrowserWallet = {
  publicKey: PublicKey;
  signTransaction: <T extends AnyTx>(tx: T) => Promise<T>;
  signAllTransactions: <T extends AnyTx>(txs: T[]) => Promise<T[]>;
};

export async function crankWithPyth(opts: {
  connection: Connection;
  wallet: BrowserWallet;
  which: "start" | "settle";
  duel: DuelView;
}): Promise<string[]> {
  const { connection, wallet, which, duel } = opts;
  const boundary = which === "start" ? duel.acceptedTs + START_DELAY_SECS : duel.endTs;

  const r = await fetch(`/api/pyth?feeds=${duel.creatorFeed},${duel.opponentFeed}&t=${boundary}`, {
    cache: "no-store",
  });
  const body = (await r.json()) as { binary?: string[]; error?: string };
  if (!r.ok || !body.binary?.length) {
    throw new Error(body.error ?? "Pyth has no price after that boundary yet. Is the market open?");
  }

  // The SDK is typed against Anchor's NodeWallet; the adapter's signers are
  // the same shape.
  const receiver = new PythSolanaReceiver({ connection, wallet: wallet as never });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addPostPriceUpdates(body.binary);
  await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
    const account = (feed: string) => {
      try {
        return getPriceUpdateAccount(`0x${feed}`);
      } catch {
        return getPriceUpdateAccount(feed);
      }
    };
    const c = account(duel.creatorFeed);
    const o = account(duel.opponentFeed);
    const instruction =
      which === "start" ? buildStartDuel(duel, c, o) : buildSettleDuel(duel, wallet.publicKey, c, o);
    return [{ instruction, signers: [], computeUnits: which === "start" ? 60_000 : 300_000 }];
  });

  const txs = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 20_000,
    tightComputeBudget: true,
  });
  return receiver.provider.sendAll(txs, { skipPreflight: true });
}
