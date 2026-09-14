/* THE FIGHT TICKET, WORKED OUT WITHOUT A PAGE.
 *
 * /new is the core loop, so the decisions it makes before anybody touches it
 * live here, pure, where a test can hold them: which two stocks it opens on,
 * what a win would pay, which rounds it offers and when each ends, and which
 * one button is the next step. The page only draws the answers.
 *
 * Nothing here signs, fetches or reads a clock of its own. Every function takes
 * the moment it is asked about, so a Saturday and a Monday afternoon can both
 * be tested on any day of the week. */

import { etTime, shares } from "@/lib/format";
import { nextBell, session, weekBell } from "@/lib/market";
import { stakeValue, type Quote } from "@/lib/pricemath";
import { STAKE_DECIMALS, STAKEABLE, tokenSymbol, tradesAroundTheClock } from "@/lib/stocks";

/* THE PAIR THE PAGE OPENS ON.
 *
 * AAPL against NVDA: two names everybody knows, and both settle on a perpetual
 * futures market when the exchange is shut, so the default fight runs at any
 * hour. Somebody who opens the page on a Saturday and presses the button gets a
 * fight that starts now, with no warning above the button, rather than one that
 * sits until Monday.
 *
 * If a cluster cannot stake that pair, the first two stakeable stocks that
 * trade around the clock stand in while the exchange is shut, and the first two
 * stakeable stocks otherwise (roster order puts the most traded first).
 * `roster` is the tickers that can be staked, in roster order; it is a
 * parameter so the fallback can be tested without a different token list. */
export const PREFERRED_PAIR = ["AAPL", "NVDA"] as const;

const STAKEABLE_TICKERS = STAKEABLE.map((s) => s.ticker);

/** Two different stocks that trade around the clock, keeping any side of
 *  `keep` that already does. The page's "Use two 24/7 stocks" applies it, so a
 *  fighter somebody chose is only replaced when it is the one that waits.
 *  Falls back to the first two of `roster` if too few trade around the clock. */
export function allDayPair(
  keep: readonly (string | null)[] = [],
  roster: readonly string[] = STAKEABLE_TICKERS,
): [string, string] {
  const allDay = roster.filter(tradesAroundTheClock);
  const listed = new Set(roster);
  const pool = [...PREFERRED_PAIR.filter((t) => listed.has(t) && tradesAroundTheClock(t)), ...allDay];
  const out: (string | null)[] = [0, 1].map((i) => {
    const t = keep[i];
    return t && listed.has(t) && tradesAroundTheClock(t) ? t : null;
  });
  if (out[0] && out[0] === out[1]) out[1] = null;
  for (let i = 0; i < 2; i++) {
    if (out[i]) continue;
    out[i] = pool.find((t) => !out.includes(t)) ?? null;
  }
  if (out[0] && out[1]) return [out[0], out[1]];
  return [roster[0], roster[1]];
}

export function defaultPair(nowSec: number, roster: readonly string[] = STAKEABLE_TICKERS): [string, string] {
  const shut = session(nowSec * 1_000) === "closed";
  const listed = new Set(roster);
  const fits = (t: string) => listed.has(t) && (!shut || tradesAroundTheClock(t));
  if (PREFERRED_PAIR.every(fits)) return [PREFERRED_PAIR[0], PREFERRED_PAIR[1]];
  if (shut) {
    const allDay = roster.filter(tradesAroundTheClock);
    if (allDay.length >= 2) return [allDay[0], allDay[1]];
  }
  return [roster[0], roster[1]];
}

/* WHAT A WIN PAYS.
 *
 * The winner gets their own stake back and the other side's, both in shares,
 * so the line says exactly those two amounts, in the tokens they are paid in,
 * and what the other side's shares are worth at the price on the screen. The
 * amounts are the ones the transaction will carry (stakeForDollars, in
 * integers); only the dollar figure is a float, and it is display only. */
export type WinPreview = { keep: string; take: string; takeUsd: number | null };

