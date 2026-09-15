/* The price clock: when a fight's next price can exist.
 *
 * A crank that tries before a price exists wastes a pass, and a page that asks
 * somebody to sign before it exists asks them for nothing. This says, for a
 * duel and one of its boundaries, the earliest moment every side's price can
 * be final, or that some side's market is shut and nothing will price it
 * until it opens, or that some side's price can never exist at all and the
 * fight can only be refunded.
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
import { SOURCE_PYTH, STALL_REFUND_SECS, STATUS_ACCEPTED, STATUS_LIVE, STATUS_VOID, type DuelView } from "./duel";
import { compositePublishTime } from "./composite";
import { abroadOpeningAfter, openingAfter, pythPricesAt, session } from "./market";
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

export type ReadyWhy = "minute-close" | "pool-window" | "composite-window" | "pyth";
export type Ready = { at: number; why: ReadyWhy };
export type Shut = { shut: string[] };
/* A FIGHT NOTHING WILL EVER PRICE.
 *
 * A Pyth side whose boundary fell where Pyth is dark (market.ts, pythSpanAt)
 * has no price now and never will: no update can satisfy the program's check
 * for it. Waiting would park the fight forever, and a manual button would ask
 * somebody to sign for a price that does not exist. The only way out is the
 * program's stall refund, which opens STALL_REFUND_SECS after accepted_ts for
 * an accepted fight and after end_ts for a live one (programs/duel/src/lib.rs,
 * refund_duel), and `refundAt` is that moment. It outranks a shut side: a
 * market opening changes nothing for a fight that cannot be priced. */
export type Never = { never: string[]; refundAt: number };

/** Where a feed's stock trades, as the roster knows it. quoteSymbolFor fits,
 *  and so does crank.ts's QuoteSymbol; tests pass their own. */
export type MarketLookup = (
  feed: string,
) => { symbol?: string; market?: string; pool?: string; perp?: string; composite?: string } | undefined;

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
 * for a market that had already priced it. openingAfter (market.ts) finds
 * that moment in unix seconds, or null if nothing opens within ten days; the
 * roster's firstPriceAt asks it the same question for the pages. */
function sideReady(
  feed: string,
  source: number,
  boundary: number,
  now: number,
  lookup: MarketLookup,
): Ready | { shut: string } | { never: string } {
  const market = lookup(feed);
  const name = byFeed(feed)?.ticker ?? market?.symbol ?? feed.replace(/^0x/, "").slice(0, 8);
  const us = (market?.market ?? "US") === "US";

  if (source === SOURCE_PYTH) {
    /* A feed off the roster is not a stock: on a local ring or in the test
     * fights it is crypto, which Pyth prints around the clock. Session hours
     * mean nothing for it, and neither do they for a Pyth feed of a listing
     * outside the US, whose Pyth hours market.ts does not model. */
    if (!market || !us) return { at: boundary + PYTH_GRACE_SECS, why: "pyth" };

    /* A US equity feed prints five days a week, Sunday 8 PM to Friday 8 PM New
     * York (market.ts, pythSpanAt). Inside that, the print a moment after the
     * boundary is its price, whatever the exchange is doing. Outside it no
     * print will ever pass the program's check, and less than PYTH_EDGE_SECS
     * after its start one may not (market.ts), so both are taken as never:
     * the fight waits for no opening, and only its refund ends it. This used to
     * model the regular session only, so 4yf7 (TSLA by Pyth, taken on a Friday
     * night) was parked until Monday's bell and then refused by Hermes on
     * every pass. The decision depends on the boundary alone, never on `now`. */
    if (pythPricesAt(boundary)) return { at: boundary + PYTH_GRACE_SECS, why: "pyth" };
    return { never: name };
  }

  /* A signed side with no roster entry cannot be quoted at all, and the crank
   * says so in words. Parking it would hide that, so it is due like any bar. */
  if (!market) return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };

  const src = sourceAt(boundary, market);
  // The pool's window is the hour before the boundary, complete once it passes.
  if (src === "pool") return { at: boundary + BAR_SETTLE_SECS, why: "pool-window" };
  if (src === "perp") return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };
  /* The composite reads the W minutes from the one the boundary falls in and
   * stamps the end of the last (composite.ts, compositePublishTime), and asks
   * nothing before that minute has closed and settled. */
  if (src === "composite") return { at: compositePublishTime(boundary) + BAR_SETTLE_SECS, why: "composite-window" };

  /* The exchange. Shut at the boundary with nothing else to read means the
   * price is its first bar after it reopens: final a bar and the settle time
   * after the opening, and shut only until the opening. oracle.ts's
   * exchangeBarFinal is the same rule, and the oracle asks nothing before it.
   * A listing in Hong Kong or London waits for its own exchange's session
   * (market.ts, abroadOpeningAfter); one whose sessions are not modelled is
   * never shut. */
  const opening = us
    ? session(boundary * 1_000) === "closed"
      ? openingAfter(boundary, "extended")
      : boundary
    : abroadOpeningAfter(market.market!, boundary);
  if (opening !== boundary) {
    if (opening === null || opening > now) return { shut: name };
    return { at: exchangeBarFinal(boundary, market.market) ?? firstBarEnd(opening) + BAR_SETTLE_SECS, why: "minute-close" };
  }
  return { at: firstBarEnd(boundary) + BAR_SETTLE_SECS, why: "minute-close" };
}

/** When a fight that can never be priced at `which` can be refunded. */
export const refundOpensAt = (d: Pick<DuelView, "acceptedTs" | "endTs">, which: "start" | "settle") =>
  (which === "start" ? d.acceptedTs : d.endTs) + STALL_REFUND_SECS;

/** The earliest unix second both sides' prices for a duel's start or settle
 *  can be final, and what that waits on; or the tickers whose market is shut;
 *  or the tickers nothing will ever price, and when the refund opens. */
export function readyAt(
  d: ClockDuel,
  which: "start" | "settle",
  now: number,
  lookup: MarketLookup = quoteSymbolFor,
): Ready | Shut | Never {
  const boundary = boundaryOf(d, which);
  const sides = [
    sideReady(d.creatorFeed, d.creatorSource, boundary, now, lookup),
    sideReady(d.opponentFeed, d.opponentSource, boundary, now, lookup),
  ];
  const never = [...new Set(sides.flatMap((s) => ("never" in s ? [s.never] : [])))];
  if (never.length) return { never, refundAt: refundOpensAt(d, which) };
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
): Ready | Shut | Never {
  const clock = readyAt(d, which, now, lookup);
  if (!("at" in clock)) return clock;
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
