"use client";

/* A WALLET'S FIRST FIGHT, OFFERED BY NAME.
 *
 * "No fights on chain for this wallet yet" with one Pick a fight button is a
 * dead end when a real seat is open right now. So the viewer's own empty
 * profile and their empty My fights tab both lead with that seat: the open
 * challenge nearest its deadline that this wallet may take, named with its
 * stake at the challenger's live price, in the answerer's colour because
 * taking is the answerer's move. Pick a fight stays beside it.
 *
 * Only for the connected wallet's own pages. On anyone else's there is nothing
 * of theirs to offer, and the plain empty state stands. */

import Link from "next/link";

import { Empty } from "@/components/ui/Empty";
import { isRosterFight } from "@/lib/derive";
import { isInviteOnly, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { usd } from "@/lib/format";
import { stakeValue, usePrices } from "@/lib/prices";
import { decimalsForMint, tickerForMint } from "@/lib/stocks";

/** The open seat, nearest its deadline, that `wallet` may take: a listed pair,
 *  not its own, and open to anyone or naming it. */
export function nearestSeat(duels: DuelView[], wallet: string, now: number): DuelView | null {
  if (!now) return null;
  return (
    duels
      .filter(
        (d) =>
          isRosterFight(d) &&
          d.status === STATUS_OPEN &&
          d.expiresTs > now &&
          d.creator.toBase58() !== wallet &&
          (!isInviteOnly(d) || d.invitee.toBase58() === wallet),
      )
      .sort((a, b) => a.expiresTs - b.expiresTs)[0] ?? null
  );
}

/** "AMZN vs HOOD · $25 a side · Take it", the stake at the challenger's live price. */
function SeatLabel({ d, t1, t2 }: { d: DuelView; t1: string; t2: string }) {
  const prices = usePrices([t1]);
  const v = stakeValue(d.creatorAmount, decimalsForMint(d.creatorMint), prices.data?.quotes[t1]);
  return (
    <>
      {t1} vs {t2}
      {v !== null && Number.isFinite(v) ? <span className="num"> · {usd(Math.max(1, Math.round(v)), { cents: false })} a side</span> : null} · Take it
    </>
  );
}

export function FirstFightOffer({
  duels,
  wallet,
  now,
  title = "No fights on chain for this wallet yet.",
  className,
}: {
  duels: DuelView[];
  wallet: string;
  now: number;
  title?: string;
  className?: string;
}) {
  const seat = nearestSeat(duels, wallet, now);
  if (!seat) {
    return (
      <Empty
        title={title}
        body="Pick one and this page starts keeping score."
        action={{ href: "/new", label: "Pick a fight", tone: "p1" }}
        className={className}
      />
    );
  }
  const t1 = tickerForMint(seat.creatorMint) ?? "?";
  const t2 = tickerForMint(seat.opponentMint) ?? "?";
  return (
    <Empty
      title={title}
      body={`${t1} vs ${t2} is open now and yours to take, or pick your own. This page starts keeping score at the first one.`}
      className={className}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={`/f/${seat.address.toBase58()}`} className="btn btn-sm btn-p2">
            <SeatLabel d={seat} t1={t1} t2={t2} />
          </Link>
          <Link href="/new" className="btn btn-sm btn-ghost">
            Pick a fight
          </Link>
        </div>
      }
    />
  );
}
