/* When an open fight page asks the server to crank its fight.
 *
 * The page nudge (app/api/nudge/route.ts) cranks a fight the moment its price
 * exists, paid by a server key, with nobody signing anything. This decides when
 * a page asks: first just before the price can exist, then whenever the server
 * says to, backing off when something is failing, and not at all once the
 * fight has moved, its market is shut, or it has been trying for a quarter of
 * an hour.
 *
 * IT ONLY SCHEDULES. The server decides whether anything is due and never signs
 * a price before its bar is final, so asking early costs one cheap "not yet"
 * and asking late costs nothing but time. The hook in useSettlerNudge.ts and
 * the end-to-end script share this function, so the script tests the page's
 * real behaviour rather than a copy of it.
 *
 * Pure, and free of Node and React. All times are unix seconds on the SERVER's
 * clock: the page adds the skew it measured from each answer's serverTime. */

import { STATUS_ACCEPTED, STATUS_LIVE, STATUS_VOID, type DuelView } from "./duel";
import { readySince, type ClockDuel, type MarketLookup } from "./priceClock";

/** What the server said about a fight. */
export type NudgeState =
  /** Nothing to do: not accepted, before the bell, or already finished. */
  | "nothing-due"
  /** A side's market is shut; no price source was asked. */
  | "waiting-for-market"
  /** A side can never be priced (a Pyth boundary in Pyth's dark hours); only
   *  the stall refund, at `refundAt`, ends the fight. */
  | "never-priced"
  /** Due, but its price cannot exist yet (or the oracle said not yet). */
  | "not-yet"
  /** This call sent the crank; `signature` is the fight transaction. */
  | "sent"
  /** Somebody else got there; nothing was paid. */
  | "done"
  /** Tried and failed, or refused for now; `retryAt` says when to ask again. */
  | "failed"
  /** Not a fight account. Remembered by the server for a minute. */
  | "not-found"
  /** The nudge is switched off on this deployment (NUDGE_DISABLED). */
  | "disabled"
  /** The request itself was refused: wrong origin, or not an address. */
  | "refused";

export type NudgeAnswer = {
  state: NudgeState;
  /** The server's clock when it answered, unix seconds with a fraction. */
  serverTime: number;
  /** When the price can first exist, when the server knows it. */
  readyAt?: number;
  /** The earliest worth asking again. */
  retryAt?: number;
  signature?: string;
  /** For waiting-for-market: the tickers whose market is shut. For
   *  never-priced: the tickers nothing will price. */
  tickers?: string[];
  /** For never-priced: when the program lets the stakes go home. */
  refundAt?: number;
  detail?: string;
};

/** Answers after which a page stops asking for good. A fight that can never
 *  be priced stays that way whatever the clock does. */
const FINAL: ReadonlySet<NudgeState> = new Set(["not-found", "disabled", "refused", "never-priced"]);

export type NudgeJob =
  | {
      kind: "start" | "settle" | "refund";
      /** The earliest second the price can exist (readySince). */
      readyAt: number;
      /** When this page began watching; see GIVE_UP_SECS. */
      since?: number;
    }
  | { kind: "start" | "settle"; shut: string[] }
  | { kind: "start" | "settle"; never: string[]; refundAt: number };

/** The first ask, this long before the price can exist: the server holds the
 *  request until readyAt, so the crank goes out on the second. */
export const FIRST_LEAD_SECS = 2;
/** After a send (or finding it done), look again this much later. */
export const AFTER_SENT_SECS = 10;
/** Backoff after 1, 2, 3 and 4 or more failures in a row. */
export const BACKOFF_SECS = [5, 10, 20, 30] as const;
/** After a not-yet with no retryAt, or a nothing-due the page disagrees with. */
export const NOT_YET_SECS = 5;
export const NOTHING_DUE_SECS = 10;
/** The server thinks the market is shut and the page does not: its clock is
 *  the one that decides, so check back slowly. */
export const WAITING_SECS = 30;
/** Never two asks closer than this. */
export const MIN_GAP_SECS = 1;
/* A PAGE GIVES UP AFTER A QUARTER OF AN HOUR.
 *
 * Something that has failed for fifteen minutes will not be fixed by a page
 * asking again, and by then the cron has had fifteen goes and the manual
 * button has been on the page for twelve minutes. The plan counts this from
 * readyAt; it is counted from whichever is later, readyAt or when this page
 * started watching, so somebody who opens a stuck fight an hour late still
 * gets their own fifteen minutes of nudges instead of none at all. */
export const GIVE_UP_SECS = 900;

export const backoffSecs = (failures: number) =>
  BACKOFF_SECS[Math.min(Math.max(failures, 1), BACKOFF_SECS.length) - 1];

/* What a fight page should be nudging for, from the duel it already polls.
 *
 * Unlike priceClock's jobFor, a LIVE fight is a settle job before its bell:
 * the page is open and ticking, so it should know the settle's readyAt now
 * rather than find out at the bell. readySince, not readyAt, so a side that
 * became due when its market reopened has a fixed time to give up from. A
 * refund waits on no price; it is dated to when the page first saw it. */
export function nudgeJobFor(
  d: ClockDuel & Pick<DuelView, "status">,
  now: number,
  opts: { since?: number; lookup?: MarketLookup } = {},
): NudgeJob | null {
  const since = opts.since ?? now;
  if (d.status === STATUS_VOID) return { kind: "refund", readyAt: since, since };
  const which = d.status === STATUS_ACCEPTED ? "start" : d.status === STATUS_LIVE ? "settle" : null;
  if (!which) return null;
  const clock = readySince(d, which, now, opts.lookup);
  if ("never" in clock) return { kind: which, never: clock.never, refundAt: clock.refundAt };
  if ("shut" in clock) return { kind: which, shut: clock.shut };
  return { kind: which, readyAt: clock.at, since };
}

/** When to ask the server next, in server-clock unix seconds, or null to stop.
 *  A time in the past means now. `failures` counts failed answers in a row,
 *  including requests that never got an answer. */
export function nextNudgeAt(
  job: NudgeJob | null,
  last: NudgeAnswer | null,
  failures: number,
  now: number,
): number | null {
  if (!job || !("readyAt" in job)) return null;
  if (last && FINAL.has(last.state)) return null;
  const stopAt = Math.max(job.readyAt, job.since ?? job.readyAt) + GIVE_UP_SECS;
  if (now >= stopAt) return null;

  let at: number;
  if (!last) {
    at = job.readyAt - FIRST_LEAD_SECS;
  } else {
    switch (last.state) {
      case "failed":
        at = Math.max(last.retryAt ?? 0, last.serverTime + backoffSecs(failures));
        break;
      case "sent":
      case "done":
        at = last.serverTime + AFTER_SENT_SECS;
        break;
      case "not-yet":
        at = last.retryAt ?? last.serverTime + NOT_YET_SECS;
        break;
      case "waiting-for-market":
        at = last.serverTime + WAITING_SECS;
        break;
      default:
        at = last.serverTime + NOTHING_DUE_SECS;
    }
    at = Math.max(at, last.serverTime + MIN_GAP_SECS);
  }
  if (at >= stopAt) return null;
  return Math.max(at, now);
}
