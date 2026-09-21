import type { Metadata } from "next";

import { byTicker, CLUSTER, STAKEABLE } from "@/lib/stocks";
import type { Side } from "@/lib/swap";

import { TradeTerminal } from "./TradeTerminal";
import { pageMeta } from "@/lib/pageMeta";

export const metadata: Metadata = pageMeta(
  "Trade",
  CLUSTER === "mainnet-beta"
      ? "Buy and sell tokenized stocks on Solana, in your own wallet, and stake them in a fight."
      : "Live prices and charts for every tokenized stock on Solana. Free test shares to fight with, and the way to buy the real token in your own wallet.",
  "/trade",
);

/** /trade?t=TSLA&side=sell opens on that stock, on that side. */
export default async function TradePage({ searchParams }: { searchParams: Promise<{ t?: string; side?: string }> }) {
  const p = await searchParams;
  const asked = (p.t ?? "").toUpperCase();
  const ticker = byTicker(asked) && STAKEABLE.some((s) => s.ticker === asked) ? asked : STAKEABLE[0]?.ticker ?? "TSLA";
  const side: Side = p.side === "sell" ? "sell" : "buy";
  return <TradeTerminal ticker={ticker} side={side} />;
}
