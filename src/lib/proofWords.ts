/* A 24/7 PRICE, READ BACK IN WORDS.
 *
 * The composite (composite.ts, compositeV2At) proves every price it signs:
 * each pinned market's request, its last trade before the window, whether it
 * counted and why not, and for each minute of the window its close, its
 * premium to the other markets and the corrected close the median took. The
 * fight page's receipt draws that proof as a table under the price, so anyone
 * can check the number on chain against the markets that made it, and make
 * every request again themselves.
 *
 * This file turns the proof into what the table and its sentences say, and
 * nothing more: no price is worked out here, every figure is read from the
 * proof exactly as the route served it (/api/quote/proof), and a price in
 * ticks is printed from its integer text, never through a float. Pure, so a
 * test holds it against a proof built from last weekend's real minutes. */

import {
  COMPOSITE_RULE,
  COMPOSITE_V2_RULE,
  compositePublishTime,
  VENUES,
  type CompositeProof,
  type CompositeV2Proof,
  type V2ProofRow,
  type VenueRequest,
} from "./composite";
import { etShort } from "./format";
import { QUOTE_EXPO, type PriceSource } from "./oracle";

/* WHAT PRICED A SIDE, FROM WHAT THE CHAIN RECORDED.
 *
 * The rule in force at a boundary says what prices a side there (oracle.ts,
 * sourceAt), but a composite side can still fall back to the exchange's first
 * bar after it. Only a median is stamped at compositePublishTime, the end of
 * its window, so a composite boundary whose recorded price carries any other
 * stamp was priced by the exchange: "fallback". */
export type PricedBy = PriceSource | "fallback";

export const pricedByRecord = (from: PriceSource, boundary: number, publishTime: number): PricedBy =>
  from === "composite" && publishTime !== compositePublishTime(boundary) ? "fallback" : from;

/** What the proof route answers for a feed and a boundary (app/api/quote/proof). */
export type ProofResponse = {
  rule: string;
  feed: string;
  ticker: string;
  boundary: number;
  source: string;
  price: string | null;
  expo: number | null;
  publishTime: number | null;
  tier: null | "two-anchor" | "exchange";
  wait: string | null;
  retryAt: number | null;
  parkedUntil: number | null;
  proof: CompositeProof | CompositeV2Proof | null;
  sha256: string | null;
};

const TICK_DIGITS = -QUOTE_EXPO;

