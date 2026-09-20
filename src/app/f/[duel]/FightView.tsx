"use client";

/* One fight, in every state it can be in.
 *
 *   OPEN      a challenge: take it, or (creator) share it or call it off
 *   ACCEPTED  both stakes in; the start prices are being posted
 *   LIVE      the round: live moves, health bars, the clock to the bell
 *   SETTLED   the winner took both stakes; the loser is COOKED
 *   VOID      could not be run fairly; anyone can send both stakes home
 *   REFUNDED  a dead heat, or a void that has been refunded
 *
 * Nothing here decides anything. The live moves are for watching; the result
 * is whatever the program computed from the prices it accepted (Pyth's, or the
 * oracle's signed quotes, per side), and the receipt shows exactly which
 * prices those were, who posted them, and the transactions that did it.
 *
 * THE PAGE, top to bottom: a status strip; the arena (two corners and the
 * centre between them); then, from 1024px, a wide column (the race chart and
 * the receipt) beside a narrow one (what to do next, the tale of the tape for
 * an open challenge, and sharing). On a phone the same pieces stack in the
 * order a thumb wants them: arena, actions, chart, share, receipt.
 *
 * TIME COMES FROM THE CLOCKS THAT DECIDE IT. For an accepted fight, and a live
 * one past its bell, the status line is roundClock(...).line and every
 * countdown is its secondsLeft; while a side's market is shut, "Prices from"
 * is the second that same clock will count to once it opens (fightClock.ts).
 * useDuel keeps nudging the settler while this page is open. */

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { Combo, Knockout, useFightFeel, useKnockout } from "@/components/FightFx";
import { waitingForMarket } from "@/components/FightRow";
import { HealthBars } from "@/components/HealthBars";
import { TaleOfTheTape } from "@/components/TaleOfTheTape";
import { Countdown } from "@/components/ui/Countdown";
import { Empty } from "@/components/ui/Empty";
import { FighterName } from "@/components/ui/FighterName";
import { LiveDot } from "@/components/ui/LiveDot";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { Skeleton } from "@/components/ui/Skeleton";
import { Versus } from "@/components/ui/Versus";
import { cx } from "@/components/ui/cx";
import { watchFight } from "@/components/ui/intents";
import {
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { leadWords, pricesFrom, roundWords, tabTitle } from "@/lib/fightClock";
import { loserTake, winnerSide } from "@/lib/derive";
import { ago, etTime, etWhen, hm, points, span, usd } from "@/lib/format";
import { useDuel } from "@/lib/hooks";
import { movePct, stakeValue, usePrices, type Quotes } from "@/lib/prices";
import { neverSides, roundClock, shutSides, type RoundClock } from "@/lib/roundClock";
import { play } from "@/lib/sfx";
import { decimalsForMint, queueAt, tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";
import { useNudgeStatus } from "@/lib/useSettlerNudge";
import { useSparNudge } from "@/lib/useSparNudge";

import { Actions } from "./Actions";
import { Corner } from "./Corner";
import { RaceChart } from "./RaceChart";
import { MoreFights } from "./MoreFights";
import { Receipt } from "./Receipt";
import { Scoreboard } from "./Scoreboard";
import { ShareFight } from "./ShareFight";
import { SoundToggle } from "./SoundToggle";

export function FightView({ address }: { address: string }) {
  const key = useMemo(() => {
    try {
      return new PublicKey(address);
    } catch {
      return null;
    }
  }, [address]);

  const duel = useDuel(key);
  const d = duel.data;
  const prices = usePrices(d ? [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)] : []);
  const now = useNow();
  const params = useSearchParams();

  /* A fight somebody opened is one they want to hear about, so the watcher
   * toasts its changes on other pages (FightWatcher, intents.ts). */
  useEffect(() => {
    if (key) watchFight(key.toBase58());
  }, [key]);

  if (!key) {
    return (
      <div className="py-6">
        <Empty
          title="That is not a fight address."
          body="A fight link ends in the fight's Solana address."
          action={[
            { href: "/fights", label: "See the fights" },
            { href: "/new", label: "Pick a fight" },
          ]}
        />
      </div>
    );
  }

  if (d === undefined) {
    /* An RPC that cannot be reached is not a fight that does not exist. The
     * page used to say "No fight here" for both, which told somebody with a
     * live fight that it was gone. */
    if (duel.error) {
      return (
        <div className="py-6">
          <Notice
            tone="error"
            title="Could not reach Solana. Retrying every few seconds."
            action={
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duel.refetch()}>
                Retry
              </button>
            }
          >
            The fight is safe on chain whatever this page can see. It loads as soon as the network answers.
          </Notice>
        </div>
      );
    }
    return <ArenaSkeleton />;
  }

  if (d === null) {
    return (
      <div className="py-6">
        <Empty
          title="No fight at this address."
          body="Canceled fights close their accounts, so their links stop working."
          action={{ href: "/new", label: "Pick a fight", tone: "p1" }}
        />
      </div>
    );
  }

  return <Arena d={d} now={now} quotes={prices.data} fresh={params.get("new") === "1"} />;
}

