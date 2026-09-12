"use client";

/* What is moving, which is what you pick a fighter from.
 *
 * The move on the day for the stocks anybody would actually stake, biggest
 * first. Every row is a fight waiting to be picked, so every row is a link
 * into the picker with that stock already in your corner. */

import Link from "next/link";

import { dayChangePct, quoteValue, usePrices } from "@/lib/prices";
import { usd } from "@/lib/format";
import { STAKEABLE, tradesAroundTheClock } from "@/lib/stocks";

const WATCHED = 24;

export function Movers({ rows = 8 }: { rows?: number }) {
  const stocks = STAKEABLE.slice(0, WATCHED);
  const prices = usePrices(stocks.map((s) => s.ticker), 15_000);

  const moved = stocks
    .map((s) => ({ s, change: dayChangePct(prices.data?.quotes[s.ticker]), price: quoteValue(prices.data?.quotes[s.ticker]) }))
    .filter((m): m is { s: (typeof stocks)[number]; change: number; price: number | null } => m.change !== null)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, rows);

  if (!moved.length) {
    return <p className="py-4 text-sm text-dim">Waiting for prices...</p>;
  }

  return (
    <ul className="flex flex-col">
      {moved.map(({ s, change, price }) => (
        <li key={s.ticker}>
          <Link
            href={`/new?p1=${s.ticker}`}
            className="flex items-baseline gap-2 border-t border-line py-1.5 first:border-t-0 hover:bg-panel-2"
          >
            <span className="h-2 w-2 shrink-0 self-center" style={{ background: s.color }} />
            <span className="display w-16 shrink-0 text-lg">{s.ticker}</span>
            <span className="truncate text-xs text-dim">{s.name}</span>
            {tradesAroundTheClock(s.ticker) ? (
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-up/70">24/7</span>
            ) : null}
            <span className="ml-auto shrink-0 font-mono text-xs text-dim">{price ? usd(price) : "--"}</span>
            <span className={`w-16 shrink-0 text-right font-mono text-sm ${change >= 0 ? "text-up" : "text-down"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
