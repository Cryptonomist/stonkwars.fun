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
import { session, sessionFrom } from "./market";
import { BAR_SETTLE_SECS, exchangeBarFinal, firstBarEnd, sourceAt } from "./oracle";
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

/* HAS THE MARKET OPENED SINCE THE BOUNDARY, AND WHEN?
 *
 * A side whose market was shut at its boundary is priced by the first session
 * after it. That session's opening is a fixed moment, found from the boundary
 * alone, and the side is shut only while that moment is still ahead. This used
 * to ask whether the market was open NOW, so a fight whose price appeared on
 * Monday and was never cranked went back to "shut" at Monday's close: its
 * manual button vanished, the cron parked it, and the page said it was waiting
 * for a market that had already priced it. Unix seconds, or null if nothing
 * opens within ten days. */
function openingAfter(boundary: number, hours: "extended" | "regular"): number | null {
  const ms = sessionFrom(boundary * 1_000, hours);
  return ms === null ? null : Math.floor(ms / 1_000);
}

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
    const opening = openingAfter(boundary, "regular");
    // In session at the boundary: the print a moment after it, never shut.
    if (opening === boundary) return { at: boundary + PYTH_GRACE_SECS, why: "pyth" };
    // Shut at the boundary: the first print after the next opening bell, from
    // the moment that bell has rung, whether or not the session is still going.
    if (opening !== null && opening <= now) return { at: opening + PYTH_GRACE_SECS, why: "pyth" };
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
   * price is its first bar after it reopens: final a bar and the settle time
   * after the opening, and shut only until the opening. oracle.ts's
   * exchangeBarFinal is the same rule, and the oracle asks nothing before it. */
  if (us && session(boundary * 1_000) === "closed") {
    const opening = openingAfter(boundary, "extended");
    if (opening === null || opening > now) return { shut: name };
    return { at: exchangeBarFinal(boundary, market.market) ?? firstBarEnd(opening) + BAR_SETTLE_SECS, why: "minute-close" };
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

/* WHEN A PRICE BECAME READY, FLOORED AT THE BOUNDARY.
 *
 * A page deciding how late the settler is needs a time that stays put: one
 * that moved with the clock would never be three minutes ago, so a manual
 * button waiting for it would never come. readyAt's times are all fixed now,
 * including a side that waited for its market (dated to the first opening
 * after its boundary, not to "now"), so this is readyAt floored at the
 * boundary, exactly as the crank floors it. It used to bisect for the
 * reopening; that is no longer needed. */
export function readySince(
  d: ClockDuel,
  which: "start" | "settle",
  now: number,
  lookup: MarketLookup = quoteSymbolFor,
): Ready | Shut {
  const clock = readyAt(d, which, now, lookup);
  if ("shut" in clock) return clock;
  return { at: Math.max(clock.at, boundaryOf(d, which)), why: clock.why };
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
