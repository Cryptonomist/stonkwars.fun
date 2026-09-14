/* The fight page's words about time, over the clocks that decide them.
 *
 * NOTHING HERE WORKS OUT WHEN A PRICE CAN EXIST. That is the price clock's job
 * (priceClock.ts), and the round clock (roundClock.ts) turns it into the status
 * line, the countdown and the manual button. An earlier plan had this file step
 * through the market's hours in fifteen-minute jumps to find "prices from", which
 * would have been a second answer to the same question, free to disagree with
 * the settler's. So this only formats: it asks those two, and says the result.
 *
 * Pure: unix seconds in, strings and numbers out, so the tests pin every line. */

import { boundaryOf } from "./crankTx";
import {
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "./duel";
import { clock, etTime, pct, points, span } from "./format";
import { readySince, type MarketLookup } from "./priceClock";
import { LANDING_SECS, shutSides, type RoundClockDuel } from "./roundClock";

/** Far enough ahead that every market has opened again: openingAfter looks ten days. */
const HORIZON_SECS = 10 * 86_400;

export type PricesFrom = { which: "start" | "settle"; at: number };

/* WHEN A FIGHT WAITING ON A SHUT MARKET GETS ITS PRICES.
 *
 * While a side's market is shut, roundClock has no countdown to give: it says
 * "waiting for the market that prices it to open" and stops. The time it will
 * count down to once the market opens is already fixed, though. readySince's
 * times are dated from the boundary and the opening after it, never from "now",
 * so asking it about a moment after every market has reopened gives exactly the
 * second roundClock will count to then, landing time included. That is this.
 *
 * So the "Prices from" countdown on a Saturday runs into the round clock's own
 * countdown on Monday without a jump. Null when nothing waits on a shut market
 * (roundClock has the countdown), at no boundary, or on the server render. */
export function pricesFrom(d: RoundClockDuel, now: number, lookup?: MarketLookup): PricesFrom | null {
  if (!now) return null;
  const which = d.status === STATUS_ACCEPTED ? "start" : d.status === STATUS_LIVE && now >= d.endTs ? "settle" : null;
  if (!which || shutSides(d, now, lookup).length === 0) return null;
  const later = readySince(d, which, Math.max(now, boundaryOf(d, which)) + HORIZON_SECS, lookup);
  return "shut" in later ? null : { which, at: later.at + LANDING_SECS };
}

/** What the open challenge's round is: "6 min round", or a fixed end. */
export function roundWords(d: Pick<DuelView, "durationSecs" | "endTs">): string {
  return d.durationSecs ? `${span(d.durationSecs)} round` : `Ends at the first price after ${etTime(d.endTs)}`;
}

/** A gap this small prints as nothing at four decimals, so call it even. */
const EVEN_POINTS = 0.00005;

/* Who is ahead, by the gap that decides it. Two issuers' tokens of one stock
 * can meet, and "AAPL leads AAPL" says nothing, so those name the corners. */
export function leadWords(t1: string, t2: string, m1: number | null, m2: number | null): string | null {
  if (m1 === null || m2 === null || !Number.isFinite(m1) || !Number.isFinite(m2)) return null;
  const gap = m1 - m2;
  if (Math.abs(gap) < EVEN_POINTS) return "Dead even";
  const [a, b] = t1 === t2 ? ["Challenger", "Answer"] : [t1, t2];
  return `${gap > 0 ? a : b} leads by ${points(Math.abs(gap))} percentage points`;
}

/* THE BROWSER TAB, SO A FIGHT KEEPS MOVING IN A BACKGROUND TAB.
 *
 * Live: "NVDA +0.42% vs AAPL -0.10% · 4:12", the moves from live prices and the
 * clock from roundClock's secondsLeft. Everything else is the pair and a word.
 * The moves are dropped rather than guessed while a price is missing. */
export function tabTitle(o: {
  d: Pick<DuelView, "status" | "outcome" | "expiresTs" | "endTs">;
  t1: string;
  t2: string;
  m1: number | null;
  m2: number | null;
  now: number;
  secondsLeft: number | null;
}): string {
  const { d, t1, t2, m1, m2, now, secondsLeft } = o;
  const pair = `${t1} vs ${t2}`;
  switch (d.status) {
    case STATUS_LIVE: {
      if (now && now < d.endTs && secondsLeft !== null) {
        const sides = m1 !== null && m2 !== null ? `${t1} ${pct(m1)} vs ${t2} ${pct(m2)}` : pair;
        return `${sides} · ${clock(secondsLeft)}`;
      }
      return `${pair} · Bell`;
    }
    case STATUS_OPEN:
      return `${pair} · ${now && d.expiresTs <= now ? "Expired" : "Open"}`;
    case STATUS_ACCEPTED:
      return `${pair} · Fight on`;
    case STATUS_SETTLED:
      return `${pair} · Final`;
    case STATUS_REFUNDED:
      return `${pair} · ${d.outcome === OUTCOME_TIE ? "Dead heat" : "Refunded"}`;
    case STATUS_VOID:
      return `${pair} · Void`;
    default:
      return pair;
  }
}
