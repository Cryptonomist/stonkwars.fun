/* The fight page's honest clock: what a fight is waiting for, how long, and
 * when (only when) to hand the job to whoever is looking.
 *
 * The page used to say "locking the starting prices" from the accept, and
 * offered "Lock the start prices yourself" twenty-odd seconds in, which for a
 * minute-bar price was before the price could exist: a wallet popup that
 * could only fail. This counts down to the moment the price clock says the
 * price exists, says what the round is waiting on, and offers the manual
 * button only MANUAL_FALLBACK_SECS after that, by which time the page nudge
 * and the cron have both had several goes and something really is late.
 *
 *   ACCEPTED  before readyAt + 2      Round starts in 41s, when this minute's price closes
 *             readyAt + 2 to + 180    Locking the start prices
 *             from + 180              The settler is late. Anyone can lock the start prices.  [manual start]
 *   LIVE      before the bell         Round live
 *             bell to readyAt + 2     Bell rang. Result in 58s, when the minute after the bell is final
 *             readyAt + 2 to + 180    Settling
 *             from + 180              The settler is late. Anyone can settle it.  [manual settle]
 *
 * The countdown runs to readyAt + 2 because a crank sent at readyAt takes a
 * second or two to land. " · retrying" follows the waiting lines after a nudge
 * has failed. A side whose market is shut keeps the page's existing wording.
 * A fight the price clock says can never be priced gets no countdown and no
 * button, only that, and when the program lets its stakes go home.
 *
 * IT ADVISES, IT NEVER DECIDES, like the price clock under it. Pure: all times
 * are unix seconds, `now` is the page's clock, and the nudge's measured skew
 * turns it into the server's. */

import { V2_WINDOW_MINUTES } from "./composite";
import { STATUS_ACCEPTED, STATUS_LIVE, type DuelView } from "./duel";
import { etDay } from "./format";
import {
  MANUAL_FALLBACK_SECS,
  readyAt,
  readySince,
  type ClockDuel,
  type MarketLookup,
  type Never,
  type ReadyWhy,
} from "./priceClock";

export type RoundClockDuel = ClockDuel & Pick<DuelView, "status">;

/** What the page knows about its nudge (useNudgeStatus), if anything. */
export type ClockNudge = { state?: string; failures?: number; skew?: number };

export type ManualCrank = { which: "start" | "settle"; label: string; explain: string };

export type RoundClock = {
  /** The status line; empty when the clock has nothing to say. */
  line: string;
  /** Whole seconds to count down, when the line is a countdown or the bell. */
  secondsLeft: number | null;
  /** The do-it-yourself button, once the settler is late. */
  manual: ManualCrank | null;
};

/** Seconds a crank takes to land after it is sent at readyAt. */
export const LANDING_SECS = 2;

const EXPLAIN_SIGNS = "Your wallet signs one transaction (three if a side is priced by Pyth).";
const EXPLAIN_SAME = "The prices and the result are the same whoever posts them.";

export const MANUAL_START: ManualCrank = {
  which: "start",
  label: "Lock the start prices yourself",
  explain: `${EXPLAIN_SIGNS} It posts the market's prices for this moment and starts the round. Network fee about 0.00002 SOL. ${EXPLAIN_SAME}`,
};

export const MANUAL_SETTLE: ManualCrank = {
  which: "settle",
  label: "Settle it yourself",
  explain:
    `${EXPLAIN_SIGNS} It posts the market's prices for the bell and settles the round. Network fee about 0.00002 SOL, ` +
    `plus about 0.002 SOL of account rent for each player who has no account for a stock they receive. ${EXPLAIN_SAME}`,
};

const NOTHING: RoundClock = { line: "", secondsLeft: null, manual: null };

const inSecs = (n: number) => (n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`);

function waitingOn(why: ReadyWhy, n: number, which: "start" | "settle"): string {
  if (why === "pyth") return which === "start" ? "in a few seconds, at Pyth's first price" : "in a few seconds, at Pyth's first price after the bell";
  if (why === "pool-window") return `in ${inSecs(n)}, when the pool's last minutes are in`;
  if (why === "composite-window") {
    return which === "start"
      ? `in ${inSecs(n)}, when the 24/7 markets' first ${V2_WINDOW_MINUTES} minutes of the round are final`
      : `in ${inSecs(n)}, when the 24/7 markets' ${V2_WINDOW_MINUTES} minutes from the bell are final`;
  }
  return which === "start" ? `in ${inSecs(n)}, when this minute's price closes` : `in ${inSecs(n)}, when the minute after the bell is final`;
}

