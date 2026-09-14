"use client";

/* WHAT A WALLET HOLDS: its SOL and every listed stock token, valued now.
 *
 * This lived inside the wallet menu, which read it only while the menu was
 * open. A profile needs the same answer (a wallet with $1,000 of test shares
 * and no fights used to say only "No fights on chain"), so the reader is one
 * hook both use, under the same query keys, so a profile and the menu share a
 * single read.
 *
 * Both token programs are asked, because tokenized stocks live under either,
 * and the account bytes are read directly: mint in the first 32 bytes, amount
 * as a little-endian u64 at 64, which Token-2022 keeps in its base layout.
 * Tokens that are not listed stocks are skipped. Values come from usePrices,
 * the same live quotes every board shows; a stock with no price says so
 * rather than counting as zero. Read every 20 seconds while `enabled`. */

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./duel";
import { stakeValue, usePrices } from "./prices";
import { tokenForMint } from "./stocks";

export const SOL_DECIMALS = 9;

export type Holding = { ticker: string; raw: bigint; decimals: number };
export type ValuedHolding = Holding & { usd: number | null };

function readTokenAccount(data: Uint8Array): { mint: string; amount: bigint } | null {
  if (data.length < 72) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { mint: new PublicKey(data.subarray(0, 32)).toBase58(), amount: view.getBigUint64(64, true) };
}

export function useHoldings(address: string | null, enabled = true) {
  const { connection } = useConnection();
  const on = enabled && !!address;

  const sol = useQuery<number>({
    queryKey: ["sol-balance", address],
    enabled: on,
    queryFn: () => connection.getBalance(new PublicKey(address!), "confirmed"),
    refetchInterval: on ? 20_000 : false,
  });

  const holdings = useQuery<Holding[]>({
    queryKey: ["holdings", address],
    enabled: on,
    queryFn: async () => {
      const owner = new PublicKey(address!);
      const [classic, t22] = await Promise.all([
        connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      const byTicker = new Map<string, Holding>();
      for (const a of [...classic.value, ...t22.value]) {
        const acct = readTokenAccount(a.account.data);
        if (!acct || acct.amount === BigInt(0)) continue;
        const token = tokenForMint(acct.mint);
        if (!token) continue;
        const had = byTicker.get(token.ticker);
        byTicker.set(token.ticker, {
          ticker: token.ticker,
          raw: (had?.raw ?? BigInt(0)) + acct.amount,
          decimals: token.decimals,
        });
      }
      return [...byTicker.values()];
    },
    refetchInterval: on ? 20_000 : false,
  });

  const tickers = on ? (holdings.data ?? []).map((h) => h.ticker) : [];
  const prices = usePrices(tickers, 10_000);
  const valued: ValuedHolding[] = (holdings.data ?? [])
    .map((h) => ({ ...h, usd: stakeValue(h.raw, h.decimals, prices.data?.quotes[h.ticker]) }))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.ticker.localeCompare(b.ticker));
  /** The sum of what has a price; null until prices are in for something. */
  const priced = valued.filter((h) => h.usd !== null);
  const total = priced.length ? priced.reduce((sum, h) => sum + (h.usd ?? 0), 0) : null;

  return { sol, holdings, valued, total, unpriced: valued.length - priced.length };
}
