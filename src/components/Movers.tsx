"use client";

/* What is moving, which is what you pick a fighter from.
 *
 * The move on the day for the stocks anybody would actually stake, biggest
 * first. Every row is a link to the stock's own page, where its chart, its
 * record on chain and the fights waiting on it are one tap from a fight.
 *
 * A 36px rail row answers four things: which stock (the ticker), its month
 * (a sparkline of daily closes, green or red for where the month went), what
 * it costs now, and how far it has moved today. The old row put the stock's
 * brand colour in a square beside a green or red number, which is two colours
 * making claims next to each other when only one of them was about a move, and
 * it printed the change with toFixed, so a quiet weekend showed "-0.00%".
 *
 * Numbers sit in fixed-width right-aligned columns, so a refresh never shifts
 * a row. The 24/7 slot is the same width with or without its badge for the
 * same reason. The name is the first thing to go when the rail is narrow: a
 * container query hides it below 22rem of list width, which is the home page's
 * right rail at 1280px and a phone. There the columns are budgeted to the
 * pixel (268px of rail): a 7-character price and a 6-character move fit their
 * 56px columns, and a longer one widens its column rather than overprinting. */

import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { Notice } from "@/components/ui/Notice";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Sparkline } from "@/components/ui/Sparkline";
import { pct, usd } from "@/lib/format";
import { dayChangePct, quoteValue, usePrices, type Quotes } from "@/lib/prices";
import { STAKEABLE, tradesAroundTheClock, type Stock } from "@/lib/stocks";
import { useCloses } from "@/lib/useCloses";

const WATCHED = 24;

/** The stocks the movers rail watches: the first of the stakeable roster. */
export const MOVER_STOCKS: readonly Stock[] = STAKEABLE.slice(0, WATCHED);

/** The watched stocks with a price, biggest move on the day first; a stock the
 *  source gave no previous close for goes last. Shared with the command
 *  palette's "Moving today", so both say the same thing. */
export function topMovers(quotes: Quotes["quotes"], rows: number) {
  return MOVER_STOCKS.map((s) => ({ s, change: dayChangePct(quotes[s.ticker]), price: quoteValue(quotes[s.ticker]) }))
    .filter((m) => m.price !== null)
    .sort((a, b) => (b.change === null ? -1 : Math.abs(b.change)) - (a.change === null ? -1 : Math.abs(a.change)))
    .slice(0, rows);
}

export function Movers({ rows = 8 }: { rows?: number }) {
  const tickers = MOVER_STOCKS.map((s) => s.ticker);
  const prices = usePrices(tickers, 15_000);
  // All the watched stocks, not the rows on show, so re-ordering asks for nothing new.
  const { closes } = useCloses(tickers);

  const moved = topMovers(prices.data?.quotes ?? {}, rows);

  if (!prices.data && prices.isPending) {
    return <SkeletonRows kind="quote" rows={rows} className="py-2" />;
  }

  if (!moved.length) {
    return (
      <Notice
        tone="error"
        title="Prices unavailable."
        action={
          <button type="button" onClick={() => void prices.refetch()} className="btn btn-sm btn-ghost">
            Retry
          </button>
        }
        className="my-2"
      >
        Moves fill in when prices return.
      </Notice>
    );
  }

  return (
    <ul className="@container flex flex-col" aria-label="Biggest moves today">
      {moved.map(({ s, change, price }) => (
        <li key={s.ticker} className="border-t border-line first:border-t-0">
          <Link
            href={`/s/${s.ticker}`}
            className="-mx-2 flex h-9 min-w-0 items-center gap-1.5 px-2 transition-colors hover:bg-panel-3 focus-visible:-outline-offset-2 @xs:gap-2"
          >
            <span className="display w-14 shrink-0 text-hud-xs text-ink">{s.ticker}</span>
            <span className="flex w-11 shrink-0">
              {tradesAroundTheClock(s.ticker) ? <Badge variant="neutral">24/7</Badge> : null}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-meta text-dim @[22rem]:block">{s.name}</span>
            <Sparkline
              values={closes[s.ticker] ?? []}
              width={40}
              height={14}
              tone="ink"
              label={sparkLabel(s.ticker, closes[s.ticker])}
              className="ml-auto opacity-50 @[22rem]:ml-0"
            />
            <FlashNum value={price} className="num min-w-14 shrink-0 text-right text-meta text-dim @sm:min-w-18">
              {price !== null ? usd(price) : "--"}
            </FlashNum>
            <FlashNum
              value={change}
              className={cx(
                "num min-w-14 shrink-0 text-right text-meta @sm:min-w-18",
                change === null ? "text-dim" : change > 0 ? "text-up" : change < 0 ? "text-down" : "text-dim",
              )}
            >
              {change !== null ? pct(change) : "--"}
            </FlashNum>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What a sparkline says, for a screen reader: where the month went. */
function sparkLabel(ticker: string, series: number[] | undefined): string {
  if (!series || series.length < 2) return `${ticker}: no month of closes`;
  const move = ((series[series.length - 1] - series[0]) / series[0]) * 100;
  return `${ticker} over the last month: ${pct(move)}`;
}
