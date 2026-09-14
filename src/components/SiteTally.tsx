"use client";

/* The numbers that say whether any of this is real, across the top.
 *
 * Every one is counted from chain state or from the roster, never typed in, so
 * a quiet week shows a quiet number rather than a claim. Two rules from the
 * brief shape it:
 *
 * QUIET IS SHOWN WITH A REAL AGE. "Rounds live 0" told a visitor nothing, and
 * looked like a dead app. When no round is running the cell says when the last
 * bell rang instead, from the newest result's end time on its account, and
 * swaps back to the live count (with the split dot) the moment one starts.
 *
 * INK, NOT GREEN. The counts used to be green, which on this site says a price
 * went up. A count is not a move and money in a tally is not a win, so every
 * value is ink. Loading shows the shape of a number, never a zero. */

import type { ReactNode } from "react";

import { LiveDot } from "@/components/ui/LiveDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatStrip, type StatCell } from "@/components/ui/StatStrip";
import { allDuels, STATUS_LIVE, STATUS_OPEN } from "@/lib/duel";
import { lastBell } from "@/lib/derive";
import { ago, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { tallyOf } from "@/lib/leaderboard";
import { AROUND_THE_CLOCK, ROSTER, STAKE_DECIMALS } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export function SiteTally() {
  const duels = useDuels("all", allDuels(), 20_000);
  const now = useNow();
  const all = duels.data ?? [];
  const ready = !!duels.data && now > 0;
  const { settled, fighters, taken } = tallyOf(all, STAKE_DECIMALS);

  const live = all.filter((d) => d.status === STATUS_LIVE && d.endTs > now).length;
  const open = all.filter((d) => d.status === STATUS_OPEN && d.expiresTs > now).length;
  const bell = lastBell(all);

  const chain = (value: ReactNode) => (ready ? value : <Skeleton className="h-6 w-12" />);

  const cells: StatCell[] = [
    { label: "Tokenized stocks", value: ROSTER.length.toLocaleString("en-US") },
    { label: "Fight 24/7", value: AROUND_THE_CLOCK.toLocaleString("en-US") },
    live > 0
      ? {
          label: "Rounds live",
          value: chain(
            <span className="inline-flex items-center gap-2">
              <LiveDot />
              {live}
            </span>,
          ),
          href: "/fights?tab=live",
        }
      : {
          label: "Last bell",
          value: chain(<span className="num text-num-lg">{bell ? ago(bell, now) : "--"}</span>),
        },
    { label: "Open challenges", value: chain(open), href: "/fights?tab=open" },
    { label: "Fights settled", value: chain(settled), href: "/fights?tab=final" },
    { label: "Taken off losers", value: chain(<span className="num text-num-lg">{usd(taken)}</span>) },
    { label: "Wallets with a result", value: chain(fighters), href: "/leaderboard" },
  ];

  /* Seven cells across a 1280px column leave about 18 characters of label
   * each, and "Wallets with a result" is 21. A truncated label hides what the
   * number counts, so labels here wrap onto a second line instead. That also
   * lets a phone take three cells a row, which keeps the strip to three rows
   * and leaves the first screen room for the ring. */
  return (
    <StatStrip
      label="Across the chain"
      cells={cells}
      cols={{ base: 3, sm: 4, lg: 7 }}
      className="[&_dt]:whitespace-normal"
    />
  );
}
