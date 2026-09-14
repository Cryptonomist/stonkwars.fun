/* THE SPARRING WALLET: somebody to fight when nobody else is here.
 *
 * The program refuses a self-duel, and a browser gets one guest wallet, so a
 * visitor on their own could start a fight and then wait for a stranger who
 * never came. On devnet the owner can run one disclosed wallet that takes
 * challenges addressed to it, through the invitee field every challenge
 * already has ("Call someone out"). Its takes are ordinary accept_duel
 * transactions from its own key, so its fights are real and settle like any
 * other; the site names it "Sparring wallet" wherever it appears, and it is
 * left off the ranks.
 *
 * This file is the part the browser may see: which wallet it is (a public
 * key, from NEXT_PUBLIC_SPAR_WALLET) and which challenges it will take. The
 * key that signs lives only on the server (api/spar). With no wallet set, or
 * off devnet, none of it appears anywhere. */

import { PublicKey } from "@solana/web3.js";

import { isInviteOnly, STATUS_OPEN, type DuelView } from "./duel";
import { CLUSTER } from "./stocks";

/** The longest round it takes: a demo should finish while somebody watches. */
export const SPAR_MAX_ROUND_SECS = 900;
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
  if (!d.durationSecs || d.durationSecs > SPAR_MAX_ROUND_SECS) return "rounds of 5 or 15 minutes only";
  return null;
}
