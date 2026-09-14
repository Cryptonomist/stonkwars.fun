"use client";

/* A STOCK, AS A FIGHTER.
 *
 * fomo and pump.fun give every asset a page, and here every stock the roster
 * can price has one: what it costs now and where that number came from, the
 * last six hours, how it swings, how it has done in fights settled on chain,
 * and the challenges waiting on it. The next step is a fight, in either corner.
 *
 * WHERE EACH THING COMES FROM.
 *   price     /api/prices every 5s, with the market it was read from named
 *             beside it (Pyth, Exchange, Extended hours, Perp, Pool, Last close)
 *   hours     market.ts's session and stocks.ts's pricedAt: the same answer
 *             the fight pages and the price clock use for a boundary now
 *   chart     /api/bars (IntradayChart)
 *   stats     a month of daily closes from /api/stats, read by fighterStats
 *   record    the duel accounts every board reads, through derive.tickerRecord
 *
 * COLOUR. A stock has no side until it is in somebody's corner, so the ticker
 * is ink, not cyan or pink. The two buttons are the only side colours on the
 * page, because each one puts it in a corner. Green and red appear only on a
 * move: today's change, the month, Form, the chart's line.
 *
 * Nothing here decides anything. The stats and the chart are the stock's own
 * recent past; a fight is settled on the start and bell prices the program
 * records. */

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { Card } from "@/components/ClosingSoon";
import { FightRow } from "@/components/FightRow";
import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatStrip } from "@/components/ui/StatStrip";
import { Tip } from "@/components/ui/Tip";
import { allDuels, STATUS_ACCEPTED, STATUS_LIVE, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { isDeadHeat, isDecided, tickerRecord, winRate } from "@/lib/derive";
import { fighterFrom } from "@/lib/fighterStats";
import { etTime, pct, points, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { session, type Session } from "@/lib/market";
import { sourceWords } from "@/lib/pricemath";
import { dayChangePct, quoteValue, usePrices, type Quote } from "@/lib/prices";
import {
  byTicker,
  CLUSTER,
  firstPriceAt,
  openingWords,
  pricedAt,
  sourceLabel,
  STAKEABLE,
  tickerForMint,
  tokenSymbol,
  tradesAroundTheClock,
} from "@/lib/stocks";
import { useCloses } from "@/lib/useCloses";
import { useNow } from "@/lib/useNow";

import { IntradayChart } from "./IntradayChart";

/** Open challenges shown before the link to the rest. */
const OPEN_SHOWN = 6;
const RESULTS_SHOWN = 5;

const SESSION_WORDS: Record<Session, string> = {
  open: "Market open",
  pre: "Pre-market",
  after: "After hours",
  closed: "Exchange shut",
};

const PRICED_WORDS = { exchange: "Exchange", perp: "Perp", pool: "Pool", waits: "Waits for the open" } as const;

/* The same three explanations the tale of the tape gives, word for word, so a
 * stat means one thing wherever it is read. */
const STATS = [
  { key: "power" as const, label: "Power", hint: "Average daily move, either way. The bigger swinger has more room to win, and to lose." },
  { key: "form" as const, label: "Form", hint: "Where it has gone over the last five sessions." },
  { key: "room" as const, label: "Room", hint: "Where it sits in its own month: at the top of the range, or near the bottom." },
];

const hasTicker = (d: DuelView, ticker: string) =>
  tickerForMint(d.creatorMint) === ticker || tickerForMint(d.opponentMint) === ticker;

export function StockView({ ticker }: { ticker: string }) {
  const stock = byTicker(ticker)!;
  const now = useNow();
  const prices = usePrices([ticker], 5_000);
  const duels = useDuels("all", allDuels());
  const month = useCloses([ticker]);

  const stakeable = STAKEABLE.includes(stock);
  const closes = month.closes[ticker];
  const fighter = useMemo(() => (closes ? fighterFrom(closes) : null), [closes]);

  /* Lists are cut on a coarse clock, so a ticking second does not rebuild them. */
  const minute = Math.floor(now / 60) * 60;
  const mine = useMemo(() => (duels.data ?? []).filter((d) => hasTicker(d, ticker)), [duels.data, ticker]);
  const record = useMemo(() => tickerRecord(ticker, mine, minute), [ticker, mine, minute]);
  const open = useMemo(
    () =>
      mine
        .filter((d) => d.status === STATUS_OPEN && minute > 0 && d.expiresTs > minute)
        .sort((a, b) => a.expiresTs - b.expiresTs),
    [mine, minute],
  );
  const ring = useMemo(
    () => mine.filter((d) => d.status === STATUS_LIVE || d.status === STATUS_ACCEPTED),
    [mine],
  );
  const results = useMemo(
    () => mine.filter((d) => isDecided(d) || isDeadHeat(d)).sort((a, b) => b.endTs - a.endTs),
    [mine],
  );

  // Live prices for the rows that move with them: both sides of open and running fights.
  const rowTickers = [...open.slice(0, OPEN_SHOWN), ...ring].flatMap((d) => [
    tickerForMint(d.creatorMint),
    tickerForMint(d.opponentMint),
  ]);
  const rowPrices = usePrices(rowTickers, 10_000);

  const quote = prices.data?.quotes[ticker];
  const prev = quote?.prev ? Number(quote.prev) * 10 ** quote.expo : null;

  /* OPEN CHALLENGES, IN TWO PLACES. Below 1024px they follow the chart as full
   * rows. From 1024px they move into the rail under Fighter stats, as the
   * two-line cards the fight page's rail uses (a full row is unreadable at
   * that width), so the wide column leads with the chart, the ring and the
   * results, and the rail stops ending in 600px of nothing. With none open it
   * is one bar with the way to open one, not a 120px empty panel. */
  const openSection = (where: "main" | "rail") => {
    const headId = where === "main" ? "stock-open" : "stock-open-rail";
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headId}>
        <SectionHead
          id={headId}
          title="Open challenges"
          count={duels.data ? open.length : null}
          action={open.length > OPEN_SHOWN ? { href: `/fights?t=${ticker}&tab=open`, label: `All ${open.length}` } : undefined}
        />
        {duels.isError && !duels.data ? (
          <SolanaDown retry={() => void duels.refetch()} />
        ) : !duels.data || !now ? (
          <SkeletonRows kind="fight" rows={2} />
        ) : open.length ? (
          <div className="flex flex-col gap-2">
            {open.slice(0, OPEN_SHOWN).map((d) =>
              where === "main" ? (
                <FightRow key={d.address.toBase58()} d={d} now={now} quotes={rowPrices.data} />
              ) : (
                <Card key={d.address.toBase58()} d={d} now={now} quotes={rowPrices.data?.quotes} />
              ),
            )}
          </div>
        ) : (
          <div className="card flex min-h-10 min-w-0 items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-dim">No open {ticker} challenges</span>
            {stakeable ? (
              <Link href={`/new?p1=${ticker}`} className="btn btn-sm btn-p1 shrink-0">
                Fight with it
              </Link>
            ) : null}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <Header
        ticker={ticker}
        now={now}
        stakeable={stakeable}
        quote={quote}
        pricesFailed={!quote && (prices.isError || !!prices.data?.error)}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <IntradayChart ticker={ticker} prevClose={prev} charted={stock.market === "US"} />

          <div className="min-w-0 lg:hidden">{openSection("main")}</div>

          {ring.length ? (
            <section className="flex min-w-0 flex-col gap-3" aria-labelledby="stock-ring">
              <SectionHead id="stock-ring" title="In the ring" count={ring.length} />
              <div className="flex flex-col gap-2">
                {ring.map((d) => (
                  <FightRow key={d.address.toBase58()} d={d} now={now} quotes={rowPrices.data} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="stock-results">
            <SectionHead id="stock-results" title="Recent results" count={duels.data ? results.length : null} />
            {duels.isError && !duels.data ? null : !duels.data || !now ? (
              <SkeletonRows kind="fight" rows={2} />
            ) : results.length ? (
              <div className="flex flex-col gap-2">
                {results.slice(0, RESULTS_SHOWN).map((d) => (
                  <FightRow key={d.address.toBase58()} d={d} now={now} />
                ))}
              </div>
            ) : (
              <p className="card px-3 py-2.5 text-sm text-dim">No results on chain for {ticker} yet.</p>
            )}
            {/* Under the list rather than in the head, where on a phone its
              * length cut the section's own title down to "Recent res...". */}
            <Link href={`/fights?t=${ticker}&tab=final`} className="btn btn-sm btn-ghost self-start">
              All fights with {ticker}
            </Link>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label={`About ${ticker}`}>
          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="stock-record">
            <SectionHead id="stock-record" title="Record on chain" />
            {duels.isError && !duels.data ? (
              <SolanaDown retry={() => void duels.refetch()} />
            ) : !duels.data ? (
              <Skeleton className="h-36 sm:h-18 lg:h-36" />
            ) : record.fights === 0 ? (
              /* A grid of 0, 0, 0 and "--" said nothing four times. */
              <div className="card flex min-h-10 min-w-0 items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-sm text-dim">No settled {ticker} fights yet</span>
                {stakeable ? (
                  <Link href={`/new?p1=${ticker}`} className="btn btn-sm btn-p1 shrink-0">
                    Fight with it
                  </Link>
                ) : null}
              </div>
            ) : (
              <StatStrip
                label={`${ticker} record`}
                cols={{ base: 2, sm: 4, lg: 2 }}
                cells={[
                  {
                    label: "Fights",
                    value: <span className="num">{record.fights}</span>,
                    sub: record.ties ? `${record.ties} dead ${record.ties === 1 ? "heat" : "heats"}` : "with a result",
                  },
                  { label: "Wins", value: <span className="num">{record.wins}</span> },
                  {
                    label: "Losses",
                    // Ink, not red: a loss in a record is not a price move.
                    value: <span className={cx("num", record.losses ? "text-ink" : "text-dim")}>{record.losses}</span>,
                  },
                  {
                    label: "Win rate",
                    value: (
                      <span className={cx("num", record.fights ? "text-ink" : "text-dim")}>
                        {record.fights ? `${Math.round(winRate(record) * 100)}%` : "--"}
                      </span>
                    ),
                  },
                ]}
              />
            )}
            <p className="text-meta text-dim">
              Settled fights with {ticker} in either corner. A win means its side moved more by the bell.
            </p>
          </section>

          <Plate as="section" pad="std" className="flex flex-col gap-4" aria-labelledby="stock-stats">
            <SectionHead id="stock-stats" title="Fighter stats" count="Last month of closes" />

            <div className="flex min-w-0 items-center gap-4">
              {month.isLoading && !closes ? (
                <Skeleton className="h-10 w-40 shrink-0" />
              ) : (
                <Sparkline
                  values={closes ?? []}
                  width={160}
                  height={40}
                  tone="move"
                  label={monthLabel(ticker, closes)}
                />
              )}
              <div className="min-w-0">
                <p className="label">Month</p>
                <Move value={monthMove(closes)} className="num text-sm" />
              </div>
            </div>

            {month.isLoading && !closes ? (
              <SkeletonRows kind="quote" rows={3} />
            ) : fighter ? (
              <dl className="flex flex-col">
                {STATS.map((s) => (
                  <div key={s.key} className="flex min-h-9 min-w-0 items-center gap-3 border-t border-line py-1.5">
                    <dt className="label shrink-0">
                      <Tip label={s.hint} className="uppercase">
                        {s.label}
                      </Tip>
                    </dt>
                    <dd className="ml-auto flex min-w-0 flex-col items-end">
                      <StatValue stat={s.key} f={fighter} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-dim">
                {month.isError && !closes
                  ? "The month of closes is unavailable right now."
                  : "Not enough closes this month to read."}
              </p>
            )}
            <p className="text-meta text-dim">The stock&apos;s own recent past. Decides nothing.</p>
          </Plate>

          <div className="hidden min-w-0 lg:block">{openSection("rail")}</div>
        </aside>
      </div>
    </div>
  );
}

/* ─── The header ──────────────────────────────────────────────────────────── */

function Header({
  ticker,
  now,
  stakeable,
  quote,
  pricesFailed,
}: {
  ticker: string;
  now: number;
  stakeable: boolean;
  quote: Quote | undefined;
  pricesFailed: boolean;
}) {
  const stock = byTicker(ticker)!;
  const price = quoteValue(quote);
  const change = dayChangePct(quote);
  const us = stock.market === "US";
  const priced = now ? pricedAt(ticker, now) : null;
  const next = priced === "waits" && now ? firstPriceAt(ticker, now) : null;
  const onMainnet = CLUSTER === "mainnet-beta";

  return (
    <Plate as="header" notch pad="std" className="flex flex-col gap-4 sm:p-5">
      <p className="label truncate">
        {[stock.kind === "etf" ? "ETF" : "Stock", `${stock.market} listing`, ...stock.issuers].join(" · ")}
      </p>

      {/* The ticker and its price side by side at every width: on a phone the
        * price stacked under the name cost the first screen both buttons. The
        * price column is narrow on purpose (source on the label line, the move
        * under the price), and wraps under the name only for a long ticker. */}
      <div className="-mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-hud-lg text-ink">{ticker}</h1>
          <p className="mt-1 truncate text-sm text-dim">{stock.name}</p>
        </div>

        <div className="flex min-w-0 flex-col items-end gap-1 text-right">
          <p className="flex items-center gap-2">
            <span className="label">Live price</span>
            {quote?.source ? <Badge variant="source">{sourceWords(quote.source)}</Badge> : null}
          </p>
          {price !== null ? (
            <FlashNum value={price} className="num text-num-lg font-semibold text-ink">
              {usd(price)}
            </FlashNum>
          ) : pricesFailed ? (
            <p className="text-sm text-dim">Prices are unavailable right now.</p>
          ) : (
            <Skeleton className="h-6 w-28" />
          )}
          {/* Only when the source gave a previous close to measure the day from. */}
          {change !== null ? (
            <p className="flex flex-wrap items-baseline justify-end gap-x-2">
              <FlashNum value={change}>
                <Move value={change} className="num text-sm" />
              </FlashNum>
              <span className="text-meta text-dim">today</span>
            </p>
          ) : null}
          {quote?.publishTime ? <p className="text-meta text-dim">as of {etTime(quote.publishTime)}</p> : null}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-3">
        <Fact label="Hours">
          {now ? <Badge>{us ? SESSION_WORDS[session(now * 1_000)] : `${stock.market} exchange hours`}</Badge> : <Skeleton className="h-4.5 w-20" />}
          {tradesAroundTheClock(ticker) ? <Badge>24/7</Badge> : null}
        </Fact>
        <Fact label="Priced by" hint="Where a start or bell price set right now would come from.">
          {priced ? <Badge variant="source">{PRICED_WORDS[priced]}</Badge> : <Skeleton className="h-4.5 w-16" />}
          {next ? <span className="text-meta text-dim">until {openingWords(next)}</span> : null}
        </Fact>
        <Fact
          label="Checked by"
          hint={
            stock.source === "pyth"
              ? "Pyth price updates, checked on chain by the program."
              : "Quotes the Stonk Wars oracle signs from the market named beside Priced by, with the signature checked on chain by the program."
          }
        >
          <Badge variant="source">{sourceLabel(stock)}</Badge>
        </Fact>
        {stakeable ? (
          <Fact label="Staked as">
            <span className="num text-meta text-ink normal-case">{tokenSymbol(ticker)}</span>
            {!onMainnet ? <span className="text-meta text-dim">test token</span> : null}
          </Fact>
        ) : null}
      </dl>

      {stakeable ? (
        /* Two halves of a phone's width each, one line apiece: the labels step
         * down a size below 640px rather than wrap. */
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Link href={`/new?p1=${ticker}`} className="btn btn-p1 min-h-11 px-3 text-sm whitespace-nowrap sm:px-6 sm:text-base">
            Fight with it
          </Link>
          <Link href={`/new?p2=${ticker}`} className="btn btn-p2 min-h-11 px-3 text-sm whitespace-nowrap sm:px-6 sm:text-base">
            Fight against it
          </Link>
        </div>
      ) : (
        <Notice title={`Not stakeable on ${onMainnet ? "mainnet" : CLUSTER} yet.`}>
          {ticker} is on the roster and priced here, but it has no token to stake on this cluster.
        </Notice>
      )}
    </Plate>
  );
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* A button does not inherit uppercase (preflight resets it), so the tip says it again. */}
      <dt className="label">
        {hint ? (
          <Tip label={hint} className="uppercase">
            {label}
          </Tip>
        ) : (
          label
        )}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

/* ─── Fighter stats ───────────────────────────────────────────────────────── */

function StatValue({ stat, f }: { stat: "power" | "form" | "room"; f: NonNullable<ReturnType<typeof fighterFrom>> }) {
  if (stat === "power") return <span className="num text-sm text-ink">{points(f.power)}%/day</span>;
  if (stat === "room") return <span className="num text-sm text-ink">{Math.round(f.room)} of 100</span>;
  return (
    <>
      <Move value={f.form} className="num text-sm" />
      {Math.abs(f.streak) >= 2 ? (
        <span className="micro text-dim">
          {Math.abs(f.streak)} {f.streak > 0 ? "up" : "down"} in a row
        </span>
      ) : null}
    </>
  );
}

function monthMove(closes: number[] | undefined): number | null {
  if (!closes || closes.length < 2 || !(closes[0] > 0)) return null;
  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

function monthLabel(ticker: string, closes: number[] | undefined): string {
  const move = monthMove(closes);
  return move === null ? `${ticker}: no month of closes` : `${ticker} daily closes over the last month: ${pct(move)}`;
}

function SolanaDown({ retry }: { retry: () => void }) {
  return (
    <Notice
      tone="error"
      title="Could not reach Solana."
      action={
        <button type="button" onClick={retry} className="btn btn-sm btn-ghost">
          Retry
        </button>
      }
    >
      The record and challenges fill in as soon as it answers.
    </Notice>
  );
}
