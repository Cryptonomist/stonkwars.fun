"use client";

/* Who cooks: the top of the leaderboard, in a rail.
 *
 * The same ranking as the leaderboard page (lib/leaderboard rankFighters, by
 * money taken, then wins), from the same settled fights on chain, so a wallet
 * sits at the same place in both. Each row is a 36px line: rank, fighter,
 * record, money.
 *
 * Nothing here is a side. The rank used to be cyan and the L red, which said
 * "challenger" and "price down" about a number and a record, so the rank is
 * an ink plate, the L is dim, and money taken is green only when there is some:
 * $0.00 in green would call nothing a win. */

import Link from "next/link";

import { FighterName } from "@/components/ui/FighterName";
import { Notice } from "@/components/ui/Notice";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { allDuels } from "@/lib/duel";
import { usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { rankFighters } from "@/lib/leaderboard";
import { isSparWallet } from "@/lib/spar";
import { STAKE_DECIMALS } from "@/lib/stocks";

/** Below half a cent a figure prints as $0.00, and $0.00 is not money taken. */
const tookSomething = (n: number) => n >= 0.005;

export function TopFighters({ rows = 8 }: { rows?: number }) {
  const duels = useDuels("all", allDuels(), 20_000);
  // The sparring wallet is the site's own opponent, left off the ranks as on the leaderboard.
  const ranked = rankFighters(duels.data ?? [], STAKE_DECIMALS).filter((r) => !isSparWallet(r.wallet));
  const top = ranked.slice(0, rows);

  if (duels.isLoading) return <SkeletonRows kind="fighter" rows={Math.min(rows, 5)} />;

  if (duels.error && !duels.data) {
    return (
      <Notice
        tone="error"
        title="Could not reach Solana."
        action={
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duels.refetch()}>
            Retry
          </button>
        }
      />
    );
  }

  if (!top.length) {
    return <p className="py-2 text-sm text-dim">No wallet has a result yet. The first bell puts one here.</p>;
  }

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col" aria-label="Top fighters by money taken">
        {top.map((r, i) => (
          <li key={r.wallet} className="flex h-9 min-w-0 items-center gap-2 border-t border-line first:border-t-0">
            <span
              className="plate display inline-flex h-6 min-w-8 shrink-0 items-center justify-center bg-panel-3 px-2 text-hud-xs text-ink"
              // The list is ordered, so a screen reader already says the rank.
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <FighterName wallet={r.wallet} size="sm" />
            </span>
            <span className="num shrink-0 whitespace-nowrap text-meta">
              <span className="text-ink">{r.wins}W</span> <span className="text-dim">{r.losses}L</span>
            </span>
            <span className={cx("num min-w-14 shrink-0 text-right text-sm", tookSomething(r.taken) ? "text-up" : "text-dim")}>
              {usd(r.taken)}
            </span>
          </li>
        ))}
      </ol>
      <Link href="/leaderboard" className="label mt-2 self-start transition-colors hover:text-ink">
        Full leaderboard
        {ranked.length > rows ? <span className="num"> ({ranked.length})</span> : null}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </div>
  );
}
