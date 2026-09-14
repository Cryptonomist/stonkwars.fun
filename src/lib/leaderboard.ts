/* Records, worked out from settled fights and nothing else.
 *
 * "Taken" is the loser's stake valued at its end price, which is what the win
 * was actually worth at the moment it landed. No React here, so the landing
 * board and the leaderboard page can agree without either importing the other.
 * The arithmetic itself lives in lib/derive, which a profile reads too, so a
 * wallet's record is the same number on every page that shows it.
 *
 * RANKED BY MONEY. A board sorted by wins put a fighter who had taken $5.49 at
 * number two above one who had taken far more in fewer fights, and "who cooks"
 * is a question about what was taken. Wins break a tie in money, and fewer
 * losses break a tie in wins.
 */

import { STATUS_SETTLED, type DuelView } from "./duel";
import { recordsByWallet, winRate, type FighterRecord } from "./derive";

export type Record_ = FighterRecord & {
  wallet: string;
  /** Wins over fights with a result, 0 to 1. */
  winRate: number;
};

export function rankFighters(duels: DuelView[], decimals: number): Record_[] {
  const ranked: Record_[] = [];
  for (const [wallet, r] of recordsByWallet(duels, decimals)) ranked.push({ ...r, wallet, winRate: winRate(r) });
  return ranked.sort(
    (a, b) =>
      b.taken - a.taken ||
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.lastTs - a.lastTs ||
      a.wallet.localeCompare(b.wallet),
  );
}

/** Everything the board says about itself, in one pass. */
export function tallyOf(duels: DuelView[], decimals: number) {
  const ranked = rankFighters(duels, decimals);
  return {
    ranked,
    settled: duels.filter((d) => d.status === STATUS_SETTLED).length,
    /** Wallets with a result on chain. */
    fighters: ranked.length,
    taken: ranked.reduce((sum, r) => sum + r.taken, 0),
  };
}
