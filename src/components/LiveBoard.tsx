"use client";

/* The ring: open challenges and live rounds, newest first. */

import Link from "next/link";

import { FightRow } from "@/components/FightRow";
import { allDuels, STATUS_ACCEPTED, STATUS_LIVE, STATUS_OPEN, STATUS_SETTLED } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export function LiveBoard({ limit = 12, columns = 2 }: { limit?: number; columns?: 1 | 2 }) {
  const duels = useDuels("all", allDuels());
  const now = useNow();

  const all = duels.data ?? [];
  const active = all
    .filter(
      (d) =>
        d.status === STATUS_LIVE ||
        d.status === STATUS_ACCEPTED ||
        (d.status === STATUS_OPEN && (!now || d.expiresTs > now)),
    )
    .sort((a, b) => (a.status === STATUS_LIVE ? -1 : 0) - (b.status === STATUS_LIVE ? -1 : 0));

  /* A quiet minute is not an empty app. When nothing is running, the board
   * fills with what just finished, which is the better answer to "is anyone
   * actually using this" anyway. */
  const finished = all
    .filter((d) => d.status === STATUS_SETTLED)
    .sort((a, b) => b.endTs - a.endTs)
    .slice(0, Math.max(0, limit - active.length));

  const shown = [...active.slice(0, limit), ...finished];
  const prices = usePrices(shown.flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]));

  if (duels.isLoading) return <p className="text-dim">Checking the ring...</p>;
  if (duels.error) return <p className="text-down">Could not read the chain: {String(duels.error)}</p>;
  if (!shown.length)
    return (
      <div className="card flex flex-col items-center gap-4 p-10 text-center">
        <p className="display text-4xl">The ring is empty.</p>
        <p className="text-dim">Nobody has fought yet. Be the one who starts it.</p>
        <Link href="/new" className="btn btn-p1">
          Pick a fight
        </Link>
      </div>
    );

  return (
    <div className={`grid gap-3 ${columns === 2 ? "md:grid-cols-2" : ""}`}>
      {shown.map((d) => (
        <FightRow key={d.address.toBase58()} d={d} now={now} quotes={prices.data} />
      ))}
    </div>
  );
}