function Arena({ d, now, quotes, fresh }: { d: DuelView; now: number; quotes?: Quotes; fresh: boolean }) {
  const address = d.address.toBase58();
  const nudge = useNudgeStatus(address);
  // A challenge addressed to the sparring wallet asks to be taken while it is on screen.
  useSparNudge(d, now);

  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const q1 = quotes?.quotes[t1];
  const q2 = quotes?.quotes[t2];

  const clock = roundClock(d, now, nudge);
  const shut = shutSides(d, now);
  const never = neverSides(d, now) !== null;
  const beforeBell = d.status === STATUS_LIVE && (!now || now < d.endTs);

  const finished = d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.creatorEnd.price > BigInt(0));
  /* Live moves only inside the round: after the bell a live price is not the
   * bell price, and the bars and the tab should not keep fighting over it. */
  const m1 = finished ? movePct(d.creatorStart, d.creatorEnd) : beforeBell && q1 && d.startTs ? movePct(d.creatorStart, q1) : null;
  const m2 = finished ? movePct(d.opponentStart, d.opponentEnd) : beforeBell && q2 && d.startTs ? movePct(d.opponentStart, q2) : null;

  /* The round as a fight: every price that lands is a punch thrown. */
  const { hits, combo, landing, heavy } = useFightFeel(m1, m2, beforeBell);
  const ko = useKnockout(d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED);
  const lead = beforeBell && m1 !== null && m2 !== null ? (m1 > m2 ? "p1" : m2 > m1 ? "p2" : null) : null;
  /* The bars show in a live round and on a result (the same states Center
   * draws them in); at a K.O. the loser's bar is the empty one. */
  const bars: { ko: "p1" | "p2" | null } | null = beforeBell
    ? { ko: null }
    : d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE)
      ? { ko: d.outcome === OUTCOME_OPPONENT ? "p1" : d.outcome === OUTCOME_CREATOR ? "p2" : null }
      : null;

  const secondsLeft = clock.secondsLeft;
  /* Late is roundClock's own verdict (the manual buttons are showing), so the
   * corners and the tab say the same thing as the status line above them. */
  const late = clock.manual !== null;
  const title = tabTitle({ d, t1, t2, m1, m2, now, secondsLeft });
  useTabTitle(late ? `${t1} vs ${t2} · Late` : title);
  useFightSounds({ status: d.status, m1, m2, beforeBell, secondsLeft, ko });

  const stakeUsd = stakeValue(d.creatorAmount, decimalsForMint(d.creatorMint), q1);
  const open = d.status === STATUS_OPEN;

  /* A spectator watching a round on a phone wants the race before the rules:
   * the chart moves up to follow the arena, and the actions (which for them
   * are "pick this fight yourself") come after it. A fighter keeps their
   * actions first. */
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const spectating = beforeBell && me !== d.creator.toBase58() && me !== d.opponent.toBase58();

  return (
    <div className="py-6">
      {beforeBell && now ? (
        <Scoreboard t1={t1} t2={t2} m1={m1} m2={m2} endTs={d.endTs} now={now} roundSecs={Math.max(60, d.endTs - d.startTs)} />
      ) : null}
      <StatusStrip d={d} now={now} clock={clock} beforeBell={beforeBell} t1={t1} t2={t2} />

      <Plate
        as="section"
        notch
        rope
        pad="arena"
        aria-label={`${t1} vs ${t2}`}
        className={cx("relative mt-2 overflow-hidden", heavy && "shake")}
      >
        <Knockout show={ko} tie={d.outcome === OUTCOME_TIE} />
        <Versus
          pairBelow="md"
          /* Corners line up along their tops, whatever each holds; the centre stays centred. */
          className="gap-4 md:gap-6 [&>*:nth-child(odd)]:self-start"
          left={
            <Corner
              d={d}
              side="p1"
              ticker={t1}
              quote={q1}
              shut={shut.includes(t1)}
              never={never}
              leading={lead === "p1"}
              hits={hits}
              hurt={landing?.side === "p2"}
              late={late}
              other={m2}
            />
          }
          center={<Center d={d} now={now} t1={t1} t2={t2} m1={m1} m2={m2} combo={combo} clock={clock} beforeBell={beforeBell} />}
          right={
            <Corner
              d={d}
              side="p2"
              ticker={t2}
              quote={q2}
              shut={shut.includes(t2)}
              never={never}
              leading={lead === "p2"}
              hits={hits}
              hurt={landing?.side === "p1"}
              late={late}
              other={m1}
            />
          }
        />

        {/* THE HUD ACROSS THE ARENA, from 768px. Inside the centre column the
          * bars were two 119px strips, smaller than the home page's teaser of
          * this very fight, so a real round did not read as a fight. Here they
          * run the arena's width, cyan from the left and pink from the right,
          * under the corners they belong to. On a phone the centre row already
          * spans the width, and the bars stay in it. */}
        {bars ? (
          <div className="mt-6 hidden md:block">
            <HealthBars p1Move={m1} p2Move={m2} roundSecs={Math.max(60, d.endTs - d.startTs)} ko={bars.ko} size="lg" />
          </div>
        ) : null}

        {d.taunt ? (
          <figure className="mt-4 border-t border-line pt-3 text-center md:mt-6 md:pt-4">
            <blockquote className="text-base text-ink italic sm:text-lg md:text-xl">&ldquo;{d.taunt}&rdquo;</blockquote>
            <figcaption className="mt-2 inline-flex items-center gap-1.5 text-meta text-dim">
              <FighterName wallet={d.creator.toBase58()} size="sm" /> on chain
            </figcaption>
          </figure>
        ) : null}
      </Plate>

      {/* Below 1024px both columns dissolve (display: contents) into one grid,
        * and `order` puts the pieces in the phone's order. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <RaceChart
            d={d}
            t1={t1}
            t2={t2}
            quotes={quotes}
            now={now}
            className={cx(spectating ? "order-1" : "order-3", "lg:order-none")}
          />
          {/* An open challenge has no race to draw yet, so the tale of the tape
            * takes the chart's place in the wide column, where its bars have
            * room, instead of stacking a tall card under the actions. */}
          {open ? (
            <div className="order-2 min-w-0 lg:order-none [&>section]:mt-0">
              <TaleOfTheTape p1={t1 === "?" ? null : t1} p2={t2 === "?" ? null : t2} />
            </div>
          ) : null}
          <Receipt d={d} t1={t1} t2={t2} now={now} className="order-5 lg:order-none" />
        </div>
        <aside className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6" aria-label="Next steps">
          <Actions
            d={d}
            now={now}
            t1={t1}
            t2={t2}
            stakeUsd={stakeUsd}
            className={cx(spectating ? "order-3" : "order-1", "lg:sticky lg:top-20 lg:z-10 lg:order-none")}
          />
          <ShareFight d={d} t1={t1} t2={t2} m1={m1} m2={m2} fresh={fresh} className="order-4 lg:order-none" />
          <MoreFights address={address} now={now} className={cx(finished ? "order-2" : "order-6", "lg:order-none")} />
        </aside>
      </div>
    </div>
  );
}