export function winPreview(
  amount1: bigint,
  amount2: bigint,
  t1: string,
  t2: string,
  q2: Pick<Quote, "price" | "expo"> | undefined,
): WinPreview {
  return {
    keep: `${shares(amount1, STAKE_DECIMALS)} ${tokenSymbol(t1)}`,
    take: `${shares(amount2, STAKE_DECIMALS)} ${tokenSymbol(t2)}`,
    takeUsd: stakeValue(amount2, STAKE_DECIMALS, q2),
  };
}

/* THE ROUNDS ON OFFER.
 *
 * A timed round runs from the first prices after somebody takes the challenge,
 * so its end is not known yet and the chip says so. A bell round ends at a
 * fixed moment, and the chip says when, in the market's own clock. */
export type RoundId = "5m" | "15m" | "1h" | "bell" | "week";

export type RoundChoice = { id: RoundId; label: string; sub: string; secs?: number; endTs?: number };

export const ROUND_SECS: Partial<Record<RoundId, number>> = { "5m": 300, "15m": 900, "1h": 3_600 };

export function roundChoices(nowSec: number): RoundChoice[] {
  const bell = nextBell(nowSec * 1_000);
  const week = weekBell(nowSec * 1_000);
  return [
    { id: "5m", label: "5 min", sub: "after a taker", secs: 300 },
    { id: "15m", label: "15 min", sub: "after a taker", secs: 900 },
    { id: "1h", label: "1 hour", sub: "after a taker", secs: 3_600 },
    { id: "bell", label: "Next bell", sub: etTime(bell), endTs: bell },
    { id: "week", label: "Friday bell", sub: etTime(week), endTs: week },
  ];
}

export const isRoundId = (s: string | null | undefined): s is RoundId =>
  s === "5m" || s === "15m" || s === "1h" || s === "bell" || s === "week";

/** The stake chips, in dollars a side. */
export const STAKE_CHIPS = [5, 10, 25, 50, 100] as const;

/* THE ONE NEXT STEP.
 *
 * Not connected: connect. Connected with no account for the stock, or fewer
 * shares than the stake: get some. Everything in order: stake. Anything else
 * (prices still loading, a bad address, a pair that cannot fight now) is a
 * wait, and the page says which. */
export type CtaStep = "connect" | "faucet" | "stake" | "wait";

export function ctaStep(s: { connected: boolean; hasAccount: boolean; short: boolean; ready: boolean }): CtaStep {
  if (!s.connected) return "connect";
  if (!s.hasAccount || s.short) return "faucet";
  return s.ready ? "stake" : "wait";
}

/* WHAT A LINK CAN CARRY.
 *
 * /new?p1=NVDA&p2=AAPL&usd=50&invite=WALLET is how "Run it back" hands over a
 * rematch. Each part is checked here and dropped when it does not hold: a
 * ticker nobody can stake here, the same stock in both corners, a stake that is
 * not a number. A missing corner is filled from the default pair, never with
 * the stock already in the other corner. The invite is passed through as typed;
 * the page checks the address and says when it is not one. */
export type TicketParams = { p1: string; p2: string; usd: number; invite: string };

export const MAX_STAKE_USD = 10_000;

export function ticketFromParams(
  get: (key: string) => string | null,
  nowSec: number,
  roster: readonly string[] = STAKEABLE_TICKERS,
): TicketParams {
  const listed = new Set(roster);
  const pick = (key: string) => {
    const raw = (get(key) ?? "").trim().toUpperCase();
    const hit = roster.find((t) => t.toUpperCase() === raw);
    return hit && listed.has(hit) ? hit : null;
  };
  let p1 = pick("p1");
  let p2 = pick("p2");
  if (p1 && p1 === p2) p2 = null;
  if (!p1 || !p2) {
    const [d1, d2] = defaultPair(nowSec, roster);
    const fill = [d1, d2, ...roster];
    if (!p1) p1 = fill.find((t) => t !== p2) ?? d1;
    if (!p2) p2 = fill.find((t) => t !== p1) ?? d2;
  }
  const usdRaw = Number(get("usd"));
  const usd = Number.isFinite(usdRaw) && usdRaw >= 1 ? Math.min(MAX_STAKE_USD, Math.round(usdRaw)) : 25;
  return { p1, p2, usd, invite: (get("invite") ?? "").trim() };
}
