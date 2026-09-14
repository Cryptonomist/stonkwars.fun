"use client";

/* Reading a fight's receipt from the chain: the transactions that touched its
 * account, and the events inside them (receipt.ts does the reading).
 *
 * Two calls. getSignaturesForAddress lists the newest 25 signatures on the duel
 * account; the ones that failed changed nothing and are skipped; then the ten
 * newest of the rest are fetched in one batched getTransaction request. A
 * fight's whole life is a handful of transactions (made, taken, started,
 * settled), so ten is room to spare, and the relay allows batches of twenty.
 *
 * While the fight can still change, it reads again every 15 seconds, and at
 * once when the status changes (the status is in the key). Once it is settled
 * or refunded nothing more will happen to it, so it is read once and kept. */

import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";

import { STATUS_REFUNDED, STATUS_SETTLED, type DuelView } from "./duel";
import { classifyTx, type ReceiptEvent, type TxLike } from "./receipt";

export type ReceiptData = {
  events: ReceiptEvent[];
  /** The node answered with no signatures at all for this account. */
  noHistory: boolean;
};

const SIGNATURES = 25;
const TRANSACTIONS = 10;

export function useReceipt(d: DuelView | null | undefined) {
  const { connection } = useConnection();
  const address = d?.address.toBase58();
  const final = d?.status === STATUS_SETTLED || d?.status === STATUS_REFUNDED;

  return useQuery<ReceiptData>({
    queryKey: ["receipt", address, d?.status],
    enabled: !!d,
    queryFn: async () => {
      const sigs = await connection.getSignaturesForAddress(d!.address, { limit: SIGNATURES }, "confirmed");
      if (sigs.length === 0) return { events: [], noHistory: true };
      const wanted = sigs.filter((s) => !s.err).slice(0, TRANSACTIONS).map((s) => s.signature);
      if (wanted.length === 0) return { events: [], noHistory: false };
      const txs = await connection.getTransactions(wanted, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      const events: ReceiptEvent[] = [];
      for (const tx of txs) {
        const e = classifyTx(tx as unknown as TxLike | null, address);
        if (e) events.push(e);
      }
      return { events, noHistory: false };
    },
    refetchInterval: final ? false : 15_000,
    staleTime: final ? Infinity : 10_000,
  });
}
