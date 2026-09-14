"use client";

/* ONE FIGHT, ON A BOARD.
 *
 * A row has to answer four questions without being opened: which two stocks,
 * what state the fight is in and since when, the number that matters (the
 * moves, the clock, what the winner took) and who is in each corner. The old
 * row answered two of them. A settled fight did not say who won, the winner's
 * move was often red beside the word "final", and the answerer's ticker fell
 * off a phone.
 *
 * THE SAME CELLS, PLACED TWICE. From 640px the row is the arena in miniature:
 * challenger on the left, the state in the middle, answerer on the right, and
 * a second line of who and how much under each. Below that there is no room
 * for three columns, so the cells re-flow into a ladder: the challenger and
 * its move, the answerer and its move, then the state and the stake. It is one
 * grid with two placements rather than two copies of the row, so a countdown
 * and a handle lookup run once per fight, not twice.
 *
 * Heights are budgeted: 64px on a desktop board (an open challenge with a
 * taunt adds one 20px line), and never more than 96px on a phone.
 *
 * Colours keep their meanings. Tickers are the side's colour. Moves are green
 * or red because they are moves. The winner's W and what they took are green
 * because that is what green is for, the loser's ticker drops to half strength
 * and carries the small COOKED stamp beside it, never over it. The state is an
 * ink badge. */

import Link from "next/link";
import type { ReactNode } from "react";

