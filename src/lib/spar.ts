/* THE SPARRING WALLET: somebody to fight when nobody else is here.
 *
 * The program refuses a self-duel, and a browser gets one guest wallet, so a
 * visitor on their own could start a fight and then wait for a stranger who
 * never came. On devnet the owner can run one disclosed wallet that does two
 * things for them:
 *
 *   takes challenges addressed to it, through the invitee field every
 *   challenge already has ("Call someone out"), and
 *   keeps a few open seats of its own on popular pairs, so a visitor can
 *   press Take and be in a fight at once.
 *
 * Its takes and challenges are ordinary accept_duel and create_duel
 * transactions from its own key, so its fights are real and settle like any
 * other; the site names it "Sparring wallet" wherever it appears, and it is
 * left off the ranks.
 *
 * This file is the part the browser may see: which wallet it is (a public
 * key, from NEXT_PUBLIC_SPAR_WALLET), which challenges it will take, and how it
 * picks its seats. The key that signs lives only on the server (spar.server.ts).
 * With no wallet set, or off devnet, none of it appears anywhere. */

import { PublicKey } from "@solana/web3.js";

import { isInviteOnly, STATUS_OPEN, type DuelView } from "./duel";
import { session } from "./market";
import { CLUSTER } from "./stocks";

/* THE LONGEST ROUND IT TAKES: A DAY.
 *
 * It used to take 5 and 15 minute rounds only, so a demo finished while
 * somebody watched. But while the exchange is shut the 24/7 stocks only fight
 * rounds of 12 hours or more (MIN_OFFHOURS_ROUND_SECS), so at night and at a
 * weekend a visitor had nobody to spar with at all. It now takes any timed
 * round up to 24 hours; the hours rules on top (mixedHoursAt at the take) still
 * refuse a round that would not be fair, exactly as for every other taker. */
export const SPAR_MAX_ROUND_SECS = 86_400;
/** The most a take may be worth, in dollars. Test tokens, but a sane ceiling. */
export const SPAR_MAX_USD = 1_000;

function parse(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new PublicKey(raw.trim()).toBase58();
  } catch {
    return null;
  }
}

/** The sparring wallet's address, or null when it is not offered here. */
export const SPAR_WALLET: string | null = CLUSTER === "devnet" ? parse(process.env.NEXT_PUBLIC_SPAR_WALLET) : null;

export const isSparWallet = (wallet: string | null | undefined): boolean => !!SPAR_WALLET && wallet === SPAR_WALLET;

/** Why the sparring wallet would not take this challenge now, or null when it
 *  would. The market-hours rule is checked separately, with mixedHoursAt, at
 *  the moment of the take. Pure, so the route and the tests agree. */
export function sparRefusal(
  d: Pick<DuelView, "status" | "invitee" | "creator" | "expiresTs" | "durationSecs" | "endTs">,
  now: number,
  spar: string,
): string | null {
  if (d.status !== STATUS_OPEN) return "not open";
  if (d.expiresTs <= now) return "expired";
  if (!isInviteOnly(d as DuelView) || d.invitee.toBase58() !== spar) return "not addressed to the sparring wallet";
  if (d.creator.toBase58() === spar) return "its own challenge";
  if (!d.durationSecs || d.durationSecs > SPAR_MAX_ROUND_SECS) return "timed rounds up to 24 hours only";
  return null;
}

/** The round a visitor gets when they choose to spar: one they can watch to
 *  the end while the exchange trades, and the overnight round while it is shut,
 *  which is the shortest the 24/7 stocks fight then. */
export function sparRoundFor(nowMs: number): "15m" | "12h" {
  return session(nowMs) === "closed" ? "12h" : "15m";
}

/* ─── Its own open seats ──────────────────────────────────────────────────── */

/** How many open challenges of its own it keeps up. */
export const SPAR_SEATS = 3;
/** What each side stakes in a seat, in dollars. */
export const SPAR_SEAT_USD = 25;

/* Pairs that fight around the clock (both in venues247.json's 24/7 set) and
 * that people know, so a seat can be taken at any hour. Each seat is one of
 * these, never two of the same pair at once. The sparring wallet's corner is
 * the first ticker; the visitor who takes it backs the second. */
export const SPAR_SEAT_PAIRS: readonly [string, string][] = [
  ["NVDA", "AMD"],
  ["AAPL", "MSFT"],
  ["TSLA", "NVDA"],
  ["GOOGL", "META"],
  ["COIN", "HOOD"],
  ["SPY", "QQQ"],
  ["AMZN", "GOOGL"],
  ["MU", "INTC"],
  ["MSTR", "COIN"],
  ["PLTR", "ORCL"],
];

export type SeatPlan = { a: string; b: string; durationSecs: number; expiresTs: number };

/* WHICH SEAT TO OPEN NEXT.
 *
 * The first pair not already open, on the first round a visitor could take and
 * fight fairly for the whole time the seat stays open: 15 minutes while the
 * exchange trades, the overnight 12 hours or 24 hours while it is shut. `fair`
 * is mixedHoursAt from a taker's side, passed in so this stays pure and the
 * tests can pin it. A seat stays open 90 minutes on a short round and 6 hours on
 * a long one, and is asked to be fair at both ends of that window; the server
 * calls off an expired seat and opens a fresh one. Null when every pair is open
 * or none is fair now. */
export function planSeat(
  now: number,
  openPairs: ReadonlySet<string>,
  fair: (a: string, b: string, takeAt: number, durationSecs: number, expiresTs: number) => boolean,
  pairs: readonly [string, string][] = SPAR_SEAT_PAIRS,
): SeatPlan | null {
  const rounds: [number, number][] = [
    [900, 90 * 60],
    [43_200, 6 * 3_600],
    [86_400, 6 * 3_600],
  ];
  for (const [a, b] of pairs) {
    if (openPairs.has(`${a}/${b}`)) continue;
    for (const [durationSecs, open] of rounds) {
      const expiresTs = now + open;
      if (fair(a, b, now, durationSecs, expiresTs) && fair(a, b, expiresTs - 120, durationSecs, expiresTs)) {
        return { a, b, durationSecs, expiresTs };
      }
    }
  }
  return null;
}
