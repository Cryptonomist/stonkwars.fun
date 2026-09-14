"use client";

/* THE MAIN EVENT: the one big thing on the front page, and it is a fight.
 *
 * The biggest type on the home page used to be a slogan, 40px of "Your stock
 * vs theirs", while a real round with hours on its clock sat below it as a
 * 64px row. The brief keeps big type for one live thing per screen, so that
 * slot now holds the fight itself: the round nearest its bell, with both
 * tickers, both live moves, the health bars across the full width of the
 * plate, the clock and who is ahead. From 1024px a small race line draws the
 * path so far beside it.
 *
 * QUIET LOOKS QUIET. With no round running it shows the latest result
 * instead, with its real age: who won, by how many percentage points, and
 * what they took, the loser's ticker at half strength beside the mini COOKED
 * stamp. With neither on chain it renders nothing, and the page keeps its
 * pitch line.
 *
 * Everything is read from the same cached duel list the ring polls, and the
 * same price and bar queries the fight page uses, so it costs no new kind of
 * request. It is still: no ping, no shake, no glow. Those belong to the fight
 * page, which a tap on this plate opens. */

import Link from "next/link";

import { HealthBars } from "@/components/HealthBars";
import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import { cx } from "@/components/ui/cx";
import { Skeleton } from "@/components/ui/Skeleton";
import { allDuels, STATUS_LIVE, type DuelView } from "@/lib/duel";
import { isDecided, isRosterFight, loserTake, margin, moves, winnerSide, type Side } from "@/lib/derive";
import { leadWords } from "@/lib/fightClock";
import { ago, etTime, points, span, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { movePct, usePrices } from "@/lib/prices";
import { yHalfRange, type PctPt } from "@/lib/raceSeries";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";
import { useRaceSeries, type RaceSeries } from "@/lib/useRaceSeries";

/** The fight the front page leads with: the live roster round nearest its
 *  bell, or failing that the latest roster fight with a result. */
export function pickMainEvent(duels: DuelView[], now: number): DuelView | null {
  const roster = duels.filter(isRosterFight);
  const live = roster.filter((d) => d.status === STATUS_LIVE && d.endTs > now).sort((a, b) => a.endTs - b.endTs);
  if (live.length) return live[0];
  return roster.filter(isDecided).sort((a, b) => b.endTs - a.endTs)[0] ?? null;
}

export function MainEvent() {
  const duels = useDuels("all", allDuels());
  const now = useNow();
  if (!duels.data || !now) {
    return duels.error && !duels.data ? null : <Skeleton className="h-36 w-full lg:h-40" />;
  }
  const d = pickMainEvent(duels.data, now);
  // Keyed by fight, so a bell that hands the slot to a result starts it clean.
  return d ? <EventPlate key={d.address.toBase58()} d={d} now={now} /> : null;
}

function EventPlate({ d, now }: { d: DuelView; now: number }) {
  const address = d.address.toBase58();
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const live = d.status === STATUS_LIVE && d.endTs > now;

  const prices = usePrices(live ? [t1, t2] : []);
  const quotes = prices.data;
  const series = useRaceSeries(d, t1, t2, quotes, now);

  /* Live moves from each side's on-chain start to its live price; a result's
   * moves from the chain's own start and bell prices. */
  const liveMove = (start: DuelView["creatorStart"], ticker: string) => {
    const q = quotes?.quotes[ticker];
    return q && d.startTs && start.price > BigInt(0) ? movePct(start, q) : null;
  };
  const onChain = moves(d);
  const m1 = live ? liveMove(d.creatorStart, t1) : (onChain?.[0] ?? null);
  const m2 = live ? liveMove(d.opponentStart, t2) : (onChain?.[1] ?? null);

  const won = winnerSide(d);
  const take = loserTake(d);
  const gap = margin(d);
  const roundSecs = Math.max(60, d.endTs - d.startTs);
  const winner = won === "p1" ? t1 : t2;

  const corner = (s: Side) => {
    const ticker = s === "p1" ? t1 : t2;
    const move = s === "p1" ? m1 : m2;
    const isWinner = won === s;
    const isLoser = won !== undefined && !isWinner;
    return (
      <div className={cx("flex min-w-0 items-center gap-2 sm:gap-3", s === "p2" && "flex-row-reverse")}>
        <span
          className={cx(
            "display min-w-0 truncate text-hud-sm normal-case sm:text-hud-lg",
            s === "p1" ? "text-p1" : "text-p2",
            isLoser && "opacity-50",
          )}
        >
          {ticker}
        </span>
        <span className={cx("flex shrink-0 items-center gap-2", s === "p2" && "flex-row-reverse")}>
          <Move value={move} className="num text-sm sm:text-num-lg" />
          {isWinner ? (
            <Badge variant="win" title="Won at the bell">
              W
            </Badge>
          ) : null}
          {isLoser ? <Badge variant="cooked" /> : null}
        </span>
      </div>
    );
  };

  const lead = live ? leadWords(t1, t2, m1, m2) : null;

  return (
    <Link
      href={`/f/${address}`}
      className="plate-card rope row block min-w-0 p-4 focus-visible:-outline-offset-2"
    >
      <span className="sr-only">{live ? "Main event, live now: " : "Latest result: "}</span>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {live ? <Badge variant="live" /> : <Badge>Final</Badge>}
            <span className="label min-w-0 truncate">
              {live ? (
                <>
                  <span className="hidden sm:inline">Main event · </span>
                  {span(roundSecs)} round
                </>
              ) : (
                `Last bell ${ago(d.endTs, now)}`
              )}
            </span>
            {live ? (
              /* On a phone the clock rides the top line; from 640px it sits
               * between the corners. */
              <span className="ml-auto shrink-0 sm:hidden">
                <Countdown to={d.endTs} now={now} className="text-num-lg text-ink" />
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            {corner("p1")}
            {/* Empty on a phone: the health bars' VS sits right under it. */}
            <div className="flex flex-col items-center">
              {live ? (
                <span className="hidden sm:inline-flex">
                  <Countdown to={d.endTs} now={now} size="clock" className="text-ink" />
                </span>
              ) : (
                <span className="hidden text-meta text-dim sm:inline">{span(roundSecs)} round</span>
              )}
            </div>
            {corner("p2")}
          </div>

          <HealthBars p1Move={m1} p2Move={m2} roundSecs={roundSecs} ko={live || !won ? null : won === "p1" ? "p2" : "p1"} />

          <p className="min-w-0 truncate text-meta text-dim">
            {live ? (
              <>
                <span className="text-ink">{lead ?? "Waiting for the first live prices"}</span>
                <span className="hidden sm:inline"> · bell {etTime(d.endTs)}</span>
              </>
            ) : (
              <>
                <span className="text-ink">
                  {winner} cooked {won === "p1" ? t2 : t1}
                  {gap !== null ? ` by ${points(gap)} percentage points` : ""}
                </span>
                {take ? (
                  <>
                    {" "}
                    · <span className="num text-up">took {usd(take.usd)}</span>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>

        <div className="hidden min-w-0 flex-col gap-1 lg:flex">
          <RaceSpark series={series} live={live} now={now} t1={t1} t2={t2} />
          <p className="micro text-dim">{live ? "The race so far · for watching" : "The round · for watching"}</p>
        </div>
      </div>
    </Link>
  );
}

/* THE RACE, SMALL. Both sides as a move from their own on-chain start, on one
 * symmetric scale around zero, with no axes: the fight page has the full
 * chart. A live round is drawn from its start to now, not to the bell, so the
 * path fills the width instead of huddling at the left of a four-hour axis. */
function RaceSpark({
  series,
  live,
  now,
  t1,
  t2,
}: {
  series: RaceSeries | null;
  live: boolean;
  now: number;
  t1: string;
  t2: string;
}) {
  if (!series || series.loading) return <Skeleton className="h-16 w-full" />;
  const [x0, domainEnd] = series.domain;
  const x1 = live ? Math.max(x0 + 60, Math.min(domainEnd, now)) : domainEnd;
  const W = 256;
  const H = 64;
  const half = yHalfRange([series.p1, series.p2]);
  const px = (t: number) => ((t - x0) / (x1 - x0)) * W;
  const py = (v: number) => H / 2 - (v / half) * (H / 2 - 3);
  const path = (s: PctPt[]) =>
    s
      .filter((p) => p.t >= x0 && p.t <= x1 && Number.isFinite(p.v))
      .map((p) => `${px(p.t).toFixed(1)},${py(p.v).toFixed(1)}`);
  const a = path(series.p1);
  const b = path(series.p2);
  const drawn = a.length > 1 || b.length > 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={drawn ? `${t1} and ${t2} moves since the start` : "No price path yet"}
    >
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--color-faint)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      {a.length > 1 ? (
        <polyline points={a.join(" ")} fill="none" stroke="var(--color-p1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : null}
      {b.length > 1 ? (
        <polyline points={b.join(" ")} fill="none" stroke="var(--color-p2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
