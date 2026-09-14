"use client";

/* WHERE TO GO FROM HERE: the seats still open and the other rounds running.
 *
 * On a wide screen the fight page's narrow column held the actions and the
 * share card, then about 500px of nothing beside the receipt. A spectator who
 * came for one fight has nowhere to go next from that. So the column ends with
 * real fights: up to three open challenges still inside their window, newest
 * first, then the other rounds live now, nearest the bell. Both lists leave
 * out the fight on this page, are read from the duel list every board already
 * polls, and disappear when they are empty rather than saying so.
 *
 * Each fight is the home page's two-line closing-soon card rather than a full
 * board row: in a 400px column a board row squeezed its handles, stake and
 * age into one unreadable line. */

import { Card } from "@/components/ClosingSoon";
import { cx } from "@/components/ui/cx";
import { SectionHead } from "@/components/ui/SectionHead";
import { allDuels, STATUS_LIVE, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { isRosterFight } from "@/lib/derive";
import { useDuels } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { tickerForMint } from "@/lib/stocks";

const SEATS = 3;
const LIVE = 3;

export function MoreFights({ address, now, className }: { address: string; now: number; className?: string }) {
  const duels = useDuels("all", allDuels());
  const others = (duels.data ?? []).filter((d) => isRosterFight(d) && d.address.toBase58() !== address);
  const seats = now
    ? others
        .filter((d) => d.status === STATUS_OPEN && d.expiresTs > now)
        .sort((a, b) => b.createdTs - a.createdTs)
        .slice(0, SEATS)
    : [];
  const live = now
    ? others
        .filter((d) => d.status === STATUS_LIVE && d.endTs > now)
        .sort((a, b) => a.endTs - b.endTs)
        .slice(0, LIVE)
    : [];
  // Only a live card shows moves; an open one shows its Take chip.
  const prices = usePrices(live.flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]));

  if (!seats.length && !live.length) return null;

  const list = (title: string, tab: "open" | "live", rows: DuelView[]) =>
    rows.length ? (
      <section aria-labelledby={`more-${tab}`} className="flex min-w-0 flex-col gap-2">
        <SectionHead id={`more-${tab}`} title={title} action={{ href: `/fights?tab=${tab}`, label: "All" }} />
        <ul className="flex flex-col gap-2">
          {rows.map((d) => (
            <li key={d.address.toBase58()} className="min-w-0">
              <Card d={d} now={now} quotes={prices.data?.quotes} />
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  /* No card around the lists: each fight is already a notched rope card, and
   * a card around cards doubles the chrome (the /fights board does the same). */
  return (
    <div className={cx("flex min-w-0 flex-col gap-6", className)}>
      {list("Open seats", "open", seats)}
      {list("Also live", "live", live)}
    </div>
  );
}
