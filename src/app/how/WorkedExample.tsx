"use client";

/* THE RULES, SHOWN ON A FIGHT THAT HAPPENED.
 *
 * "The bigger percentage move wins" is one sentence, and it still reads as
 * abstract until you see it on two real prices. So the page picks the newest
 * fight the program settled between two listed stocks and does the sum in the
 * open: each side's start and bell price as the account recorded them, the
 * move between them, the gap, and what the winner took. Every figure is the
 * one the fight page prints for the same fight, from the same account and the
 * same formatters, and the receipt is one tap away to check it.
 *
 * WHICH FIGHT. The newest decided one, with a preference for a fair-looking
 * example: two different stocks, and two stakes worth within 5% of each other
 * at their start prices. A fight between unequal stakes is still a real
 * result, but as the one example on the rules page it would teach the wrong
 * thing about what a take is worth. Without such a fight the newest decided
 * one stands in; with none at all, the section is not rendered, rather than
 * shown with made-up numbers. */

import Link from "next/link";
import { useMemo } from "react";

import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Plate } from "@/components/ui/Plate";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { isDecided, isRosterFight, loserTake, margin, moves, winnerSide } from "@/lib/derive";
import { allDuels, type DuelView, type PricePoint } from "@/lib/duel";
import { etWhen, pctPair, points, pythToNumber, shares, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { decimalsForMint, tickerForMint, tokenSymbol } from "@/lib/stocks";

/** How far apart two stakes may be, at their start prices, to count as even. */
const EVEN_STAKES = 0.05;

const startValue = (amount: bigint, mint: DuelView["creatorMint"], start: PricePoint) =>
  (Number(amount) / 10 ** decimalsForMint(mint)) * pythToNumber(start.price, start.expo);

function evenStakes(d: DuelView): boolean {
  const a = startValue(d.creatorAmount, d.creatorMint, d.creatorStart);
  const b = startValue(d.opponentAmount, d.opponentMint, d.opponentStart);
  const big = Math.max(a, b);
  return big > 0 && Math.abs(a - b) / big <= EVEN_STAKES;
}

/** The fight the page explains, or null when no listed fight has a result. */
export function pickExample(duels: DuelView[]): DuelView | null {
  const decided = duels
    .filter((d) => isRosterFight(d) && isDecided(d) && moves(d) !== null)
    .sort((a, b) => b.endTs - a.endTs || a.address.toBase58().localeCompare(b.address.toBase58()));
  const distinct = (d: DuelView) => tickerForMint(d.creatorMint) !== tickerForMint(d.opponentMint);
  return decided.find((d) => distinct(d) && evenStakes(d)) ?? decided.find(distinct) ?? decided[0] ?? null;
}

export function WorkedExample({ className }: { className?: string }) {
  const duels = useDuels("all", allDuels());
  const d = useMemo(() => (duels.data ? pickExample(duels.data) : null), [duels.data]);

  if (duels.isPending) {
    return (
      <Plate rope pad="std" aria-busy="true" className={cx("flex flex-col gap-3", className)}>
        <span className="sr-only" role="status">
          Loading a settled fight
        </span>
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </Plate>
    );
  }
  if (!d) return null;

  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const [m1, m2] = moves(d)!;
  const pair = pctPair(m1, m2);
  const gap = margin(d)!;
  const won = winnerSide(d)!;
  const take = loserTake(d)!;
  const winner = won === "p1" ? t1 : t2;
  const address = d.address.toBase58();

  return (
    <Plate
      as="section"
      id="a-real-fight"
      rope
      pad="std"
      aria-labelledby="a-real-fight-title"
      className={cx("flex scroll-mt-20 flex-col gap-3", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="a-real-fight-title" className="label">
          Worked example · a real fight
        </h2>
        {/* The date keeps to one line, so on a phone it drops whole under the
          * pair instead of leaving "ET" on a line of its own, and the
          * separator is only drawn where the two share a line. */}
        <p className="flex min-w-0 flex-wrap gap-x-1.5 text-sm text-ink">
          <span className="font-semibold">
            {t1} vs {t2}
          </span>
          <span className="whitespace-nowrap text-dim">
            <span className="hidden sm:inline">· </span>
            {etWhen(d.startTs, d.endTs)}
          </span>
        </p>
      </div>

      <dl className="flex flex-col">
        <SideRow side="p1" ticker={t1} start={d.creatorStart} end={d.creatorEnd} move={m1} text={pair[0]} won={won === "p1"} />
        <SideRow side="p2" ticker={t2} start={d.opponentStart} end={d.opponentEnd} move={m2} text={pair[1]} won={won === "p2"} />
      </dl>

      <p className="text-sm text-ink">
        {winner} won by <span className="num">{points(gap)}</span> percentage points and took{" "}
        <span className="num">{shares(take.shares, take.decimals)}</span>{" "}
        <span className="normal-case">{tokenSymbol(take.ticker)}</span>, worth{" "}
        <span className="num">{usd(take.usd)}</span> at the bell.
      </p>
      <p className="text-meta text-dim">
        Each move is the bell price over the start price. The bigger move wins, whatever either share costs.
      </p>
      <Link href={`/f/${address}`} className="link w-fit text-sm">
        See the receipt<span aria-hidden="true"> &rarr;</span>
      </Link>
    </Plate>
  );
}

function SideRow({
  side,
  ticker,
  start,
  end,
  move,
  text,
  won,
}: {
  side: "p1" | "p2";
  ticker: string;
  start: PricePoint;
  end: PricePoint;
  move: number;
  /** The move formatted beside its rival's (pctPair), so close moves differ. */
  text: string;
  won: boolean;
}) {
  /* One line from 640px: side, prices, move. On a phone the prices take a
   * second line under the side and the move, because the three together are
   * wider than 311px and a price broken over two lines stops reading as one. */
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-line py-2 first:border-t-0 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]">
      <dt className="flex min-w-0 items-center gap-2">
        <span
          className={cx("display truncate text-hud-xs", side === "p1" ? "text-p1" : "text-p2", !won && "opacity-50")}
        >
          {ticker}
        </span>
        <span aria-hidden="true" className="flex shrink-0">
          {won ? <Badge variant="win">W</Badge> : <Badge variant="cooked" />}
        </span>
        <span className="sr-only">{won ? ", won" : ", cooked"}</span>
      </dt>
      <dd className="num col-span-2 row-start-2 min-w-0 text-sm text-ink sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {usd(pythToNumber(start.price, start.expo))} <span className="text-dim">to</span>{" "}
        {usd(pythToNumber(end.price, end.expo))}
      </dd>
      <dd className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        <Move value={move} text={text} className="text-sm tabular-nums" />
      </dd>
    </div>
  );
}
