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

import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
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
    {
      label: "Wallets",
      tip: "Wallets with a settled result on chain",
      value: chain(fighters),
      href: "/leaderboard",
    },
  ];

  /* A PHONE GETS FOUR CELLS IN ONE ROW. Seven cells in three rows took a
   * third of the first screen, which left room for a row and a half of fights
   * under them. The four that move (live or the last bell, open, settled,
   * taken) stay here in a tighter cell; the three that are about the roster
   * and the wallets move down to the proof strip on a phone (ProofStrip). */
  const phone: { label: string; value: ReactNode; href?: string }[] = [
    live > 0
      ? {
          label: "Live",
          value: chain(
            <span className="inline-flex items-center gap-1.5">
              <LiveDot />
              {live}
            </span>,
          ),
          href: "/fights?tab=live",
        }
      : { label: "Last bell", value: chain(<span className="num text-sm">{bell ? ago(bell, now) : "--"}</span>) },
    { label: "Open", value: chain(open), href: "/fights?tab=open" },
    { label: "Settled", value: chain(settled), href: "/fights?tab=final" },
    { label: "Taken", value: chain(<span className="num text-sm">{usd(taken)}</span>) },
  ];

  return (
    <>
      <dl aria-label="Across the chain" className="grid grid-cols-4 gap-px bg-line ring-1 ring-line sm:hidden">
        {phone.map((c) => (
          <div
            key={c.label}
            className={cx(
              "relative flex min-w-0 flex-col gap-1 bg-panel px-2 py-2",
              c.href && "transition-colors hover:bg-panel-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ink",
            )}
          >
            <dt className="micro truncate text-dim">{c.label}</dt>
            <dd className="display flex h-5 min-w-0 items-center truncate text-hud-xs text-ink">
              {c.href ? (
                <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none">
                  {c.value}
                </Link>
              ) : (
                c.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {/* Seven cells across a 1280px column leave about 18 characters of label
        * each. A truncated label hides what the number counts, so labels here
        * may wrap onto a second line instead. */}
      <div className="hidden sm:block">
        <StatStrip label="Across the chain" cells={cells} cols={{ base: 3, sm: 4, lg: 7 }} className="[&_dt]:whitespace-normal" />
      </div>
    </>
  );
}
