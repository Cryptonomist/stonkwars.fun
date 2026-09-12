"use client";

/* The tape.
 *
 * Every serious thing on Solana opens with live numbers rather than a sentence
 * about itself, and this is ours: real prices for real tokenized shares,
 * moving, before anybody has read a word. It is also the quickest proof of the
 * claim the page makes, which is that a thousand of these exist.
 *
 * It says nothing about any fight and decides nothing. */

import Link from "next/link";

import { dayChangePct, quoteValue, usePrices } from "@/lib/prices";
import { usd } from "@/lib/format";
import { STAKEABLE, tradesAroundTheClock } from "@/lib/stocks";

/** Roster order is most-traded first, so the front of it is the tape. */
const ON_THE_TAPE = 18;

export function TickerTape() {
  const stocks = STAKEABLE.slice(0, ON_THE_TAPE);
  const prices = usePrices(stocks.map((s) => s.ticker), 15_000);

  // Twice, so the second copy is sliding in as the first slides out.
  const run = [...stocks, ...stocks];

  return (
    <div className="relative overflow-hidden border-y border-line bg-panel" aria-hidden="true">
      <div className="tape flex w-max items-center gap-6 py-2">
        {run.map((s, i) => {
          const q = prices.data?.quotes[s.ticker];
          const price = quoteValue(q);
          const change = dayChangePct(q);
          return (
            <Link
              key={`${s.ticker}-${i}`}
              href={`/new?p1=${s.ticker}`}
              className="flex shrink-0 items-baseline gap-2 px-1 hover:opacity-80"
            >
              <span className="h-2 w-2 shrink-0 self-center" style={{ background: s.color }} />
              <span className="display text-lg">{s.ticker}</span>
              <span className="font-mono text-xs text-dim">{price ? usd(price) : "--"}</span>
              {change !== null ? (
                <span className={`font-mono text-xs ${change >= 0 ? "text-up" : "text-down"}`}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              ) : null}
              {tradesAroundTheClock(s.ticker) ? (
                <span className="text-[9px] font-bold uppercase tracking-wider text-up/70">24/7</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
