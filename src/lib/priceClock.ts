/* The price clock: when a fight's next price can exist.
 *
 * A crank that tries before a price exists wastes a pass, and a page that asks
 * somebody to sign before it exists asks them for nothing. This says, for a
 * duel and one of its boundaries, the earliest moment every side's price can
 * be final, or that some side's market is shut and nothing will price it
 * until it opens.
 *
 * IT ADVISES, IT NEVER DECIDES. Every number here is an earliest time: the
 * oracle may still answer later (a minute with no trade pushes the price to
 * the next bar), and Hermes may still be indexing. What gets signed is decided
 * by quoteAt, which refuses before its bar is final, and what gets accepted is
 * decided by the program, which demands publish_time >= boundary. Trying at
 * the time this gives and being told "not yet" costs a retry, never a price.
 *
 * Pure, and free of Node: the fight page runs it for its countdown, and the
 * server runs it to decide when to crank. */

import { boundaryOf } from "./crankTx";
import { SOURCE_PYTH, STATUS_ACCEPTED, STATUS_LIVE, STATUS_VOID, type DuelView } from "./duel";
import { session } from "./market";
import { BAR_SETTLE_SECS, firstBarEnd, sourceAt } from "./oracle";
import { byFeed, quoteSymbolFor } from "./stocks";

/* The end of the first one-minute bar that ends after a boundary, whose close
 * is a bar-priced side's price. It lives in oracle.ts beside the rule it
 * describes, so the gate that refuses to sign and the clock that says when to
 * ask cannot drift apart, and so the oracle does not import the roster. */
export { firstBarEnd };

/** Seconds after a boundary before Pyth has printed past it and Hermes has it. */
export const PYTH_GRACE_SECS = 3;

/** How long past the price's time before the page offers the manual button:
 *  long enough for the nudge and the cron to have had several goes. */
export const MANUAL_FALLBACK_SECS = 180;

export type ReadyWhy = "minute-close" | "pool-window" | "pyth";
export type Ready = { at: number; why: ReadyWhy };
export type Shut = { shut: string[] };

/** Where a feed's stock trades, as the roster knows it. quoteSymbolFor fits,
 *  and so does crank.ts's QuoteSymbol; tests pass their own. */
export type MarketLookup = (
  feed: string,
) => { symbol?: string; market?: string; pool?: string; perp?: string } | undefined;

export type ClockDuel = Pick<
  DuelView,
  "acceptedTs" | "endTs" | "creatorFeed" | "opponentFeed" | "creatorSource" | "opponentSource"
>;

const isOpen = (unixSecs: number) => session(unixSecs * 1_000) !== "closed";

function sideReady(
  feed: string,
  source: number,
  boundary: number,
  now: number,
  lookup: MarketLookup,
): Ready | { shut: string } {
  const market = lookup(feed);
  const name = byFeed(feed)?.ticker ?? market?.symbol ?? feed.replace(/^0x/, "").slice(0, 8);
  const us = (market?.market ?? "US") === "US";

  if (source === SOURCE_PYTH) {
    /* A feed off the roster is not a stock: on a local ring or in the test
     * fights it is crypto, which Pyth prints around the clock. Session hours
     * mean nothing for it, and neither do they for a listing outside the US,
     * whose sessions market.ts does not model. */
    if (!market || !us) return { at: boundary + PYTH_GRACE_SECS, why: "pyth" };

    /* A US equity feed prints in the regular session only, 9:30 to 4 New York.
     * The roster's Pyth stocks are the Equity.US.<TICKER>/USD feeds, and Pyth's
     * market hours page lists pre-market, after-hours and overnight as separate
     * feeds of their own (docs.pyth.network/price-feeds/market-hours). So a
     * boundary at 7pm on a Friday has no print after it until Monday's open,
     * and calling that side due all weekend and all of Monday's pre-market
     * would spend a Hermes call and a crank slot on it every pass, which is
     * what 4yf7 did. A crypto feed off the roster is handled above and never
     * waits. */
    const regular = (unixSecs: number) => session(unixSecs * 1_000) === "open";
    if (regular(boundary)) return { at: boundary + PYTH_GRACE_SECS, why: "pyth" };
    // The market was shut at the boundary, so the price is its first print
    // after it reopens: due whenever the session is running again.
    if (regular(now)) return { at: now, why: "pyth" };
    return { shut: name };
  }

  /* A signed side with no roster entry cannot be quoted at all, and the crank
   * says so in words. Parking it would hide that, so it is due like any bar. */
  if (!market) return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };

  const src = sourceAt(boundary, market);
  // The pool's window is the hour before the boundary, complete once it passes.
  if (src === "pool") return { at: boundary + BAR_SETTLE_SECS, why: "pool-window" };
  if (src === "perp") return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };

  /* The exchange. Shut at the boundary with nothing else to read means the
   * price is its first bar after it reopens, so the side is due once the
   * session is running again and shut until then. */
  if (us && session(boundary * 1_000) === "closed") {
    return isOpen(now) ? { at: now, why: "minute-close" } : { shut: name };
  }
  return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };
}

