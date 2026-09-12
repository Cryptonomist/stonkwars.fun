"use client";

/* Who is winning, in as few characters as it takes to say so.
 *
 * The same arithmetic as the leaderboard page, from the same settled fights on
 * chain. A handle appears where somebody has linked one; otherwise the wallet,
 * shortened. */

import Link from "next/link";

import { allDuels } from "@/lib/duel";
import { shortAddress, usd } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { rankFighters } from "@/lib/leaderboard";
import { STAKE_DECIMALS } from "@/lib/stocks";

export function TopFighters({ rows = 8 }: { rows?: number }) {
  const duels = useDuels("all", allDuels(), 20_000);
  const profiles = useProfiles();
  const ranked = rankFighters(duels.data ?? [], STAKE_DECIMALS).slice(0, rows);

  if (duels.isLoading) return <p className="py-4 text-sm text-dim">Tallying...</p>;
  if (!ranked.length) return <p className="py-4 text-sm text-dim">Nobody has won a fight yet.</p>;

  return (
    <ul className="flex flex-col">
      {ranked.map((r, i) => {
        const handle = profiles.data?.[r.wallet];
        return (
          <li key={r.wallet} className="flex items-baseline gap-2 border-t border-line py-1.5 first:border-t-0">
            <span className="display w-5 shrink-0 text-lg text-p1">{i + 1}</span>
            {handle ? (
              <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer" className="display truncate text-lg hover:text-p1">
                @{handle}
              </a>
            ) : (
              <span className="truncate font-mono text-xs text-dim">{shortAddress(r.wallet, 4)}</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-xs">
              <span className="text-up">{r.wins}W</span> <span className="text-down">{r.losses}L</span>
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-sm text-up">{usd(r.taken)}</span>
          </li>
        );
      })}
      <li className="border-t border-line pt-2">
        <Link href="/leaderboard" className="label hover:text-ink">
          Full leaderboard
        </Link>
      </li>
    </ul>
  );
}
