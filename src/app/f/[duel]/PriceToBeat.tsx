"use client";

/* THE PRICE TO BEAT, for one corner.
 *
 * A fight is each stock against its own start, so the number a viewer needs
 * next to a ticker is where that stock started on chain and where it is now.
 *
 *   open      Now (live, with its source) and the move on the day
 *   accepted  Now, and when the start price will post; or, while the market
 *             that prices this side is shut, that the start posts at the open;
 *             or, once roundClock says the settler is late, that it is late
 *             and anyone can post it
 *   live      Start (the on-chain price, and when it printed), Now (live, with
 *             its source), and the move since the start
 *   final     Start and Bell, both on chain, and the move the program measured
 *
 * The on-chain prices are the ones that decide. The live one is for watching,
 * and carries the market it came from (Pyth, Exchange, Perp, ...), so nobody
 * mistakes a perp's mid at 2am for an exchange print.
 *
 * ON A PHONE the two corners share one row, about 145px each, so the rows drop
 * their print times (the receipt keeps them) and the prices step down to meta
 * size. The right corner mirrors the left at every width. */

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { Tip } from "@/components/ui/Tip";
import { Move, movePair } from "@/components/Ticker";
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
  late = false,
  other = null,
  className,
}: {
  /** The other corner's move over the same span, so two close moves widen together. */
  other?: number | null;
  d: DuelView;
  side: "p1" | "p2";
  quote?: Quote;
  /** This side's market is shut at the boundary the fight is waiting on. */
  shut: boolean;
  /** roundClock(...).manual is set: the settler has missed its window. */
  late?: boolean;
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
    /* A late start must not keep promising the price is on its way: two days
     * after a take, "posts at its first price" contradicted the status line
     * right above it, which says the settler is late. */
    rows =
      d.status === STATUS_ACCEPTED && shut ? (
        <p className="text-meta text-dim">Start price posts when its market opens.</p>
      ) : d.status === STATUS_ACCEPTED ? (
        <>
          {now}
          <p className="text-meta text-dim">
            {late ? "Start price is late. Anyone can post it from Actions." : "Start price posts at its first price after the take."}
          </p>
        </>
      ) : null;
  } else {
    rows = (
      <>
        <OnChainRow label="Start" p={start} right={right} />
        {final ? <OnChainRow label="Bell" p={end} bell={d.endTs} right={right} /> : now}
      </>
    );
    const live = quoteValue(quote);
    move = final ? movePct(start, end) : live !== null && quote ? movePct(start, quote) : null;
    moveLabel = final ? "At the bell" : "Since start";
  }

  if (!rows) return null;
  /* A day move has no rival over the same span; a round's moves do. */
  const text =
    moveLabel !== "Today" && move !== null && other !== null
      ? side === "p1"
        ? movePair(move, other)[0]
        : movePair(other, move)[1]
      : undefined;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", right && "items-end", className)}>
      <dl className={cx("flex min-w-0 max-w-full flex-col gap-1", right && "items-end")}>{rows}</dl>
      {moveLabel ? (
        <div className={cx("mt-1 flex flex-wrap items-baseline gap-x-2", right && "flex-row-reverse")}>
          <FlashNum value={move}>
            <Move value={move} text={text} className="text-num-lg font-semibold" />
          </FlashNum>
          <span className="label">{moveLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, right, children }: { label: string; right: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 md:gap-x-2", right && "flex-row-reverse")}>
      <dt className={cx("label shrink-0 md:w-10", right && "text-right")}>{label}</dt>
      {children}
    </div>
  );
}

/* A BELL PRICE STAMPED AFTER THE BELL IS NOT LATE. The program takes each
 * side's first price at or after the bell (quote.rs, pyth.rs), and a minute
 * bar stamped 8:02 can be the first one after an 8:01 bell. Printed bare beside
 * "8:00 to 8:01 AM ET" it read as a late or wrong price, so the time explains
 * itself. Only the bell: the start is the later of the two sides' first prints
 * after the take, so one side's start price can honestly predate it. */
function OnChainRow({ label, p, bell, right }: { label: string; p: PricePoint; bell?: number; right: boolean }) {
  const when = etTime(p.publishTime);
  const after = bell !== undefined && bell > 0 && p.publishTime > bell;
  return (
    <Row label={label} right={right}>
      <dd className="num text-meta text-ink md:text-sm">{usd(pythToNumber(p.price, p.expo))}</dd>
      <dd className="hidden text-meta text-dim md:block">
        {after ? <Tip label={`The first price at or after the ${etTime(bell, false)} bell. The program takes that one.`}>{when}</Tip> : when}
      </dd>
    </Row>
  );
}

function NowRow({ quote, right }: { quote?: Quote; right: boolean }) {
  const value = quoteValue(quote);
  return (
    <Row label="Now" right={right}>
      <dd className="num text-meta text-ink md:text-sm">
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
