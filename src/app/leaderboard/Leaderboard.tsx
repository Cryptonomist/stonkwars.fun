"use client";

/* Who cooks, and who gets cooked. Worked out from settled fights on chain:
 * a record is wins and losses, and "taken" is the value of the loser's stake
 * at the end price, which is what the win was actually worth when it landed.
 *
 * RANKED BY MONEY, because that is the question the board answers. Sorted by
 * wins it put $5.49 at number two. Every row and podium card goes to the
 * fighter's profile, and a handle shows wherever the chain vouches for one.
 *
 * Colour follows the site's rules and nothing else: ranks are ink (a rank is
 * not a side), a loss is dim (red means a price went down), and only money
 * actually taken is green, so a $0.00 is dim too.
 *
 * Fighters who have not won yet are real, and they stay on the board, folded
 * into one row: eight lines of "0W 1L $0.00" said nothing a count cannot. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { ConnectX } from "@/components/ConnectX";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/Empty";
import { FighterName } from "@/components/ui/FighterName";
import { FormPips } from "@/components/ui/FormPips";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { StatStrip, type StatCell } from "@/components/ui/StatStrip";
import { Tabs, useUrlTab } from "@/components/ui/Tabs";
import { allDuels, STATUS_SETTLED, type DuelView } from "@/lib/duel";
import { highlightsByWallet, inWindow, records, winnerSide, type BestWin, type Highlights } from "@/lib/derive";
import { ago, pct, points, shortAddress, usd } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { rankFighters, type Record_ } from "@/lib/leaderboard";
import { isSparWallet } from "@/lib/spar";
import { STAKE_DECIMALS, tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

type RangeId = "all" | "7d" | "24h";

const RANGES: { id: RangeId; label: string; secs: number; words: string }[] = [
  { id: "all", label: "All", secs: 0, words: "yet" },
  { id: "7d", label: "7D", secs: 7 * 86_400, words: "in the last 7 days" },
  { id: "24h", label: "24h", secs: 86_400, words: "in the last 24 hours" },
];
const RANGE_IDS = RANGES.map((r) => r.id);

/** A dollar figure that is really money taken is green; anything that rounds
 *  to nothing is dim, so "$0.00" is never dressed as a win. */
const tookSomething = (n: number) => n >= 0.005;

/* The row grid. On a phone a row is two lines: rank, fighter and taken on the
 * first, so the money never leaves the screen, and form, record, win rate and
 * streak under it. From 640px the second line's cells join the one grid and
 * line up under the column heads. */
/* From 1024px the fighter column left about 650px blank on every row, so two
 * columns join it there: the wallet's biggest win and how long ago it last
 * fought. */
const ROW_GRID =
  "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5.5rem_3.5rem_6rem_6.5rem] lg:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5.5rem_3.5rem_6rem_minmax(0,18rem)_5.5rem_6.5rem]";

/** A win rate means something from three results; "100%" on a 1-0 record is noise. */
const MIN_FIGHTS_FOR_RATE = 3;

