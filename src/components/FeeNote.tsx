"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";

import { feeRateFor, readFeeConfig, type FeeView } from "@/lib/duel";

/** The platform fee as the chain has it (programs/duel/src/fee.rs), read rarely. */
export function useFeeConfig() {
  const { connection } = useConnection();
  return useQuery<FeeView | null>({
    queryKey: ["fee-config"],
    queryFn: () => readFeeConfig(connection),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/* The fee, said beside what a win pays, before anybody signs. A duel pays the
 * rate in force when it was created, so a take quotes that duel's rate and a
 * new challenge quotes today's. With no fee there is nothing to say, and this
 * renders nothing. */
export function FeeNote({ createdTs, className }: { createdTs?: number; className?: string }) {
  const { data } = useFeeConfig();
  const bps = feeRateFor(data, createdTs ?? Math.floor(Date.now() / 1000));
  if (bps <= 0) return null;
  return (
    <p className={className}>
      A {pct(bps)} platform fee comes off the stake you take from them, and nothing off your own. No fee on a tie.
    </p>
  );
}
