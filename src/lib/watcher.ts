/* WHAT CHANGED BETWEEN TWO READS OF THE DUEL LIST, IN WORDS FOR A TOAST.
 *
 * The app already polls every duel account. Comparing one poll with the next
 * is enough to tell a fighter their challenge was taken, their round went live
 * or the bell rang, with no push service and nothing invented: every notice is
 * a status the program wrote, between two reads of the chain.
 *
 * Only fights the viewer is in, or has opened a page for, make a sound. The
 * first read makes none at all, because a list seen for the first time has no
 * "before" and every fight in it would look new.
 *
 * Pure: no React, no storage, no fetching, so a test can hand it two lists. */

import {
  OUTCOME_CREATOR,
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "./duel";
import { loserTake, margin } from "./derive";
import { points, shares } from "./format";
import { tickerForMint, tokenSymbol } from "./stocks";

export type WatchTone = "neutral" | "win" | "cooked";

export type WatchNotice = {
  /** address + ":" + what happened, so the same change is never told twice. */
  id: string;
  title: string;
  tone: WatchTone;
  href: string;
};

const EMPTY_KEY = "11111111111111111111111111111111";

/* A status the program can only move forward through. Anything past OPEN
 * means somebody took the fight, even when the poll that would have seen
 * ACCEPTED fell between two reads. */
const TAKEN_OR_LATER = new Set([STATUS_ACCEPTED, STATUS_LIVE, STATUS_SETTLED, STATUS_REFUNDED, STATUS_VOID]);

export function diffFights(
  prev: DuelView[],
  next: DuelView[],
  me: string | null,
  watched: string[],
  now: number,
): WatchNotice[] {
  if (prev.length === 0) return [];
  const before = new Map(prev.map((d) => [d.address.toBase58(), d]));
  const following = new Set(watched);
  const out: WatchNotice[] = [];

  for (const d of next) {
    const address = d.address.toBase58();
    const href = `/f/${address}`;
    const creator = d.creator.toBase58();
    const opponent = d.opponent.toBase58();
    const t1 = tickerForMint(d.creatorMint) ?? "?";
    const t2 = tickerForMint(d.opponentMint) ?? "?";
    const pair = `${t1} vs ${t2}`;
    const mine = !!me && (creator === me || (opponent !== EMPTY_KEY && opponent === me));
    const say = (what: string, title: string, tone: WatchTone = "neutral") =>
      out.push({ id: `${address}:${what}`, title, tone, href });

    const was = before.get(address);

    /* A challenge that was not there last time, and names this wallet. */
    if (!was) {
      if (
        me &&
        d.status === STATUS_OPEN &&
        d.invitee.toBase58() === me &&
        creator !== me &&
        (now <= 0 || d.expiresTs > now)
      ) {
        say("called", `You were called out: ${pair}.`);
      }
      continue;
    }

    if (was.status === d.status) continue;
    if (!mine && !following.has(address)) continue;

    /* Taken. Told to the one who made the challenge; whoever took it knows. */
    if (was.status === STATUS_OPEN && TAKEN_OR_LATER.has(d.status) && me === creator && opponent !== EMPTY_KEY) {
      say("taken", `Your ${t1} challenge was taken.`);
    }

    if (d.status === STATUS_LIVE) {
      say("live", `Round live: ${pair}.`);
      continue;
    }

    if (d.status === STATUS_SETTLED) {
      const take = loserTake(d);
      const creatorWon = d.outcome === OUTCOME_CREATOR;
      const winner = creatorWon ? creator : opponent;
      const [won, lost] = creatorWon ? [t1, t2] : [t2, t1];
      if (take && me && me === winner) {
        say("bell", `Bell. You took ${shares(take.shares, take.decimals)} ${tokenSymbol(take.ticker)}.`, "win");
      } else if (take && mine) {
        const gap = margin(d);
        const by = gap === null ? "" : ` by ${points(gap)} percentage points`;
        say("bell", `Cooked. ${won} beat ${lost}${by}. Run it back?`, "cooked");
      } else {
        say("bell", `${pair} is final.`);
      }
      continue;
    }

    if (d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE) {
      say("heat", "Dead heat. Both stakes home.");
      continue;
    }

    if (d.status === STATUS_VOID || d.status === STATUS_REFUNDED) {
      say("void", `${pair} voided. Both stakes home.`);
    }
  }
  return out;
}
