"use client";

/* The numbers that say whether any of this is real, across the top.
 *
 * Every one is counted from chain state or from the roster, never typed in, so
 * a quiet week shows a quiet number rather than a claim. */

import { allDuels, STATUS_LIVE, STATUS_OPEN } from "@/lib/duel";
import { usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { tallyOf } from "@/lib/leaderboard";
import { AROUND_THE_CLOCK, ROSTER, STAKE_DECIMALS } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export function SiteTally() {
  const duels = useDuels("all", allDuels(), 20_000);
  const now = useNow();
  const all = duels.data ?? [];
  const { settled, fighters, taken } = tallyOf(all, STAKE_DECIMALS);

  const live = all.filter((d) => d.status === STATUS_LIVE).length;
  const open = all.filter((d) => d.status === STATUS_OPEN && (!now || d.expiresTs > now)).length;

  const cells: { n: string; label: string; tone?: string }[] = [
    { n: ROSTER.length.toLocaleString(), label: "tokenized stocks" },
    ...(AROUND_THE_CLOCK > 0 ? [{ n: String(AROUND_THE_CLOCK), label: "fight around the clock", tone: "text-up" }] : []),
    { n: String(live), label: "rounds live now", tone: live ? "text-up" : undefined },
    { n: String(open), label: "open challenges" },
    { n: String(settled), label: "fights settled" },
    { n: usd(taken), label: "taken off the loser" },
    { n: String(fighters), label: "fighters" },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4 lg:grid-cols-7">
      {cells.map((c) => (
        <div key={c.label} className="bg-panel px-3 py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-dim">{c.label}</dt>
          <dd className={`display text-2xl tabular-nums ${c.tone ?? "text-ink"}`}>{c.n}</dd>
        </div>
      ))}
    </dl>
  );
}
