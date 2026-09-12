/* Records, worked out from settled fights and nothing else.
 *
 * "Taken" is the loser's stake valued at its end price, which is what the win
 * was actually worth at the moment it landed. No React here, so the landing
 * board and the leaderboard page can agree without either importing the other.
 */

import { OUTCOME_CREATOR, STATUS_SETTLED, type DuelView } from "./duel";
import { pythToNumber } from "./format";

export type Record_ = {
  wallet: string;
  wins: number;
  losses: number;
  /** Dollars taken off other people, at the price that settled it. */
  taken: number;
  streak: number;
  best: number;
};

export function rankFighters(duels: DuelView[], decimals: number): Record_[] {
  const table = new Map<string, Record_>();
  const row = (wallet: string) => {
    let r = table.get(wallet);
    if (!r) {
      r = { wallet, wins: 0, losses: 0, taken: 0, streak: 0, best: 0 };
      table.set(wallet, r);
    }
    return r;
  };

  // Oldest first, so a streak is counted the way it happened.
  const settled = duels.filter((d) => d.status === STATUS_SETTLED).sort((a, b) => a.endTs - b.endTs);
  for (const d of settled) {
    const creatorWon = d.outcome === OUTCOME_CREATOR;
    const winner = creatorWon ? d.creator.toBase58() : d.opponent.toBase58();
    const loser = creatorWon ? d.opponent.toBase58() : d.creator.toBase58();
    const amount = creatorWon ? d.opponentAmount : d.creatorAmount;
    const end = creatorWon ? d.opponentEnd : d.creatorEnd;

    const w = row(winner);
    w.wins++;
    w.taken += (Number(amount) / 10 ** decimals) * pythToNumber(end.price, end.expo);
    w.streak++;
    w.best = Math.max(w.best, w.streak);

    const l = row(loser);
    l.losses++;
    l.streak = 0;
  }

  return [...table.values()].sort((a, b) => b.wins - a.wins || b.taken - a.taken);
}

/** Everything the board says about itself, in one pass. */
export function tallyOf(duels: DuelView[], decimals: number) {
  const ranked = rankFighters(duels, decimals);
  return {
    ranked,
    settled: duels.filter((d) => d.status === STATUS_SETTLED).length,
    fighters: ranked.length,
    taken: ranked.reduce((sum, r) => sum + r.taken, 0),
  };
}
