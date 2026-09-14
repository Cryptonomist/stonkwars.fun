"use client";

/* THE PRICE TO BEAT, for one corner.
 *
 * A fight is each stock against its own start, so the number a viewer needs
 * next to a ticker is where that stock started on chain and where it is now.
 *
 *   open      Now (live, with its source) and the move on the day
 *   accepted  Now, and when the start price will post; or, while the market
 *             that prices this side is shut, that the start posts at the open
 *   live      Start (the on-chain price, and when it printed), Now (live, with
 *             its source), and the move since the start
 *   final     Start and Bell, both on chain, and the move the program measured
 *
 * The on-chain prices are the ones that decide. The live one is for watching,
 * and carries the market it came from (Pyth, Exchange, Perp, ...), so nobody
 * mistakes a perp's mid at 2am for an exchange print. */

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { Move } from "@/components/Ticker";
import {
  STATUS_ACCEPTED,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  type DuelView,
  type PricePoint,
} from "@/lib/duel";
import { etTime, pythToNumber, usd } from "@/lib/format";
import { dayChangePct, movePct, quoteValue, type Quote } from "@/lib/prices";
import { sourceWords } from "@/lib/pricemath";

export function PriceToBeat({
  d,
  side,
  quote,
  shut,
  className,
}: {
  d: DuelView;
  side: "p1" | "p2";
  quote?: Quote;
  /** This side's market is shut at the boundary the fight is waiting on. */
  shut: boolean;
  className?: string;
}) {
  const right = side === "p2";
  const start = side === "p1" ? d.creatorStart : d.opponentStart;
  const end = side === "p1" ? d.creatorEnd : d.opponentEnd;
  const started = d.startTs > 0 && start.price > BigInt(0);
  const final = (d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED) && end.price > BigInt(0);

  const now = <NowRow quote={quote} right={right} />;

  let rows: React.ReactNode;
  let move: number | null = null;
  let moveLabel = "";

  if (d.status === STATUS_OPEN) {
    rows = now;
    move = dayChangePct(quote);
    moveLabel = "Today";
  } else if (!started) {
    rows =
      d.status === STATUS_ACCEPTED && shut ? (
        <p className="text-meta text-dim">Start price posts when its market opens.</p>
      ) : d.status === STATUS_ACCEPTED ? (
        <>
          {now}
          <p className="text-meta text-dim">Start price posts at its first price after the take.</p>
        </>
      ) : null;
  } else {
    rows = (
      <>
        <OnChainRow label="Start" p={start} right={right} />
        {final ? <OnChainRow label="Bell" p={end} right={right} /> : now}
      </>
    );
    const live = quoteValue(quote);
    move = final ? movePct(start, end) : live !== null && quote ? movePct(start, quote) : null;
    moveLabel = final ? "At the bell" : "Since start";
  }

  if (!rows) return null;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", right && "md:items-end", className)}>
      <dl className={cx("flex min-w-0 flex-col gap-1", right && "md:items-end")}>{rows}</dl>
      {moveLabel ? (
        <div className={cx("mt-1 flex items-baseline gap-2", right && "md:flex-row-reverse")}>
          <FlashNum value={move}>
            <Move value={move} className="text-num-lg font-semibold" />
          </FlashNum>
          <span className="label">{moveLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, right, children }: { label: string; right: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5", right && "md:flex-row-reverse")}>
      <dt className={cx("label w-10 shrink-0", right && "md:text-right")}>{label}</dt>
      {children}
    </div>
  );
}

function OnChainRow({ label, p, right }: { label: string; p: PricePoint; right: boolean }) {
  return (
    <Row label={label} right={right}>
      <dd className="num text-sm text-ink">{usd(pythToNumber(p.price, p.expo))}</dd>
      <dd className="text-meta text-dim">{etTime(p.publishTime)}</dd>
    </Row>
  );
}

function NowRow({ quote, right }: { quote?: Quote; right: boolean }) {
  const value = quoteValue(quote);
  return (
    <Row label="Now" right={right}>
      <dd className="num text-sm text-ink">
        {value !== null ? (
          <FlashNum value={value}>{usd(value)}</FlashNum>
        ) : (
          <span className="text-dim">--</span>
        )}
      </dd>
      {quote?.source ? (
        <dd>
          <Badge variant="source">{sourceWords(quote.source)}</Badge>
        </dd>
      ) : null}
    </Row>
  );
}