import { Move, movePair } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import { cx } from "@/components/ui/cx";
import { FighterName } from "@/components/ui/FighterName";
import {
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { isDecided, loserTake, margin, moves, winnerSide, type Side } from "@/lib/derive";
import { ago, clock, points, shares, shortAddress, span, until, usd } from "@/lib/format";
import { movePct, stakeValue, type Quotes } from "@/lib/prices";
import { neverSides, roundClock, shutSides } from "@/lib/roundClock";
import { decimalsForMint, tickerForMint, tokenSymbol } from "@/lib/stocks";

/** The default key: an empty opponent or invitee slot. */
const EMPTY_KEY = "11111111111111111111111111111111";

/** Each side's move: from the chain once both ends are posted, from the live
 *  quote while the round runs, and nothing before a start exists. */
function rowMoves(d: DuelView, quotes: Quotes | undefined, t1: string, t2: string): [number | null, number | null] {
  const onChain = moves(d);
  if (onChain) return onChain;
  if (d.status !== STATUS_LIVE) return [null, null];
  const live = (start: DuelView["creatorStart"], ticker: string) => {
    const q = quotes?.quotes[ticker];
    return q && start.price > BigInt(0) ? movePct(start, q) : null;
  };
  return [live(d.creatorStart, t1), live(d.opponentStart, t2)];
}

/* The money line. A decided fight says by how much it was decided, which is
 * on the account. Anything still in play says what each side has up, at
 * today's price, and only once there is a price. */
function stakeLine(d: DuelView, quotes: Quotes | undefined, t1: string): string | null {
  if (isDecided(d)) {
    const gap = margin(d);
    return gap !== null ? `by ${points(gap)} pts` : null;
  }
  if (d.status !== STATUS_OPEN && d.status !== STATUS_ACCEPTED && d.status !== STATUS_LIVE) return null;
  const v = stakeValue(d.creatorAmount, decimalsForMint(d.creatorMint), quotes?.quotes[t1]);
  if (v === null || !Number.isFinite(v)) return null;
  return `${v < 1 ? "under $1" : usd(v, { cents: v < 10 })} a side`;
}

export function FightRow({
  d,
  now,
  quotes,
  compact = false,
  viewer,
  you = false,
}: {
  d: DuelView;
  now: number;
  quotes?: Quotes;
  /** Leaves out the taunt line, for rails where every row must be one height. */
  compact?: boolean;
  /** Read the row as this wallet's ledger (a profile, or My fights): its corner
   *  is marked and a result says W or L with the money that moved. */
  viewer?: string;
  /** The viewer is the connected wallet, so its corner says "You". */
  you?: boolean;
}) {
  const address = d.address.toBase58();
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const [m1, m2] = rowMoves(d, quotes, t1, t2);
  const [s1, s2] = movePair(m1, m2);

  const expired = d.status === STATUS_OPEN && now > 0 && d.expiresTs <= now;
  const open = d.status === STATUS_OPEN && !expired;
  const won = winnerSide(d);
  const take = loserTake(d);
  const stake = stakeLine(d, quotes, t1);
  const opponent = d.opponent.toBase58();
  const invitee = d.invitee.toBase58();
  const { badge, age } = rowStatus(d, now);

  /* WHOSE LEDGER. On a profile the history used to be a list of other people's
   * fights: which corner was this fighter's took reading a 10px address under
   * each ticker. So the viewer's corner is labelled, and a result says W or L
   * in the middle with what moved: "took $6.48" in green for a win, "lost
   * $2.57" in dim ink for a loss, never red, which is a price move. */
  const mine: Side | null = viewer ? (viewer === d.creator.toBase58() ? "p1" : viewer === opponent ? "p2" : null) : null;
  const result = mine && won ? (won === mine ? "W" : "L") : null;
  const ledger =
    result && take ? (
      result === "W" ? (
        <span className="num text-up">took {usd(take.usd)}</span>
      ) : (
        <span className="num text-dim">lost {usd(take.usd)}</span>
      )
    ) : null;

  const side = (s: Side) => {
    const ticker = s === "p1" ? t1 : t2;
    const move = s === "p1" ? m1 : m2;
    const winner = won === s;
    const loser = won !== undefined && !winner;
    return (
      <div
        className={cx(
          "flex min-w-0 items-center gap-2",
          /* On a phone each side is a full line with its number at the far end.
           * From 640px the answerer's cell runs right to left, so its ticker
           * sits against the row's right edge the way it does in the arena. */
          "justify-between",
          s === "p1" ? "sm:justify-start" : "sm:flex-row-reverse sm:justify-start",
        )}
      >
        <span className={cx("flex min-w-0 items-center gap-2", s === "p2" && "sm:flex-row-reverse")}>
          <span
            className={cx(
              // normal-case: a test ticker such as "SOLt" keeps its case.
              "display shrink-0 text-hud-sm normal-case",
              s === "p1" ? "text-p1" : "text-p2",
              loser && "opacity-50",
            )}
          >
            {ticker}
          </span>
          {winner ? (
            <Badge variant="win" title="Won at the bell">
              W
            </Badge>
          ) : null}
          {loser ? <Badge variant="cooked" /> : null}
          {/* A phone has no second line under each side, so the money taken
            * rides beside the W instead. */}
          {winner && take ? (
            <span className="num truncate text-meta text-up sm:hidden">took {usd(take.usd)}</span>
          ) : null}
        </span>
        {move !== null ? (
          <span className="shrink-0" title={d.status === STATUS_LIVE ? "Since the on-chain start" : "At the bell"}>
            <Move value={move} text={s === "p1" ? s1 : s2} className="num text-sm" />
          </span>
        ) : s === "p2" && open ? (
          /* An open corner has no move yet. Its slot holds the way in: a chip
           * in the answerer's colour, styled as a button, though the whole row
           * is the link. */
          <span className="btn btn-p2 h-6 shrink-0 px-3 py-0 text-sm" aria-hidden="true">
            Take
          </span>
        ) : null}
      </div>
    );
  };

  /* Who is in each corner, and what they have up or took. An empty seat says
   * so, with the stake a taker would match beside it. */
  const who = (s: Side) => {
    let name: ReactNode;
    let amount: ReactNode = null;
    if (s === "p1") {
      name = <FighterName wallet={d.creator.toBase58()} size="sm" href={null} />;
      amount = `${shares(d.creatorAmount, decimalsForMint(d.creatorMint))} ${tokenSymbol(t1)}`;
    } else if (opponent !== EMPTY_KEY) {
      name = <FighterName wallet={opponent} size="sm" href={null} />;
      if (d.opponentAmount > BigInt(0)) {
        amount = `${shares(d.opponentAmount, decimalsForMint(d.opponentMint))} ${tokenSymbol(t2)}`;
      }
    } else {
      const seat =
        invitee !== EMPTY_KEY ? (
          <>
            For <span className="num">{shortAddress(invitee)}</span>
          </>
        ) : expired ? (
          "Nobody took it"
        ) : (
          "Open seat"
        );
      name = (
        <span className="truncate">
          {seat}
          {open && stake ? <span className="num"> · {stake}</span> : null}
        </span>
      );
    }
    if (won === s && take) amount = <span className="text-up">took {usd(take.usd)}</span>;
    /* Phones have no room for this line at all, so the cell is out of the grid
     * there (display none), not an empty cell pushing in a blank row. */
    return (
      <div
        className={cx(
          "hidden min-w-0 items-center gap-2 text-meta text-dim sm:row-start-2 sm:flex",
          s === "p1" ? "sm:col-start-1" : "sm:col-start-3 sm:justify-end",
        )}
      >
        {mine === s ? <span className="micro shrink-0 text-ink">{you ? "You" : "This fighter"}</span> : null}
        {name}
        {amount ? <span className="num shrink-0">{amount}</span> : null}
      </div>
    );
  };

  /* THE MIDDLE STAYS NARROW. Its column is as wide as its widest line, and
   * every pixel it takes comes off both corners, which is where the handles
   * truncate. So the middle holds only the badge over the age or clock; the
   * money line goes to a phone's last row, or beside an empty seat. */
  return (
    <Link
      href={`/f/${address}`}
      className={cx(
        "@container plate-card rope row block min-w-0 px-3 py-2 focus-visible:-outline-offset-2 sm:py-2.5",
        /* Phone: each corner a full line, then badge, age and money. From
         * 640px: challenger, state, answerer, with who and how old beneath. */
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1",
        "sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-3",
      )}
    >
      <div className="col-span-3 min-w-0 sm:col-span-1 sm:col-start-1 sm:row-start-1">{side("p1")}</div>
      <div className="col-span-3 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">{side("p2")}</div>

      <div className="col-start-1 row-start-3 flex items-center gap-1 sm:col-start-2 sm:row-start-1 sm:justify-center">
        {badge}
        {result === "W" ? (
          <Badge variant="win" title="This fighter won">
            W
          </Badge>
        ) : result === "L" ? (
          <Badge title="This fighter lost">L</Badge>
        ) : null}
      </div>
      <div className="col-start-2 row-start-3 min-w-0 truncate text-meta text-dim sm:col-start-2 sm:row-start-2 sm:text-center">
        {age}
        {ledger ? <> · {ledger}</> : null}
        {/* A wide row (a board, not the home page's ring) has room for the
          * money line a phone shows on its last row: what each side has up,
          * or how close a result was. */}
        {/* An open seat already carries its stake beside "Open seat". */}
        {stake && !ledger && !open ? (
          <span className="num hidden @[40rem]:inline"> · {stake}</span>
        ) : null}
      </div>
      <div className="col-start-3 row-start-3 min-w-0 text-right text-meta text-dim sm:hidden">
        {stake ? <span className="num whitespace-nowrap">{stake}</span> : null}
      </div>

      {who("p1")}
      {who("p2")}

      {open && d.taunt && !compact ? (
        <p className="col-span-3 hidden min-w-0 truncate text-meta text-dim italic sm:row-start-3 sm:block">
          &ldquo;{d.taunt}&rdquo;
        </p>
      ) : null}
    </Link>
  );
}

/* The state as a badge, and beneath it (beside it on a phone) the age or the
 * clock: always a real time from the account against the viewer's clock. */
function rowStatus(d: DuelView, now: number): { badge: ReactNode; age: ReactNode } {
  const text = (t: string | null) => (t ? <span className="num">{t}</span> : null);
  switch (d.status) {
    case STATUS_LIVE:
      if (!now || d.endTs > now) {
        return { badge: <Badge variant="live" />, age: <Countdown to={d.endTs} now={now} className="text-ink" /> };
      }
      if (neverPriced(d, now)) return { badge: <Badge>Bell</Badge>, age: text("can never settle") };
      if (waitingForMarket(d, now)) return { badge: <Badge>Bell</Badge>, age: text("waiting for the open") };
      if (isLate(d, now)) return { badge: <Badge>Late</Badge>, age: text(`settle late · bell ${ago(d.endTs, now)}`) };
      return { badge: <Badge>Bell</Badge>, age: text("settling") };
    case STATUS_OPEN:
      if (now && d.expiresTs <= now) return { badge: <Badge>Expired</Badge>, age: text(ago(d.expiresTs, now)) };
      return {
        badge: <Badge>{d.durationSecs ? span(d.durationSecs) : "To the bell"}</Badge>,
        age: text(now ? `closes ${until(d.expiresTs, now)}` : null),
      };
    case STATUS_ACCEPTED:
      if (neverPriced(d, now)) return { badge: <Badge>Taken</Badge>, age: text("can never start") };
      if (waitingForMarket(d, now)) return { badge: <Badge>Taken</Badge>, age: text("waiting for the open") };
      if (isLate(d, now)) return { badge: <Badge>Late</Badge>, age: text(`start late · taken ${ago(d.acceptedTs, now)}`) };
      return { badge: <Badge>Taken</Badge>, age: text("locking prices") };
    case STATUS_SETTLED:
      return { badge: <Badge>Final</Badge>, age: text(now && d.endTs ? ago(d.endTs, now) : null) };
    case STATUS_REFUNDED:
      /* A dead heat rang its bell at endTs. A stalled fight sent home early has
       * no recorded refund time, and its endTs may still be ahead, so it gets an
       * age only once that time has really passed. */
      return {
        badge: <Badge>{d.outcome === OUTCOME_TIE ? "Dead heat" : "Refunded"}</Badge>,
        age: text(now && d.endTs && d.endTs <= now ? ago(d.endTs, now) : null),
      };
    case STATUS_VOID:
      return { badge: <Badge>Void</Badge>, age: null };
    default:
      return { badge: null, age: null };
  }
}

/** The row's state in words, for anything that needs it as text: "Live · 4:12",
 *  "15 min round · closes in 6d", "Final · 3h ago", "Dead heat". */
function statusLine(d: DuelView, now: number): string {
  switch (d.status) {
    case STATUS_OPEN:
      if (now && d.expiresTs <= now) return "Expired";
      return `${d.durationSecs ? `${span(d.durationSecs)} round` : "To the bell"}${now ? ` · closes ${until(d.expiresTs, now)}` : ""}`;
    case STATUS_ACCEPTED:
      /* "Locking prices" reads as broken when it lasts all weekend. If the
       * market that prices either side is shut, say that instead: the fight is
       * fine, it is the exchange that is closed. A fight nothing will ever
       * price says that instead. */
      if (neverPriced(d, now)) return "Can never start";
      if (waitingForMarket(d, now)) return "Waiting for the open";
      return isLate(d, now) ? "Start late" : "Locking prices";
    case STATUS_LIVE:
      if (!now || d.endTs > now) return now ? `Live · ${clock(d.endTs - now)}` : "Live";
      if (neverPriced(d, now)) return "Bell · can never settle";
      if (waitingForMarket(d, now)) return "Bell · waiting for the open";
      return isLate(d, now) ? "Bell · settle late" : "Bell · settling";
    case STATUS_SETTLED:
      return now && d.endTs ? `Final · ${ago(d.endTs, now)}` : "Final";
    case STATUS_VOID:
      return "Void";
    case STATUS_REFUNDED:
      return d.outcome === OUTCOME_TIE ? "Dead heat" : "Refunded";
    default:
      return "";
  }
}

/** True when a side cannot be priced yet because its market is shut, as the
 *  price clock sees it for the boundary the fight is at (roundClock.ts). */
export function waitingForMarket(d: DuelView, now: number): boolean {
  return shutSides(d, now).length > 0;
}

/** True when a side can never be priced at the boundary the fight is at, as
 *  the price clock sees it (roundClock.ts, neverSides). */
export function neverPriced(d: DuelView, now: number): boolean {
  return neverSides(d, now) !== null;
}

/* A FIGHT THE SETTLER HAS LEFT BEHIND.
 *
 * "Locking prices" is true for the first minutes after a take and false two
 * days later, yet a stalled fight used to wear it on every board, dressed as a
 * fight in progress. The fight page already knows the difference: roundClock
 * offers the do-it-yourself button only MANUAL_FALLBACK_SECS after the price
 * could exist, and never while a market that prices a side is shut. A board
 * row asks the same clock (with no nudge, since a board sends none), so the
 * row says "Late" at exactly the moment the fight page says the settler is,
 * and both boards sort such fights below the ones really moving. */
export function isLate(d: DuelView, now: number): boolean {
  if (!now || (d.status !== STATUS_ACCEPTED && d.status !== STATUS_LIVE)) return false;
  return roundClock(d, now).manual !== null;
}

export { statusLine };
