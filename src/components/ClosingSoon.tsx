"use client";

/* CLOSING SOON: the few things on the board with a clock on them.
 *
 * Rounds running now, nearest the bell first, and after them open challenges
 * nearest their deadline, up to four. It is the strip that answers "is anyone
 * fighting right now, and can I still get in", so each card carries its clock
 * and either both moves or a way to take it. Only listed fights; nothing when
 * nothing has a clock, rather than an empty strip that says so.
 *
 * NOT THE MAIN EVENT AGAIN. The home page leads with one fight in a big plate
 * (pickMainEvent), and the same round used to fill this strip's first card
 * and the ring's first row too: one fight three times in 600px. So it is left
 * out here, and when that leaves fewer than four clocked cards, the free slots
 * go to the latest settled fights, each marked Final with its real age, the
 * winner's W and what they took. If nothing with a clock is left, the strip is
 * not drawn at all: finals alone are what the ring below already shows.
 *
 * On a phone the cards scroll sideways inside their own strip, snapping card
 * by card, and the page itself never scrolls sideways. From 1024px all four sit
 * in a row. */

import Link from "next/link";
import { useId } from "react";

import { Move, movePair } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import { cx } from "@/components/ui/cx";
import { allDuels, STATUS_LIVE, STATUS_OPEN, STATUS_SETTLED, type DuelView } from "@/lib/duel";
import { isRosterFight, loserTake, winnerSide, type Side } from "@/lib/derive";
import { ago, span, until, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { movePct, usePrices, type Quotes } from "@/lib/prices";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

import { pickMainEvent } from "./MainEvent";

const CARDS = 4;

export function ClosingSoon() {
  const duels = useDuels("all", allDuels());
  const now = useNow();
  // The page mounts this twice (above the board, and under the ring on a phone).
  const headId = useId();
  const all = (duels.data ?? []).filter(isRosterFight);
  const main = now && duels.data ? pickMainEvent(duels.data, now)?.address.toBase58() : undefined;
  const notMain = (d: DuelView) => d.address.toBase58() !== main;

  const live = all.filter((d) => d.status === STATUS_LIVE && d.endTs > now && notMain(d)).sort((a, b) => a.endTs - b.endTs);
  const open = all.filter((d) => d.status === STATUS_OPEN && d.expiresTs > now && notMain(d)).sort((a, b) => a.expiresTs - b.expiresTs);
  const clocked = now ? [...live, ...open].slice(0, CARDS) : [];
  const finals =
    clocked.length && clocked.length < CARDS
      ? all
          .filter((d) => d.status === STATUS_SETTLED && d.endTs <= now && notMain(d))
          .sort((a, b) => b.endTs - a.endTs)
          .slice(0, CARDS - clocked.length)
      : [];
  const cards = [...clocked, ...finals];

  const prices = usePrices(
    clocked.filter((d) => d.status === STATUS_LIVE).flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]),
  );

  if (!clocked.length) return null;

  return (
    <section aria-labelledby={headId} className="flex min-w-0 flex-col gap-2">
      <h2 id={headId} className="label">
        {finals.length ? "Closing soon · just settled" : "Closing soon"}
      </h2>
      {/* scroll-px-4 matches the strip's own padding, so the first card snaps
        * to the page's 16px gutter instead of flush against the screen edge. */}
      <ul
        className={cx(
          "scroll-thin -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1",
          "lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0",
        )}
      >
        {cards.map((d) => (
          <li key={d.address.toBase58()} className="w-72 shrink-0 snap-start lg:w-auto">
            {d.status === STATUS_SETTLED ? <FinalCard d={d} now={now} /> : <Card d={d} now={now} quotes={prices.data?.quotes} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One fight with a clock on it, in two lines. Also the fight page's "Open
 *  seats" and "Also live" rails, where a full board row has no room. */
export function Card({ d, now, quotes }: { d: DuelView; now: number; quotes?: Quotes["quotes"] }) {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const isLive = d.status === STATUS_LIVE;
  const move = (start: DuelView["creatorStart"], ticker: string) => {
    const q = quotes?.[ticker];
    return q && start.price > BigInt(0) ? movePct(start, q) : null;
  };
  const m1 = isLive ? move(d.creatorStart, t1) : null;
  const m2 = isLive ? move(d.opponentStart, t2) : null;
  const [s1, s2] = movePair(m1, m2);

  /* Two lines, so the strip costs the board as little height as it can: the
   * state and its clock, then the two corners. A live card puts each move
   * beside its ticker; an open one puts the Take chip where the answerer's
   * move will be. A live move is since the on-chain start, and says so on hover. */
  return (
    <Link
      href={`/f/${d.address.toBase58()}`}
      className="plate-card rope row flex h-full min-w-0 flex-col gap-1.5 px-3 py-2.5 focus-visible:-outline-offset-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {isLive ? <Badge variant="live" /> : <Badge>{d.durationSecs ? span(d.durationSecs) : "To the bell"}</Badge>}
        {isLive ? (
          <span className="text-meta">
            <span className="sr-only">Bell in </span>
            <Countdown to={d.endTs} now={now} className="text-ink" />
          </span>
        ) : (
          <span className="num truncate text-meta text-dim">closes {until(d.expiresTs, now)}</span>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="display shrink-0 text-hud-sm text-p1-soft normal-case">{t1}</span>
          {isLive ? (
            <span title="Since the on-chain start" className="min-w-0 truncate">
              <Move value={m1} text={s1} className="num text-meta" />
            </span>
          ) : null}
        </span>
        <span className="micro shrink-0 text-dim">vs</span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          {isLive ? (
            <span title="Since the on-chain start" className="min-w-0 truncate">
              <Move value={m2} text={s2} className="num text-meta" />
            </span>
          ) : (
            <span className="btn btn-p2 h-6 shrink-0 px-3 py-0 text-sm" aria-hidden="true">
              Take
            </span>
          )}
          <span className="display shrink-0 text-hud-sm text-p2-soft normal-case">{t2}</span>
        </span>
      </div>
    </Link>
  );
}

/* A just-settled fight in the same two lines: Final and its real age, what
 * the winner took (green, because that is money taken), then the corners with
 * the W beside the winner and the loser's ticker at half strength beside the
 * mini COOKED stamp. */
function FinalCard({ d, now }: { d: DuelView; now: number }) {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const won = winnerSide(d);
  const take = loserTake(d);
  const corner = (s: Side) => {
    const ticker = s === "p1" ? t1 : t2;
    const winner = won === s;
    return (
      <span className={cx("flex min-w-0 items-center gap-2", s === "p2" && "flex-row-reverse")}>
        <span className={cx("display shrink-0 text-hud-sm normal-case", s === "p1" ? "text-p1-soft" : "text-p2-soft", won && !winner && "opacity-50")}>
          {ticker}
        </span>
        {won ? (
          winner ? (
            <Badge variant="win" title="Won at the bell">
              W
            </Badge>
          ) : (
            <Badge variant="cooked" />
          )
        ) : null}
      </span>
    );
  };
  return (
    <Link
      href={`/f/${d.address.toBase58()}`}
      className="plate-card rope row flex h-full min-w-0 flex-col gap-1.5 px-3 py-2.5 focus-visible:-outline-offset-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Badge>Final</Badge>
          <span className="num truncate text-meta text-dim">{ago(d.endTs, now)}</span>
        </span>
        {take ? <span className="num shrink-0 text-meta text-up">took {usd(take.usd)}</span> : null}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        {corner("p1")}
        <span className="micro shrink-0 text-dim">vs</span>
        {corner("p2")}
      </div>
    </Link>
  );
}
