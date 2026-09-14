"use client";

/* CLOSING SOON: the few things on the board with a clock on them.
 *
 * Rounds running now, nearest the bell first, and after them open challenges
 * nearest their deadline, up to four. It is the strip that answers "is anyone
 * fighting right now, and can I still get in", so each card carries its clock
 * and either both moves or a way to take it. Only listed fights; nothing when
 * nothing has a clock, rather than an empty strip that says so.
 *
 * On a phone the cards scroll sideways inside their own strip, snapping card
 * by card, and the page itself never scrolls sideways. From 1024px all four sit
 * in a row. */

import Link from "next/link";
import { useId } from "react";

import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import { cx } from "@/components/ui/cx";
import { allDuels, STATUS_LIVE, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { isRosterFight } from "@/lib/derive";
import { span, until } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { movePct, usePrices, type Quotes } from "@/lib/prices";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

const CARDS = 4;

export function ClosingSoon() {
  const duels = useDuels("all", allDuels());
  const now = useNow();
  // The page mounts this twice (above the board, and under the ring on a phone).
  const headId = useId();
  const all = (duels.data ?? []).filter(isRosterFight);

  const live = all.filter((d) => d.status === STATUS_LIVE && d.endTs > now).sort((a, b) => a.endTs - b.endTs);
  const open = all.filter((d) => d.status === STATUS_OPEN && d.expiresTs > now).sort((a, b) => a.expiresTs - b.expiresTs);
  const cards = now ? [...live, ...open].slice(0, CARDS) : [];

  const prices = usePrices(
    cards.filter((d) => d.status === STATUS_LIVE).flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]),
  );

  if (!cards.length) return null;

  return (
    <section aria-labelledby={headId} className="flex min-w-0 flex-col gap-2">
      <h2 id={headId} className="label">
        Closing soon
      </h2>
      <ul
        className={cx(
          "scroll-thin -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1",
          "lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0",
        )}
      >
        {cards.map((d) => (
          <li key={d.address.toBase58()} className="w-72 shrink-0 snap-start lg:w-auto">
            <Card d={d} now={now} quotes={prices.data?.quotes} />
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

  /* Two lines, so the strip costs the board as little height as it can: the
   * state and its clock, then the two corners. A live card puts each move
   * beside its ticker; an open one puts the Take chip where the answerer's
   * move will be. */
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
          <span className="display shrink-0 text-hud-sm text-p1 normal-case">{t1}</span>
          {isLive ? <Move value={move(d.creatorStart, t1)} className="num truncate text-meta" /> : null}
        </span>
        <span className="micro shrink-0 text-dim">vs</span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          {isLive ? (
            <Move value={move(d.opponentStart, t2)} className="num truncate text-meta" />
          ) : (
            <span className="btn btn-p2 h-6 shrink-0 px-3 py-0 text-sm" aria-hidden="true">
              Take
            </span>
          )}
          <span className="display shrink-0 text-hud-sm text-p2 normal-case">{t2}</span>
        </span>
      </div>
    </Link>
  );
}