/* A QUEUED CHALLENGE: the moment it can first be taken fairly, when a take
 * now would not be (stocks.ts, queueAt). Null when it can be taken now, or
 * never before it expires, or with no clock yet. */
function queuedFrom(d: DuelView, now: number, t1: string, t2: string): number | null {
  if (!now || d.status !== STATUS_OPEN || d.expiresTs <= now) return null;
  const q = queueAt(t1, t2, now, d, "taker");
  return q && "queued" in q ? q.queued : null;
}

/* ── The status strip ─────────────────────────────────────────────────── */

function StatusStrip({
  d,
  now,
  clock,
  beforeBell,
  t1,
  t2,
}: {
  d: DuelView;
  now: number;
  clock: RoundClock;
  beforeBell: boolean;
  t1: string;
  t2: string;
}) {
  let text: React.ReactNode = "";
  let tone = "text-ink";
  switch (d.status) {
    case STATUS_OPEN: {
      if (now && d.expiresTs <= now) {
        text = "Challenge expired";
        tone = "text-dim";
        break;
      }
      const from = queuedFrom(d, now, t1, t2);
      text = from !== null ? `Open challenge · queued · takeable in ${hm(from - now)}` : "Open challenge";
      break;
    }
    case STATUS_ACCEPTED:
      text = clock.line;
      break;
    case STATUS_LIVE:
      text = beforeBell ? "" : clock.line;
      break;
    case STATUS_SETTLED: {
      /* THE RESULT IN ONE LINE, ABOVE THE ARENA. On a phone the winner's
       * corner and its Took plate are below the first screen, so somebody
       * opening a result landed on the loser's COOKED stamp with no sentence
       * saying who won. Only the tickers take their side's colour, and only
       * the money taken is green. */
      const won = winnerSide(d);
      const take = loserTake(d);
      if (!won) {
        text = now ? `Final · ${ago(d.endTs, now)}` : "Final";
        break;
      }
      const [w, l] = won === "p1" ? [t1, t2] : [t2, t1];
      const tick = (t: string, s: "p1" | "p2") => <span className={cx("normal-case", s === "p1" ? "text-p1" : "text-p2")}>{t}</span>;
      const result = (
        <>
          {tick(w, won)} cooked {tick(l, won === "p1" ? "p2" : "p1")}
        </>
      );
      text = (
        <>
          <span className="hidden sm:inline">
            Final{now ? ` · ${ago(d.endTs, now)}` : ""} · {result}
          </span>
          <span className="sm:hidden">
            {result}
            {take ? (
              <>
                {" "}
                · <span className="num text-up">took {usd(take.usd)}</span>
              </>
            ) : null}
          </span>
        </>
      );
      break;
    }
    case STATUS_VOID:
      text = "Void · both stakes go home";
      tone = "text-dim";
      break;
    case STATUS_REFUNDED:
      text = d.outcome === OUTCOME_TIE ? "Dead heat · both stakes home" : "Refunded · both stakes home";
      tone = "text-dim";
      break;
  }
  return (
    <div className="flex min-h-10 items-center gap-x-3">
      {beforeBell ? (
        <span className="inline-flex shrink-0 items-center gap-2">
          <LiveDot />
          <span className="label text-ink">Live</span>
        </span>
      ) : null}
      {text ? (
        <p className={cx("label min-w-0", tone)} aria-live="polite">
          {text}
        </p>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SoundToggle />
        <Link href="/fights" className="label inline-flex h-10 items-center px-2 transition-colors hover:text-ink sm:h-8">
          <span className="sm:hidden">All</span>
          <span className="hidden sm:inline">All fights</span>
          <span aria-hidden="true">&nbsp;&rarr;</span>
        </Link>
      </div>
    </div>
  );
}

/* ── The centre column ────────────────────────────────────────────────── */

function Center({
  d,
  now,
  t1,
  t2,
  m1,
  m2,
  combo,
  clock,
  beforeBell,
}: {
  d: DuelView;
  now: number;
  t1: string;
  t2: string;
  m1: number | null;
  m2: number | null;
  combo: { side: "p1" | "p2"; count: number; damage: number } | null;
  clock: RoundClock;
  beforeBell: boolean;
}) {
  const vs = <span className="display text-hud-sm text-ink md:text-hud-lg">VS</span>;
  const roundSecs = Math.max(60, d.endTs - d.startTs);
  /* Between the corners from 768px it is a column. On a phone the corners
   * share a row and the centre is a row under both, across the width: a tall
   * column there pushed the answering corner a whole screen down. */
  const wrap = (children: React.ReactNode) => (
    <div
      data-arena-center
      className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line pt-3 md:w-52 md:flex-col md:gap-2 md:border-0 md:py-2 lg:w-72"
    >
      {children}
    </div>
  );

  if (d.status === STATUS_OPEN) {
    const expired = now > 0 && d.expiresTs <= now;
    const from = expired ? null : queuedFrom(d, now, t1, t2);
    return wrap(
      <>
        {vs}
        <span className="text-sm text-dim">{roundWords(d)}</span>
        {expired ? (
          <span className="label">Expired {etTime(d.expiresTs)}</span>
        ) : from !== null ? (
          <span className="flex flex-col items-center gap-1">
            <span className="label">Takeable in</span>
            <Countdown to={from} now={now} className="text-num-lg text-ink" />
            <span className="text-meta text-dim">{etTime(from)}</span>
          </span>
        ) : (
          <span className="flex flex-col items-center gap-1">
            <span className="label">Closes in</span>
            <Countdown to={d.expiresTs} now={now} className="text-num-lg text-ink" />
          </span>
        )}
      </>,
    );
  }

  if (d.status === STATUS_ACCEPTED || (d.status === STATUS_LIVE && !beforeBell)) {
    const starting = d.status === STATUS_ACCEPTED;
    const waits = waitingForMarket(d, now) ? pricesFrom(d, now) : null;
    return wrap(
      <>
        {vs}
        {waits ? (
          <span className="flex flex-col items-center gap-1">
            <span className="label">{starting ? "Prices from" : "Bell prices from"}</span>
            <Countdown to={waits.at} now={now} className="text-num-lg text-ink" />
            <span className="text-meta text-dim">{etTime(waits.at)}</span>
          </span>
        ) : clock.secondsLeft !== null ? (
          <span className="flex flex-col items-center gap-1">
            <span className="label">{starting ? "Round starts in" : "Result in"}</span>
            <Countdown to={now + clock.secondsLeft} now={now} className="text-num-lg text-ink" />
          </span>
        ) : null}
        <span className="text-meta text-dim">{starting ? roundWords(d) : `Bell rang ${etTime(d.endTs)}`}</span>
      </>,
    );
  }

  if (beforeBell) {
    const lead = leadWords(t1, t2, m1, m2);
    return wrap(
      <>
        {/* The phone's bars; from 768px they run across the arena instead. */}
        <div className="w-full md:hidden">
          <HealthBars p1Move={m1} p2Move={m2} roundSecs={roundSecs} />
        </div>
        {clock.secondsLeft !== null ? (
          <Countdown to={now + clock.secondsLeft} now={now} size="clock" className="text-ink" />
        ) : (
          <Countdown to={d.endTs} size="clock" className="text-ink" />
        )}
        <span className="label">to the bell · {etTime(d.endTs)}</span>
        <Combo combo={combo} />
        {lead ? <span className="text-center text-sm text-ink">{lead}</span> : null}
      </>,
    );
  }

  if (d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE)) {
    const tie = d.outcome === OUTCOME_TIE;
    const loser = d.outcome === OUTCOME_OPPONENT ? "p1" : d.outcome === OUTCOME_CREATOR ? "p2" : null;
    return wrap(
      <>
        <div className="w-full md:hidden">
          <HealthBars p1Move={m1} p2Move={m2} roundSecs={roundSecs} ko={tie ? null : loser} />
        </div>
        <span className="text-center text-sm font-semibold text-ink">
          {tie
            ? "Dead heat. Both stakes go home."
            : m1 !== null && m2 !== null && loser
              ? `${loser === "p1" ? t2 : t1} won by ${points(Math.abs(m1 - m2))} percentage points`
              : "Final"}
        </span>
        {d.startTs ? (
          <span className="text-center text-meta text-dim">
            {etWhen(d.startTs, d.endTs)}
            <span className="md:hidden"> · </span>
            <span className="md:block">{span(d.endTs - d.startTs)} round</span>
          </span>
        ) : null}
      </>,
    );
  }

  return wrap(
    <>
      {vs}
      <span className="text-center text-sm text-dim">
        {d.status === STATUS_VOID ? "Void. Both stakes go home." : "Refunded. Both stakes went home."}
      </span>
    </>,
  );
}

/* ── Loading ──────────────────────────────────────────────────────────── */

/** The arena's shape while the fight loads: never a number that is not there yet. */
export function ArenaSkeleton() {
  const corner = (right: boolean) => (
    <div className={cx("flex min-w-0 flex-col gap-3 p-1 md:p-3", right && "items-end")}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-9 w-28 max-w-full sm:h-14 md:w-40 lg:h-20" />
      <Skeleton className="h-3 w-32 max-w-full" />
      <Skeleton className="mt-2 h-4 w-44 max-w-full" />
      <Skeleton className="h-4 w-36 max-w-full" />
      <Skeleton className="mt-1 h-6 w-24" />
    </div>
  );
  return (
    <div className="py-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the fight
      </span>
      <div className="flex min-h-10 items-center">
        <Skeleton className="h-3 w-40" />
      </div>
      <Plate notch rope pad="arena" className="mt-2">
        <div className="grid grid-cols-2 items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-6">
          {corner(false)}
          <div className="order-last col-span-2 flex flex-col items-center gap-3 md:order-none md:col-span-1 md:w-52 lg:w-72">
            <Skeleton className="h-12 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
          {corner(true)}
        </div>
      </Plate>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Skeleton className="h-72" />
        <Skeleton className="hidden h-48 lg:block" />
      </div>
    </div>
  );
}

/* ── The tab, and the sound ───────────────────────────────────────────── */

/* The tab says the fight's state, and gives the title back when the page goes,
 * unless something else has changed it since (the next page's own title).
 *
 * Next renders the page's metadata <title> after the page itself, and puts it
 * back when that part of the tree renders again, which would quietly replace
 * the live score with "NVDA vs AAPL · Stonk Wars" a moment after it was set. So
 * the title is checked on every render, and the arena renders every second
 * with its clock, which puts it back within a second. Watching the head for
 * changes instead would also fight the next page's title on the way out. */
function useTabTitle(title: string) {
  const original = useRef<string | null>(null);
  const wanted = useRef(title);
  useEffect(() => {
    if (original.current === null) original.current = document.title;
    wanted.current = title;
    if (document.title !== title) document.title = title;
  });
  useEffect(
    () => () => {
      if (original.current !== null && document.title === wanted.current) document.title = original.current;
    },
    [],
  );
}

/* Cues fire only on transitions this page watched happen: never for the state
 * a fight was already in when the page loaded, and never at all unless the
 * viewer turned sound on (sfx.ts checks). */
function useFightSounds({
  status,
  m1,
  m2,
  beforeBell,
  secondsLeft,
  ko,
}: {
  status: number;
  m1: number | null;
  m2: number | null;
  beforeBell: boolean;
  secondsLeft: number | null;
  ko: boolean;
}) {
  const lastStatus = useRef<number | null>(null);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = status;
    if (before !== null && before !== STATUS_LIVE && status === STATUS_LIVE) play("bell");
  }, [status]);

  const lastSign = useRef(0);
  useEffect(() => {
    if (!beforeBell || m1 === null || m2 === null) {
      lastSign.current = 0;
      return;
    }
    const sign = Math.sign(m1 - m2);
    if (sign !== 0 && lastSign.current !== 0 && sign !== lastSign.current) play("lead");
    if (sign !== 0) lastSign.current = sign;
  }, [m1, m2, beforeBell]);

  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!beforeBell || secondsLeft === null || secondsLeft > 10 || secondsLeft <= 0) {
      lastTick.current = null;
      return;
    }
    if (lastTick.current !== secondsLeft) play("tick");
    lastTick.current = secondsLeft;
  }, [secondsLeft, beforeBell]);

  useEffect(() => {
    if (ko) play("ko");
  }, [ko]);
}
