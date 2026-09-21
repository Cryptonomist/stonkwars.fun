/* WHAT HAPPENED WHILE YOU WERE GONE.
 *
 * The watcher (lib/watcher.ts) tells a fighter what changes between two reads
 * of the chain, which only works while a tab is open. Its first read says
 * nothing, by design: a list seen for the first time has no "before". So a
 * fighter who took a 12 hour seat on Saturday night, closed the tab and came
 * back on Sunday was told nothing at all: not that they had won, not that
 * somebody had called them out. The site forgot them between visits.
 *
 * This is the missing "before": the moment this wallet was last here, kept in
 * the browser (no account, no server). Everything it reports is a fact on
 * chain with a time after that moment:
 *
 *   a fight of theirs whose bell rang           (endTs)
 *   a challenge naming them that was made       (createdTs)
 *   a challenge of theirs that somebody took    (acceptedTs)
 *
 * The ids are the watcher's own ("<address>:bell", ":called", ":taken"), so a
 * result told by a toast while the tab was open is not told again on return.
 * At most five, never older than a week, and nothing on a first visit, when
 * there is no "gone" to report on.
 *
 * Pure: no storage and no clock of its own, so tests can pin it. */

import { isDeadHeat, isDecided, loserTake, margin } from "./derive";
import { OUTCOME_CREATOR, STATUS_OPEN, type DuelView } from "./duel";
import { points, shares } from "./format";
import { tickerForMint, tokenSymbol } from "./stocks";
import type { WatchNotice } from "./watcher";

const EMPTY_KEY = "11111111111111111111111111111111";
export const DIGEST_MAX = 5;
export const DIGEST_WINDOW_SECS = 7 * 86_400;
/* The bell rings at endTs and the settler posts the result a minute or more
 * later. A fighter who left between the two saw no result, so a bell this
 * close before they left still counts as news; the told-ids stop a repeat. */
export const BELL_SLACK_SECS = 1_800;

export function sinceLastVisit(
  duels: DuelView[],
  me: string | null,
  lastSeen: number | null,
  now: number,
  told: ReadonlySet<string> = new Set(),
): WatchNotice[] {
  if (!me || !lastSeen || !now || lastSeen >= now) return [];
  const since = Math.max(lastSeen, now - DIGEST_WINDOW_SECS);
  const out: (WatchNotice & { at: number })[] = [];

  for (const d of duels) {
    const address = d.address.toBase58();
    const creator = d.creator.toBase58();
    const opponent = d.opponent.toBase58();
    const mine = creator === me || (opponent !== EMPTY_KEY && opponent === me);
    const t1 = tickerForMint(d.creatorMint) ?? "?";
    const t2 = tickerForMint(d.opponentMint) ?? "?";
    const href = `/f/${address}`;
    const say = (what: string, at: number, title: string, tone: WatchNotice["tone"] = "neutral") => {
      const id = `${address}:${what}`;
      if (!told.has(id)) out.push({ id, title, tone, href, at });
    };

    if (mine && d.endTs > since - BELL_SLACK_SECS && d.endTs <= now) {
      if (isDecided(d)) {
        const creatorWon = d.outcome === OUTCOME_CREATOR;
        const iWon = (creatorWon ? creator : opponent) === me;
        const [won, lost] = creatorWon ? [t1, t2] : [t2, t1];
        const take = loserTake(d);
        if (iWon) {
          const what = take ? ` and took ${shares(take.shares, take.decimals)} ${tokenSymbol(take.ticker)}` : "";
          say("bell", d.endTs, `While you were away: ${won} won${what}.`, "win");
        } else {
          const gap = margin(d);
          const by = gap === null ? "" : ` by ${points(gap)} points`;
          say("bell", d.endTs, `While you were away: cooked. ${won} beat ${lost}${by}. Run it back?`, "cooked");
        }
        continue;
      }
      if (isDeadHeat(d)) {
        say("heat", d.endTs, `While you were away: ${t1} vs ${t2} was a dead heat. Both stakes home.`);
        continue;
      }
    }

    if (d.status === STATUS_OPEN && d.invitee.toBase58() === me && creator !== me && d.createdTs > since && d.expiresTs > now) {
      say("called", d.createdTs, `You were called out while you were away: ${t1} vs ${t2}.`);
      continue;
    }

    if (creator === me && opponent !== EMPTY_KEY && d.acceptedTs > since && !isDecided(d) && !isDeadHeat(d)) {
      say("taken", d.acceptedTs, `While you were away, your ${t1} challenge was taken.`);
    }
  }

  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, DIGEST_MAX)
    .map((n) => ({ id: n.id, title: n.title, tone: n.tone, href: n.href }));
}