export function Leaderboard() {
  const duels = useDuels("all", allDuels(), 20_000);
  const profiles = useProfiles();
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58() ?? null;
  // A range is days wide; a clock that moves every half minute is plenty.
  const now = useNow(30_000);
  const [urlRange, setRange] = useUrlTab<RangeId>("range", RANGE_IDS, "all");
  const [showWinless, setShowWinless] = useState(false);

  const all = duels.data;

  /* A range tab only appears when something settled inside it, so the board
   * never offers a view that is empty by construction. The URL keeps its
   * choice while the list loads, and falls back to All only once it is known
   * that the range has nothing in it. */
  const available = useMemo(() => {
    if (!all || !now) return RANGES.filter((r) => r.id === "all");
    return RANGES.filter(
      (r) => r.id === "all" || inWindow(all, r.secs, now).some((d) => d.status === STATUS_SETTLED),
    );
  }, [all, now]);
  const loading = !all || (urlRange !== "all" && !now);
  const range = RANGES.find((r) => r.id === urlRange && available.some((a) => a.id === r.id)) ?? RANGES[0];

  const scoped = useMemo(
    () => (!all ? [] : range.id === "all" ? all : inWindow(all, range.secs, now)),
    [all, range, now],
  );
  /* The sparring wallet (lib/spar.ts) is the site's own opponent, so it is
   * kept off the ranks, with a line saying so. Its fights still count in the
   * totals above, because they really were fought and settled. */
  const allRanked = useMemo(() => rankFighters(scoped, STAKE_DECIMALS), [scoped]);
  const ranked = useMemo(() => allRanked.filter((r) => !isSparWallet(r.wallet)), [allRanked]);
  const sparHidden = ranked.length < allRanked.length;
  const highlights = useMemo(() => highlightsByWallet(scoped, STAKE_DECIMALS), [scoped]);
  const best = useMemo(() => records(scoped, isSparWallet), [scoped]);
  const byAddress = useMemo(() => new Map((all ?? []).map((d) => [d.address.toBase58(), d])), [all]);

  const settled = scoped.filter((d) => d.status === STATUS_SETTLED).length;
  const takenTotal = allRanked.reduce((s, r) => s + r.taken, 0);

  const winners = ranked.filter((r) => r.wins > 0);
  const winless = ranked.filter((r) => r.wins === 0);
  const podium = winners.slice(0, 3);
  const mineIndex = me ? ranked.findIndex((r) => r.wallet === me) : -1;

  const nameOf = (wallet: string) => {
    const h = profiles.data?.[wallet];
    return h ? `@${h}` : shortAddress(wallet);
  };

  /* On a phone the eyebrow, three stats, the range chips and the record cards
   * pushed rank 1 to 690px. There the stats are one meta line under the title,
   * and the record cards follow the ranked list instead of leading it. */
  const header = (
    <PageHeader
      eyebrow="Settled on chain"
      title="Leaderboard"
      compactBelow="sm"
      stats={[
        { label: "Settled fights", value: loading ? <Skeleton className="h-4 w-8" /> : settled.toLocaleString("en-US") },
        {
          label: "Wallets with a result",
          value: loading ? <Skeleton className="h-4 w-8" /> : allRanked.length.toLocaleString("en-US"),
        },
        { label: "Total taken", value: loading ? <Skeleton className="h-4 w-16" /> : usd(takenTotal) },
      ]}
    />
  );

  if (duels.isError && !all) {
    return (
      <div className="pb-6">
        {header}
        <Notice
          tone="error"
          title="Could not reach Solana."
          action={
            <button type="button" onClick={() => void duels.refetch()} className="btn btn-sm btn-ghost">
              Retry
            </button>
          }
        >
          The board fills in as soon as it answers.
        </Notice>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pb-6">
        {header}
        <SkeletonRows kind="fighter" rows={8} />
      </div>
    );
  }

  const recordCells: StatCell[] = [];
  if (best.closest) {
    const d = byAddress.get(best.closest.address);
    recordCells.push({
      label: "Closest finish",
      value: (
        <span className="num normal-case" title="percentage points">
          {points(best.closest.margin)} <span className="text-meta text-dim">pts</span>
        </span>
      ),
      sub: d ? beat(d) : "percentage points",
      href: `/f/${best.closest.address}`,
    });
  }
  if (best.biggestMove) {
    const d = byAddress.get(best.biggestMove.address);
    const m = best.biggestMove.move;
    recordCells.push({
      label: "Top winning move",
      value: <span className={cx("num normal-case", m > 0 ? "text-up" : m < 0 ? "text-down" : "text-ink")}>{pct(m)}</span>,
      sub: d ? beat(d) : best.biggestMove.ticker,
      href: `/f/${best.biggestMove.address}`,
    });
  }
  /* One win is not a streak, and "1 in a row" as a record reads as padding. */
  if (best.longestStreak && best.longestStreak.best >= 2) {
    recordCells.push({
      label: "Longest streak",
      value: `${best.longestStreak.best} in a row`,
      sub: <FighterName wallet={best.longestStreak.wallet} size="sm" href={null} />,
      href: `/u/${best.longestStreak.wallet}`,
    });
  }

  const recordStrip = recordCells.length ? <StatStrip cells={recordCells} cols={{ base: 2, sm: 3, lg: 3 }} label="Records" /> : null;

  return (
    <div className="pb-6">
      {header}
      <p className="-mt-3 mb-4 text-meta text-dim sm:hidden">
        <span className="num text-ink">{settled.toLocaleString("en-US")}</span> settled ·{" "}
        <span className="num text-ink">{allRanked.length.toLocaleString("en-US")}</span>{" "}
        {allRanked.length === 1 ? "wallet" : "wallets"} · <span className="num text-ink">{usd(takenTotal)}</span> taken
      </p>

      {available.length > 1 ? (
        <Tabs
          items={available.map((r) => ({ id: r.id, label: r.label }))}
          value={range.id}
          onChange={setRange}
          ariaLabel="Time range"
          controls="leaderboard-board"
          className="mb-6"
        />
      ) : null}

      <div id="leaderboard-board" className="flex flex-col gap-6">
        {ranked.length === 0 ? (
          <Empty
            title="Nobody has a result yet."
            body="The first win puts you at the top."
            action={{ href: "/new", label: "Pick a fight", tone: "p1" }}
          />
        ) : (
          <>
            {recordStrip ? <div className="hidden sm:block">{recordStrip}</div> : null}

            {me ? (
              mineIndex >= 0 ? (
                <section aria-label="Your rank">
                  <FighterRow
                    r={ranked[mineIndex]}
                    rank={mineIndex + 1}
                    you
                    name={nameOf(ranked[mineIndex].wallet)}
                    h={highlights.get(ranked[mineIndex].wallet)}
                    now={now}
                  />
                </section>
              ) : (
                <Link
                  href="/new"
                  className="card row flex min-h-10 items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="label mr-2">You</span>
                    <span className="text-dim">No settled fights {range.words}.</span>
                  </span>
                  <span className="label shrink-0">Pick a fight &rarr;</span>
                </Link>
              )
            ) : null}

            {podium.length ? (
              <ol className="hidden gap-2 sm:grid sm:grid-cols-3" aria-label="Top three">
                {podium.map((r, i) => (
                  <li key={r.wallet} className="min-w-0">
                    <PodiumCard r={r} rank={i + 1} you={r.wallet === me} name={nameOf(r.wallet)} h={highlights.get(r.wallet)} now={now} />
                  </li>
                ))}
              </ol>
            ) : null}

            <section aria-label="Fighters" className="min-w-0">
              {/* Column heads, only over rows a wide screen actually shows:
               * when the podium holds every winner they would head nothing. */}
              <div
                aria-hidden="true"
                className={cx(
                  ROW_GRID,
                  "label hidden px-3 pb-2",
                  (winners.length > podium.length || showWinless) && "sm:grid",
                )}
              >
                <span>#</span>
                <span>Fighter</span>
                <span>Form</span>
                <span>Record</span>
                <span className="text-right">Win</span>
                <span />
                <span className="hidden lg:block">Best win</span>
                <span className="hidden text-right lg:block">Last fight</span>
                <span className="text-right">Taken</span>
              </div>
              <ol className="flex flex-col border-b border-line">
                {winners.map((r, i) => (
                  <li
                    key={r.wallet}
                    /* On a phone the podium is simply the first three rows. */
                    className={cx("border-t border-line", i < podium.length && "sm:hidden")}
                  >
                    <FighterRow r={r} rank={i + 1} you={r.wallet === me} name={nameOf(r.wallet)} h={highlights.get(r.wallet)} now={now} />
                  </li>
                ))}
                {winless.length ? (
                  <li className="border-t border-line">
                    <button
                      type="button"
                      aria-expanded={showWinless}
                      aria-controls="leaderboard-winless"
                      onClick={() => setShowWinless((v) => !v)}
                      className="row flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-dim hover:text-ink"
                    >
                      <span>
                        +{winless.length} {winless.length === 1 ? "fighter" : "fighters"} with no wins {range.words}
                      </span>
                      <span aria-hidden="true" className="label">
                        {showWinless ? "Hide" : "Show"}
                      </span>
                    </button>
                  </li>
                ) : null}
              </ol>
              {winless.length && showWinless ? (
                <ol id="leaderboard-winless" className="flex flex-col border-b border-line" start={winners.length + 1}>
                  {winless.map((r, i) => (
                    <li key={r.wallet} className="border-t border-line first:border-t-0">
                      <FighterRow
                        r={r}
                        rank={winners.length + i + 1}
                        you={r.wallet === me}
                        name={nameOf(r.wallet)}
                        h={highlights.get(r.wallet)}
                        now={now}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>

            {sparHidden ? (
              <p className="text-meta text-dim">The sparring wallet is the site&apos;s own opponent, so it is left off the ranks. Its fights count in the totals.</p>
            ) : null}

            {recordStrip ? <div className="sm:hidden">{recordStrip}</div> : null}
          </>
        )}

        <ConnectX compact />
      </div>
    </div>
  );
}

/** "NVDA beat AAPL", from the on-chain outcome. */
function beat(d: DuelView): string {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  return winnerSide(d) === "p2" ? `${t2} beat ${t1}` : `${t1} beat ${t2}`;
}

function Rank({ n, size = "sm" }: { n: number; size?: "sm" | "md" }) {
  return (
    <span
      className={cx(
        "plate display inline-flex items-center justify-center bg-panel-3 text-ink",
        size === "md" ? "h-8 min-w-11 px-3 text-hud-sm" : "h-6 min-w-8 px-2 text-hud-xs",
      )}
    >
      {n}
    </span>
  );
}

function WinLoss({ r }: { r: Record_ }) {
  return (
    <span className="num whitespace-nowrap text-meta">
      <span className="text-ink">{r.wins}W</span> <span className="text-dim">{r.losses}L</span>
      {r.ties ? <span className="text-dim"> {r.ties}T</span> : null}
    </span>
  );
}

function Taken({ n, className }: { n: number; className?: string }) {
  return <span className={cx("num whitespace-nowrap", tookSomething(n) ? "text-up" : "text-dim", className)}>{usd(n)}</span>;
}

const rowLabel = (r: Record_, rank: number, name: string, you: boolean, h?: Highlights) =>
  `${you ? "You, " : ""}rank ${rank}, ${name}: ${r.wins} ${r.wins === 1 ? "win" : "wins"}, ${r.losses} ${
    r.losses === 1 ? "loss" : "losses"
  }${r.ties ? `, ${r.ties} ${r.ties === 1 ? "tie" : "ties"}` : ""}${
    r.fights >= MIN_FIGHTS_FOR_RATE ? `, win rate ${Math.round(r.winRate * 100)}%` : ""
  }, took ${usd(r.taken)}${h?.bestWin ? `, best win ${h.bestWin.ticker} beat ${h.bestWin.against}, took ${usd(h.bestWin.usd)}` : ""}`;

/** "NVDA beat AAPL by 0.024 pts", with what it took on the podium. The row's
 *  Last fight column carries the age, so the line does not repeat it. */
function BestWinLine({ b, took = false }: { b: BestWin; took?: boolean }) {
  return (
    <span className="min-w-0 truncate text-meta">
      <span className="text-ink">{b.ticker}</span> <span className="text-dim">beat</span>{" "}
      <span className="text-ink">{b.against}</span>
      <span className="num text-dim">{b.margin !== null ? ` by ${points(b.margin)} pts` : ""}</span>
      {took ? (
        <>
          {" "}
          · <span className="num text-up">took {usd(b.usd)}</span>
        </>
      ) : null}
    </span>
  );
}

function FighterRow({
  r,
  rank,
  you = false,
  name,
  h,
  now,
}: {
  r: Record_;
  rank: number;
  you?: boolean;
  name: string;
  h?: Highlights;
  now: number;
}) {
  return (
    <Link
      href={`/u/${r.wallet}`}
      aria-label={rowLabel(r, rank, name, you, h)}
      className={cx(ROW_GRID, "row px-3 py-2.5 focus-visible:-outline-offset-2", you && "shadow-[inset_2px_0_0_var(--color-ink)]")}
    >
      <span className="row-span-2 sm:row-span-1">
        <Rank n={rank} />
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <FighterName wallet={r.wallet} size="md" href={null} you={you} />
      </span>
      <Taken n={r.taken} className="text-right text-sm sm:order-last" />
      <span className="col-span-2 col-start-2 flex min-w-0 items-center gap-3 sm:contents">
        <FormPips results={r.form} />
        <WinLoss r={r} />
        <span className="num text-meta text-dim sm:text-right">
          {r.fights >= MIN_FIGHTS_FOR_RATE ? `${Math.round(r.winRate * 100)}%` : null}
        </span>
        <span className="min-w-0 sm:justify-self-start">
          {r.streak >= 2 ? <Badge variant="neutral">{r.streak} in a row</Badge> : null}
        </span>
        <span className="hidden min-w-0 lg:flex">{h?.bestWin ? <BestWinLine b={h.bestWin} /> : null}</span>
        <span className="num hidden text-right text-meta text-dim lg:block">
          {now && r.lastTs ? ago(r.lastTs, now) : null}
        </span>
      </span>
    </Link>
  );
}

function PodiumCard({
  r,
  rank,
  you,
  name,
  h,
  now,
}: {
  r: Record_;
  rank: number;
  you: boolean;
  name: string;
  h?: Highlights;
  now: number;
}) {
  return (
    <Link
      href={`/u/${r.wallet}`}
      aria-label={rowLabel(r, rank, name, you, h)}
      className="plate-card row flex h-full min-w-0 flex-col gap-3 p-4 focus-visible:-outline-offset-2"
    >
      <span className="flex min-w-0 items-center gap-3">
        <Rank n={rank} size="md" />
        <FighterName wallet={r.wallet} size="md" href={null} you={you} />
        {now && r.lastTs ? <span className="num ml-auto shrink-0 text-meta text-dim">{ago(r.lastTs, now)}</span> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="label">Taken</span>
        <Taken n={r.taken} className="mt-1 text-num-lg font-semibold" />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <WinLoss r={r} />
        <FormPips results={r.form} />
        {r.streak >= 2 ? <Badge variant="neutral">{r.streak} in a row</Badge> : null}
      </span>
      {/* What the money above was made of: the biggest single win, and the
        * stock this wallet reaches for, with how it has done in that corner. */}
      {h?.bestWin || h?.favourite ? (
        <span className="flex min-w-0 flex-col gap-1 border-t border-line pt-3">
          {h.bestWin ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="label w-20 shrink-0">Best win</span>
              <BestWinLine b={h.bestWin} took />
            </span>
          ) : null}
          {h.favourite ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="label w-20 shrink-0">Favorite</span>
              <span className="min-w-0 truncate text-meta">
                <span className="text-ink">{h.favourite.ticker}</span>{" "}
                <span className="num">
                  <span className="text-ink">{h.favourite.wins}W</span>{" "}
                  <span className="text-dim">{h.favourite.losses}L</span>
                  {h.favourite.ties ? <span className="text-dim"> {h.favourite.ties}T</span> : null}
                </span>
              </span>
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}