/** "412.3456": a price in ticks (1e-4) as exact decimal text. */
export function ticksText(ticks: string | null): string | null {
  if (ticks === null || !/^-?\d+$/.test(ticks)) return null;
  const neg = ticks.startsWith("-");
  const digits = (neg ? ticks.slice(1) : ticks).padStart(TICK_DIGITS + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -TICK_DIGITS)}.${digits.slice(-TICK_DIGITS)}`;
}

/** Whether the proof's price is exactly the price the program recorded. The
 *  oracle signs at QUOTE_EXPO, so the two are the same integer; a price at any
 *  other exponent is compared at the finer of the two. */
export function sameAsChain(proofTicks: string | null, price: bigint, expo: number): boolean {
  if (proofTicks === null || !/^-?\d+$/.test(proofTicks)) return false;
  const ticks = BigInt(proofTicks);
  if (expo === QUOTE_EXPO) return ticks === price;
  if (expo < QUOTE_EXPO) return ticks * 10n ** BigInt(QUOTE_EXPO - expo) === price;
  return ticks === price * 10n ** BigInt(expo - QUOTE_EXPO);
}

export const isV2 = (p: CompositeProof | CompositeV2Proof): p is CompositeV2Proof => p.rule === COMPOSITE_V2_RULE;

/** Why a market did not count, in the table's words. */
export function whyWords(why: V2ProofRow["why"]): string {
  switch (why) {
    case "counted":
      return "counted";
    case "no-candle":
      return "no candle before the window";
    case "bad-close":
      return "unreadable close";
    case "stale":
      return "no trade in the 15 minutes before";
    case "uncalibrated":
      return "too few minutes to measure its premium";
  }
}

/** The request as a link somebody can open, or the POST it was. */
export function requestWords(r: VenueRequest): { href: string | null; label: string; body: string | null } {
  if (r.method === "GET") return { href: r.url, label: `GET ${new URL(r.url).host}`, body: null };
  return { href: null, label: `POST ${new URL(r.url).host}`, body: r.body };
}

export type ProofCell = { t: number; close: string | null; calibrated: string | null; kept: boolean };
export type ProofTableRow = {
  venue: string;
  instrument: string;
  anchor: boolean;
  lastTraded: number | null;
  counted: boolean;
  why: string;
  cells: ProofCell[];
  request: ReturnType<typeof requestWords>;
};

/** One row per pinned market, in the proof's own order, and the minutes. */
export function proofTable(p: CompositeV2Proof): { minutes: number[]; rows: ProofTableRow[]; medians: (string | null)[] } {
  const minutes = Array.from({ length: p.window.minutes }, (_, i) => p.window.from + i * 60);
  const rows = p.venues.map((v) => ({
    venue: v.name,
    instrument: v.instrument,
    anchor: v.anchor,
    lastTraded: v.lastTraded,
    counted: v.counted,
    why: whyWords(v.why),
    cells: minutes.map((t) => {
      const m = v.minutes.find((x) => x.t === t);
      return { t, close: m?.close ?? null, calibrated: ticksText(m?.calibrated ?? null), kept: !!m?.kept };
    }),
    request: requestWords(v.request),
  }));
  const medians = minutes.map((t) => ticksText(p.minutes.find((x) => x.t === t)?.value ?? null));
  return { minutes, rows, medians };
}

/* THE SENTENCES UNDER THE TABLE.
 *
 * What priced the side, in the plan's words (docs/247-pricing.md, section 3),
 * then the honest limit: these markets are perpetual futures and tokenized
 * shares, not the exchange listing, and a weekend price is what they traded,
 * not the next open. A side the median did not price says which of the rule's
 * three reasons sent it to the exchange (composite.ts, compositeV2At): too few
 * counted markets, a median beyond the breaker, or no readable close in a
 * window minute. Each is told from the proof's own reason, never assumed. */
export function proofSentences(p: CompositeV2Proof, ticker: string): string[] {
  const from = etShort(p.window.from);
  const out: string[] = [];
  const took = "so this side took the exchange's first bar after it.";
  if (p.tier === null && p.price !== null) {
    out.push(
      `Priced 24/7 by the Stonk Wars oracle: the median, over the ${p.window.minutes} minutes from ${from} ET, of the one-minute closes of ` +
        `the ${p.counted} markets that traded ${ticker} in the 15 minutes before, each first corrected by its own premium to the others over the hour before.`,
    );
  } else if (p.reason && /breaker$/.test(p.reason)) {
    out.push(
      `The median of ${ticker}'s 24/7 markets from ${from} ET was more than 15% from the exchange's last close, which the rule treats as a price it cannot trust, ${took}` +
        ` The rule's reason: ${p.reason}.`,
    );
  } else if (p.reason && /^no counted market had a readable close/.test(p.reason)) {
    out.push(`No market counted for ${ticker} had a readable close in a minute of the window from ${from} ET, ${took} The rule's reason: ${p.reason}.`);
  } else {
    out.push(
      `Fewer than 3 markets (2 of them anchors) could be counted for ${ticker} before ${from} ET, ${took}` + (p.reason ? ` The rule's reason: ${p.reason}.` : ""),
    );
  }
  out.push("These are perpetual futures and tokenized stocks, not the exchange listing; a weekend price is what those markets traded, not the next open.");
  // How long each row can be fetched again, from the retention the rule itself is built on.
  const days = (v: keyof typeof VENUES) => VENUES[v].retentionSecs / 86_400;
  const short = [...new Set(p.venues.map((v) => v.venue))].filter((v) => days(v) < 20).sort((a, b) => days(a) - days(b));
  if (short.length) {
    out.push(
      `Every request above is public. ${short.map((v, i) => `${VENUES[v].name}${i ? "" : " keeps"} about ${days(v)} days${i ? "" : " of one-minute history"}`).join(" and ")}, ` +
        `so ${short.length === 1 ? "its row" : "those rows"} can be fetched again only that long; the other markets keep 25 days or more.`,
    );
  } else {
    out.push("Every request above is public, and each market keeps its one-minute history for 25 days or more.");
  }
  return out;
}

/** The rule's name as the table heads it. */
export const ruleWords = (rule: string) => (rule === COMPOSITE_V2_RULE ? "composite-v2" : rule === COMPOSITE_RULE ? "composite-v1" : rule);
