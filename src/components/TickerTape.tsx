"use client";

/* The tape.
 *
 * Every serious thing on Solana opens with live numbers rather than a sentence
 * about itself, and this is ours: real prices for real tokenized shares,
 * moving, before anybody has read a word. Each stock links to its own page.
 *
 * It says nothing about any fight and decides nothing.
 *
 * ONE RUN FOR PEOPLE, ONE FOR THE LOOP. The strip slides the width of one run
 * and starts again, so the run is drawn twice, end to end. Only the first copy
 * is real to a screen reader and to the Tab key; the second is aria-hidden and
 * its links are out of the tab order, so tabbing reaches each stock once and
 * nobody is read a list of eighteen stocks twice. (The whole tape used to be
 * aria-hidden with its links still focusable, which hands a keyboard user
 * focus on things a screen reader says are not there.)
 *
 * A moving target cannot be focused, so the tape stops while focus is inside
 * it: the animation is dropped, the first copy sits at the start, and the
 * browser scrolls the focused stock into view. When focus leaves, the strip is
 * put back where the animation expects it. Hovering pauses it too (globals.css),
 * and under reduced motion it holds still. */

import Link from "next/link";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { pct, usd } from "@/lib/format";
import { dayChangePct, quoteValue, usePrices, type Quotes } from "@/lib/prices";
import { STAKEABLE, tradesAroundTheClock, type Stock } from "@/lib/stocks";

/** Roster order is most-traded first, so the front of it is the tape. */
const ON_THE_TAPE = 18;

export function TickerTape() {
  const stocks = STAKEABLE.slice(0, ON_THE_TAPE);
  const prices = usePrices(stocks.map((s) => s.ticker), 15_000);
  const [focused, setFocused] = useState(false);
  const region = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={region}
      role="region"
      aria-label="Live prices"
      className="relative overflow-hidden border-y border-line bg-panel"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (region.current?.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        // Focus scrolled the strip to show a stock; the animation expects it at rest.
        if (region.current) region.current.scrollLeft = 0;
      }}
    >
      <div className={cx("tape flex w-max", focused && "animate-none")}>
        <Run stocks={stocks} quotes={prices.data} />
        <Run stocks={stocks} quotes={prices.data} copy />
      </div>
    </div>
  );
}

function Run({ stocks, quotes, copy = false }: { stocks: Stock[]; quotes?: Quotes; copy?: boolean }) {
  /* Each run carries its own trailing gap (pr-6), so two runs end to end are
   * exactly twice one run, and sliding by half lands on the same picture. */
  return (
    <ul className="flex shrink-0 items-center gap-6 py-2 pr-6" aria-hidden={copy ? true : undefined}>
      {stocks.map((s) => {
        const q = quotes?.quotes[s.ticker];
        const price = quoteValue(q);
        const change = dayChangePct(q);
        return (
          <li key={s.ticker} className="shrink-0">
            <Link
              href={`/s/${s.ticker}`}
              tabIndex={copy ? -1 : undefined}
              className="flex items-baseline gap-2 px-1 transition-opacity hover:opacity-80 focus-visible:-outline-offset-2"
            >
              <span className="display text-hud-xs text-ink">{s.ticker}</span>
              <span className="num text-meta text-dim">{price !== null ? usd(price) : "--"}</span>
              {change !== null ? (
                <FlashNum
                  value={change}
                  className={cx("num text-meta", change > 0 ? "text-up" : change < 0 ? "text-down" : "text-dim")}
                >
                  {pct(change)}
                </FlashNum>
              ) : null}
              {tradesAroundTheClock(s.ticker) ? (
                <Badge variant="neutral" className="self-center">
                  24/7
                </Badge>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
