import type { Metadata } from "next";

import { byTicker, STAKEABLE } from "@/lib/stocks";
import type { Side } from "@/lib/swap";

import { TradeTerminal } from "./TradeTerminal";

export const metadata: Metadata = {
  title: "Trade",
  description: "Buy and sell tokenized stocks on Solana, in your own wallet, and stake them in a fight.",
};

/** /trade?t=TSLA&side=sell opens on that stock, on that side. */
export default async function TradePage({ searchParams }: { searchParams: Promise<{ t?: string; side?: string }> }) {
  const p = await searchParams;
  const asked = (p.t ?? "").toUpperCase();
  const ticker = byTicker(asked) && STAKEABLE.some((s) => s.ticker === asked) ? asked : STAKEABLE[0]?.ticker ?? "TSLA";
  const side: Side = p.side === "sell" ? "sell" : "buy";
  return <TradeTerminal ticker={ticker} side={side} />;
}