/** The earliest unix second both sides' prices for a duel's start or settle
 *  can be final, and what that waits on; or the tickers whose market is shut. */
export function readyAt(
  d: ClockDuel,
  which: "start" | "settle",
  now: number,
  lookup: MarketLookup = quoteSymbolFor,
): Ready | Shut {
  const boundary = boundaryOf(d, which);
  const sides = [
    sideReady(d.creatorFeed, d.creatorSource, boundary, now, lookup),
    sideReady(d.opponentFeed, d.opponentSource, boundary, now, lookup),
  ];
  const shut = [...new Set(sides.flatMap((s) => ("shut" in s ? [s.shut] : [])))];
  if (shut.length) return { shut };
  // The later side is the one the fight waits on; a tie keeps the creator's.
  return (sides as Ready[]).reduce((a, b) => (b.at > a.at ? b : a));
}

/* WHEN A PRICE BECAME READY, NOT ONLY WHETHER IT IS.
 *
 * A side whose market was shut at its boundary is due from the moment that
 * market reopens, and readyAt says so by answering `now`, which moves with the
 * clock. That is right for a crank deciding whether to try, and wrong for a
 * page deciding how late the settler is: a time that is always "now" is never
 * three minutes ago, so a manual button waiting for readyAt + 180 would never
 * come, and a page nudge told to give up 15 minutes after readyAt never would.
 *
 * So this dates such a side to the reopening, found by bisecting between the
 * boundary (where the side is shut, or not yet due, by construction) and now.
 * Every other answer is readyAt's own, floored at the boundary as the crank
 * floors it. If the market has opened and shut more than once since the
 * boundary the bisection may land on a later reopening than the first; that
 * only makes the page more patient, and a fight that old has been cranked by
 * the cron long before. */
export function readySince(
  d: ClockDuel,
  which: "start" | "settle",
  now: number,
  lookup: MarketLookup = quoteSymbolFor,
): Ready | Shut {
  const boundary = boundaryOf(d, which);
  const at = (t: number): number | null => {
    const c = readyAt(d, which, t, lookup);
    return "shut" in c ? null : Math.max(c.at, boundary);
  };
  const clock = readyAt(d, which, now, lookup);
  if ("shut" in clock) return clock;
  const ready = { at: Math.max(clock.at, boundary), why: clock.why };
  if (ready.at !== now || now <= boundary) return ready;
  // A fixed time that happens to fall on this second was the same a second ago.
  if (at(now - 1) === ready.at) return ready;

  const due = (t: number) => {
    const a = at(t);
    return a !== null && a <= t;
  };
  let lo = boundary; // not due
  let hi = now; // due
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (due(mid)) hi = mid;
    else lo = mid;
  }
  return { at: hi, why: clock.why };
}

export type ClockJob = { kind: "start" | "settle" | "refund"; boundary: number };

/** What a duel needs doing now, if anything. A start is a job from the moment
 *  it is accepted (readyAt says when to try it); a settle once the bell has
 *  rung. A refund waits on no price, so its boundary is simply `now`. */
export function jobFor(d: Pick<DuelView, "status" | "acceptedTs" | "endTs">, now: number): ClockJob | null {
  if (d.status === STATUS_ACCEPTED) return { kind: "start", boundary: boundaryOf(d, "start") };
  if (d.status === STATUS_LIVE && now >= d.endTs) return { kind: "settle", boundary: d.endTs };
  if (d.status === STATUS_VOID) return { kind: "refund", boundary: now };
  return null;
}
