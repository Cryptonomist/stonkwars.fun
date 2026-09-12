"use client";

/* Who cooks, and who gets cooked. Worked out from settled fights on chain:
 * a record is wins and losses, and "taken" is the value of the loser's stake
 * at the end price, which is what the win was actually worth when it landed. */

import { ConnectX } from "@/components/ConnectX";
import { allDuels, STATUS_SETTLED } from "@/lib/duel";
import { shortAddress, usd } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { rankFighters } from "@/lib/leaderboard";
import { STAKE_DECIMALS } from "@/lib/stocks";

export function Leaderboard() {
  const duels = useDuels("all", allDuels(), 20_000);
  const profiles = useProfiles();
  const ranked = rankFighters(duels.data ?? [], STAKE_DECIMALS).slice(0, 50);
  const settled = (duels.data ?? []).filter((d) => d.status === STATUS_SETTLED).length;

  return (
    <div className="py-10">
      <p className="label">Settled on chain</p>
      <h1 className="display mt-2 text-6xl sm:text-7xl">Leaderboard</h1>
      <p className="mt-3 text-dim">
        {settled} {settled === 1 ? "fight" : "fights"} settled so far.
      </p>

      <ConnectX />

      <div className="mt-8 overflow-x-auto">
        {duels.isLoading ? (
          <p className="text-dim">Tallying...</p>
        ) : ranked.length === 0 ? (
          <p className="text-dim">No fights settled yet. The first win puts you at the top.</p>
        ) : (
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="label">
                <th className="py-2 pr-4 font-normal">#</th>
                <th className="py-2 pr-4 font-normal">Fighter</th>
                <th className="py-2 pr-4 font-normal">Record</th>
                <th className="py-2 pr-4 font-normal">Best streak</th>
                <th className="py-2 font-normal text-right">Taken</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.wallet} className="border-t border-line">
                  <td className="display py-3 pr-4 text-2xl text-p1">{i + 1}</td>
                  <td className="py-3 pr-4">
                    {profiles.data?.[r.wallet] ? (
                      <a
                        href={`https://x.com/${profiles.data[r.wallet]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="display text-xl hover:text-p1"
                      >
                        @{profiles.data[r.wallet]}
                      </a>
                    ) : (
                      <span className="font-mono">{shortAddress(r.wallet, 5)}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    <span className="text-up">{r.wins}W</span> <span className="text-down">{r.losses}L</span>
                  </td>
                  <td className="py-3 pr-4 font-mono">{r.best}</td>
                  <td className="py-3 text-right font-mono text-up">{usd(r.taken)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