/* THE STOCKS A FIGHT IS WAITING ON A SHUT MARKET FOR.
 *
 * The boards and the fight page say "waiting for the open", and hold back the
 * manual buttons, while a side's market is shut. That is the price clock's
 * "shut", for the boundary the fight is at: its start once it is accepted,
 * its bell once that has rung. It used to ask whether each stock priced NOW,
 * so a fight whose end price printed at the bell and was not yet settled read
 * "waiting for the open" as soon as its market closed, and lost its button
 * for a price that already existed. A Pyth side is never shut: it prices at
 * once or never (neverSides). Empty when nothing waits, or the fight is at no
 * boundary. */
export function shutSides(d: RoundClockDuel, now: number, lookup?: MarketLookup): string[] {
  if (!now) return [];
  const which = d.status === STATUS_ACCEPTED ? "start" : d.status === STATUS_LIVE && now >= d.endTs ? "settle" : null;
  if (!which) return [];
  const clock = readyAt(d, which, now, lookup);
  return "shut" in clock ? clock.shut : [];
}

/* A FIGHT NOTHING WILL EVER PRICE, AT THE BOUNDARY IT IS AT.
 *
 * The price clock's "never", asked the way shutSides asks for "shut": the
 * start once a fight is accepted, the bell once it has rung. 4yf7 is the case:
 * TSLA by Pyth, taken at 10:21 PM on a Friday, when Pyth prints nothing until
 * Sunday night. The page must neither count down to a price nor offer to post
 * one, and must say when the stakes can go home. Null when every side can be
 * priced, or the fight is at no boundary. */
export function neverSides(d: RoundClockDuel, now: number, lookup?: MarketLookup): Never | null {
  if (!now) return null;
  const which = d.status === STATUS_ACCEPTED ? "start" : d.status === STATUS_LIVE && now >= d.endTs ? "settle" : null;
  if (!which) return null;
  const clock = readyAt(d, which, now, lookup);
  return "never" in clock ? clock : null;
}

/** "Pyth has no TSLA price for the moment it was taken, and never will." */
export function neverWords(n: Never, which: "start" | "settle"): string {
  const moment = which === "start" ? "the moment it was taken" : "its bell";
  return `Pyth has no ${n.never.join(" or ")} price for ${moment}, and never will.`;
}

/** "Both stakes can be sent home from Fri 18 Sep, 10:22 PM ET.", or that they
 *  can now. The minute is rounded up: 4yf7's refund opens at 10:21:49, and
 *  "from 10:21" would send somebody to a button the program still refuses. */
export function refundWords(n: Never, now: number): string {
  if (now >= n.refundAt) return "Anyone can send both stakes home.";
  return `Both stakes can be sent home from ${etDay(Math.ceil(n.refundAt / 60) * 60)}.`;
}

export function roundClock(
  d: RoundClockDuel,
  now: number,
  nudge?: ClockNudge | null,
  lookup?: MarketLookup,
): RoundClock {
  // useNow is 0 on the server render: say nothing rather than something wrong.
  if (!now) return NOTHING;
  const t = now + (nudge?.skew ?? 0);
  const retrying = nudge?.state === "failed" || (nudge?.failures ?? 0) > 0 ? " · retrying" : "";

  let which: "start" | "settle";
  if (d.status === STATUS_ACCEPTED) which = "start";
  else if (d.status === STATUS_LIVE) {
    if (t < d.endTs) return { line: "Round live", secondsLeft: Math.ceil(d.endTs - t), manual: null };
    which = "settle";
  } else return NOTHING;

  const clock = readySince(d, which, Math.floor(t), lookup);
  if ("never" in clock) {
    return {
      line: `${which === "start" ? "Can never start" : "Can never settle"} · ${neverWords(clock, which)} ${refundWords(clock, t)}`,
      secondsLeft: null,
      manual: null,
    };
  }
  if ("shut" in clock) {
    return {
      line:
        which === "start"
          ? "Fight on · waiting for the market that prices it to open"
          : "Bell rung · waiting for the market that prices it to open",
      secondsLeft: null,
      manual: null,
    };
  }

  const left = Math.ceil(clock.at + LANDING_SECS - t);
  if (left > 0) {
    const wait = waitingOn(clock.why, left, which);
    return {
      line: which === "start" ? `Round starts ${wait}` : `Bell rang. Result ${wait}`,
      secondsLeft: left,
      manual: null,
    };
  }
  if (t < clock.at + MANUAL_FALLBACK_SECS) {
    return { line: (which === "start" ? "Locking the start prices" : "Settling") + retrying, secondsLeft: null, manual: null };
  }
  return which === "start"
    ? { line: "The settler is late. Anyone can lock the start prices.", secondsLeft: null, manual: MANUAL_START }
    : { line: "The settler is late. Anyone can settle it.", secondsLeft: null, manual: MANUAL_SETTLE };
}
