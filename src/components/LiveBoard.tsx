"use client";

/* The ring: open challenges and live rounds, newest first. */

import Link from "next/link";

import { FightRow } from "@/components/FightRow";
import { allDuels, STATUS_ACCEPTED, STATUS_LIVE, STATUS_OPEN } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export function LiveBoard({ limit = 12 }: { limit?: number }) {
  const duels = useDuels("all", allDuels());
  const now = useNow();

  const active = (duels.data ?? [])
    .filter(
      (d) =>
        d.status === STATUS_LIVE ||
        d.status === STATUS_ACCEPTED ||
        (d.status === STATUS_OPEN && (!now || d.expiresTs > now)),
    )
    .sort((a, b) => (a.status === STATUS_LIVE ? -1 : 0) - (b.status === STATUS_LIVE ? -1 : 0))
    .slice(0, limit);
  const prices = usePrices(active.flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]));

  if (duels.isLoading) return <p className="text-dim">Checking the ring...</p>;
  if (duels.error) return <p className="text-down">Could not read the chain: {String(duels.error)}</p>;
  if (!active.length)
    return (
      <div className="card flex flex-col items-center gap-4 p-10 text-center">
        <p className="display text-4xl">The ring is empty.</p>
        <p className="text-dim">Nobody is fighting right now. Be the one who starts it.</p>
        <Link href="/new" className="btn btn-p1">
          Pick a fight
        </Link>
      </div>
    );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {active.map((d) => (
        <FightRow key={d.address.toBase58()} d={d} now={now} quotes={prices.data} />
      ))}
    </div>
  );
}
