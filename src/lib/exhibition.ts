/* EXHIBITION BOUTS: a fight with nothing on the table.
 *
 * A PreStocks company cannot be staked here, and the reason is in prestocks.ts:
 * its mint carries a permanent delegate and a transfer fee, so a program that
 * promises nobody can touch a stake cannot hold one. That left the private
 * companies as a desk to look at rather than anything to play with.
 *
 * An exhibition is the way they get to fight anyway. Two assets, one window,
 * the bigger percentage move wins, and nothing is escrowed because there is
 * nothing to escrow. Boxing has the word already: an exhibition is a real bout
 * that does not go on the record.
 *
 * WHAT IS REAL ABOUT IT. The prices. A PreStocks side is read from the same
 * pool the desk quotes, and a roster side from the same market the oracle would
 * read at that minute. What is NOT real is the settlement: no program runs, no
 * stake moves, no receipt is written, and nothing here is signed or checked on
 * chain. The UI has to say so, and the words below are where it says it.
 *
 * This file is pure. Fetching lives in the route; the maths and the words live
 * here so the tests can pin them. */

/** One side's path, as percent from its own first price in the window. */
export type Leg = {
  ticker: string;
  name: string;
  /** Where the prices came from, in the words a badge uses. */
  source: "pool" | "exchange" | "perp" | "mixed";
  /* Which venue, when it is a pool: the DEX as a person writes it, and the
   * pool itself so the badge can link to what it read. Named per side rather
   * than assumed, because these pools are not all on the same DEX. */
  venue?: string;
  pool?: string;
  /** Unix seconds, oldest first. */
  t: number[];
  /** Percent from the first priced bar. Null where that bar never traded. */
  pct: (number | null)[];
  first: number | null;
  last: number | null;
};

export type Verdict =
  | { kind: "decided"; winner: string; loser: string; margin: number }
  | { kind: "dead-heat" }
  | { kind: "no-contest"; why: string };

export type Exhibition = {
  from: number;
  to: number;
  a: Leg;
  b: Leg;
  verdict: Verdict;
};

/** Percent from `first` to `last`, or null when either end never priced. */
export function movePct(first: number | null, last: number | null): number | null {
  if (first === null || last === null || first <= 0) return null;
  return ((last - first) / first) * 100;
}

/* A dead heat has to mean something, so it is a real tie to the tenth of a
 * basis point rather than an exact float match: two paths that land within a
 * ten-thousandth of a percent of each other did not separate, and calling one
 * of them the winner on a rounding artefact would be a lie the chart cannot
 * support. The program uses the same idea for a real fight. */
export const DEAD_HEAT_POINTS = 0.0001;

export function verdictOf(a: Leg, b: Leg): Verdict {
  const ma = movePct(a.first, a.last);
  const mb = movePct(b.first, b.last);
  if (ma === null || mb === null) {
    const which = ma === null && mb === null ? "Neither" : ma === null ? a.ticker : b.ticker;
    return { kind: "no-contest", why: `${which} did not trade in this window.` };
  }
  const gap = ma - mb;
  if (Math.abs(gap) < DEAD_HEAT_POINTS) return { kind: "dead-heat" };
  return gap > 0
    ? { kind: "decided", winner: a.ticker, loser: b.ticker, margin: gap }
    : { kind: "decided", winner: b.ticker, loser: a.ticker, margin: -gap };
}

/** Turn a series of prices into percent from the first one that traded. */
export function legFrom(
  ticker: string,
  name: string,
  source: Leg["source"],
  t: number[],
  c: (number | null)[],
): Leg {
  const firstAt = c.findIndex((x) => x !== null && x > 0);
  const first = firstAt === -1 ? null : (c[firstAt] as number);
  let last: number | null = null;
  for (let i = c.length - 1; i >= 0; i--) {
    const x = c[i];
    if (x !== null && x > 0) {
      last = x;
      break;
    }
  }
  const pct = c.map((x) => (first === null || x === null || x <= 0 ? null : ((x - first) / first) * 100));
  return { ticker, name, source, t, pct, first, last };
}

/* ─── words ──────────────────────────────────────────────────────────────── */

/** Said wherever an exhibition is shown, and asserted in the tests, so the
 *  page and the promise cannot drift apart. */
export const NOTHING_AT_STAKE =
  "An exhibition is watched, not fought: no stake is put up, nothing is escrowed, no program runs and no receipt is written. The prices are the real ones. The result is not on chain and counts for nothing.";

export function verdictWords(v: Verdict): string {
  switch (v.kind) {
    case "decided":
      return `${v.winner} cooked ${v.loser} by ${v.margin.toFixed(3)} percentage points.`;
    case "dead-heat":
      return "A dead heat: neither side separated.";
    case "no-contest":
      return `No contest. ${v.why}`;
  }
}

/** The windows on offer, and the bar size each is drawn at. A day of minutes
 *  would be 1,440 points to draw and to fetch from a pool that rate limits. */
export const WINDOWS = {
  "1h": { label: "1 hour", secs: 3_600, bucket: "minute" as const },
  "24h": { label: "24 hours", secs: 86_400, bucket: "hour" as const },
  "7d": { label: "7 days", secs: 7 * 86_400, bucket: "hour" as const },
};
export type WindowId = keyof typeof WINDOWS;
export const isWindowId = (s: string): s is WindowId => s in WINDOWS;
