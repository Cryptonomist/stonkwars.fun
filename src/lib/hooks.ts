"use client";

/* Reading the chain, and writing to it, from components. */

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type GetProgramAccountsFilter,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  allProfiles,
  allXClaims,
  decodeDuel,
  decodeProfile,
  decodeXClaim,
  PROGRAM_ID,
  type DuelView,
} from "@/lib/duel";
import { sendAndConfirm } from "@/lib/send";
import { isListedDuel } from "@/lib/stocks";

/** One duel, polled. `null` means the account does not exist (never did, or
 *  was cancelled and closed). */
export function useDuel(address: PublicKey | null, refetchMs = 3_000) {
  const { connection } = useConnection();
  return useQuery<DuelView | null>({
    queryKey: ["duel", address?.toBase58()],
    enabled: !!address,
    queryFn: async () => {
      const info = await connection.getAccountInfo(address!, "confirmed");
      if (!info || !info.owner.equals(PROGRAM_ID)) return null;
      return decodeDuel(address!, info.data);
    },
    refetchInterval: refetchMs,
  });
}

/** Many duels, by memcmp filter. Newest first. Only fights between two listed
 *  stocks: this is what every board and tally reads, so leaving out the old
 *  test fights here leaves them out everywhere. A fight's own page reads its
 *  account through useDuel and still loads. */
export function useDuels(key: string, filters: GetProgramAccountsFilter[] | null, refetchMs = 10_000) {
  const { connection } = useConnection();
  return useQuery<DuelView[]>({
    queryKey: ["duels", key],
    enabled: !!filters,
    queryFn: async () => {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: filters!,
      });
      const out: DuelView[] = [];
      for (const a of accounts) {
        try {
          const d = decodeDuel(a.pubkey, a.account.data);
          if (isListedDuel(d)) out.push(d);
        } catch {
          /* An account that does not decode is not a duel this client knows. */
        }
      }
      return out.sort((x, y) => y.createdTs - x.createdTs);
    },
    refetchInterval: refetchMs,
  });
}

/* Every handle the chain will vouch for, by wallet.
 *
 * A profile counts only when the X account it names points back at it, which
 * is what makes a profile left behind by somebody moving wallets go quiet on
 * its own, with nobody having to tidy it up. */
export function useProfiles() {
  const { connection } = useConnection();
  return useQuery<Record<string, string>>({
    queryKey: ["profiles"],
    queryFn: async () => {
      const [profiles, claims] = await Promise.all([
        connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allProfiles() }),
        connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allXClaims() }),
      ]);

      const owns = new Map<string, string>();
      for (const c of claims) {
        try {
          const claim = decodeXClaim(c.account.data);
          owns.set(claim.xId.toString(), claim.wallet.toBase58());
        } catch {
          /* Not a claim this client knows how to read. */
        }
      }

      const byWallet: Record<string, string> = {};
      for (const p of profiles) {
        try {
          const profile = decodeProfile(p.account.data);
          const wallet = profile.wallet.toBase58();
          if (owns.get(profile.xId.toString()) === wallet) byWallet[wallet] = profile.handle;
        } catch {
          /* Same. */
        }
      }
      return byWallet;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Raw token balance of an owner's account, or null if it does not exist. */
export function useTokenBalance(account: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery<bigint | null>({
    queryKey: ["balance", account?.toBase58()],
    enabled: !!account,
    queryFn: async () => {
      const info = await connection.getTokenAccountBalance(account!, "confirmed").catch(() => null);
      return info ? BigInt(info.value.amount) : null;
    },
    refetchInterval: 8_000,
  });
}

/** Sign and send one transaction made of `ixs`, and confirm it honestly. */
export function useSend() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const qc = useQueryClient();

  return useCallback(
    async (ixs: TransactionInstruction[], onSent?: (sig: string) => void) => {
      if (!publicKey || !signTransaction) throw new Error("Connect a wallet first.");
      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest });
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(...ixs);
      const signed = await signTransaction(tx);
      const sig = await sendAndConfirm(connection, signed, latest, onSent);
      void qc.invalidateQueries();
      return sig;
    },
    [connection, publicKey, signTransaction, qc],
  );
}

export const explorerTx = (sig: string, cluster: string) =>
  `https://explorer.solana.com/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export const explorerAddress = (addr: string, cluster: string) =>
  `https://explorer.solana.com/address/${addr}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
