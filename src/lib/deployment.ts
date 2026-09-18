/* WHICH HALF OF THE PRODUCT THIS DEPLOYMENT CAN ACTUALLY RUN.
 *
 * There are two sites, on purpose, and they are the same code with one
 * environment variable different:
 *
 *   devnet   the whole fight loop. Free test shares from the faucet, the
 *            sparring wallet keeping seats open, fights that settle in
 *            fifteen minutes. Anyone can try it without funding a wallet.
 *   mainnet  real trading. xStocks, Ondo, Backpack and PreStocks swapped
 *            through Jupiter in your own wallet, at real prices.
 *
 * FIGHTS DO NOT RUN ON MAINNET, and the reason is not caution, it is that the
 * program is not deployed there. Beyond that the faucet refuses off devnet
 * (nobody can mint a real tokenized share) and the sparring wallet refuses off
 * devnet, so even with a program a visitor would find an empty board and no way
 * to get an asset. The honest thing is to say so and send them to the site that
 * works, rather than render a button that cannot do anything.
 *
 * Trading is the mirror image: it needs real tokens, so it only runs on
 * mainnet, which TradePanel already handles on its own. */

import { CLUSTER } from "./stocks";

/** Whether this deployment can create, take and settle fights. */
export const FIGHTS_LIVE = CLUSTER !== "mainnet-beta";

/** Whether this deployment can swap real tokens. */
export const TRADING_LIVE = CLUSTER === "mainnet-beta";

/* The other deployment, so each site can send somebody to the one that does
 * what they came for. Set per deployment; the fallbacks are the addresses in
 * use, so a build with neither set still links somewhere real. */
export const DEVNET_SITE = process.env.NEXT_PUBLIC_DEVNET_SITE || "https://stonkwars.fun";
export const MAINNET_SITE = process.env.NEXT_PUBLIC_MAINNET_SITE || "";

/** The other site, and what it is for, or null when there is nowhere to send
 *  anyone (a deployment that has not been told about its sibling). */
export function siblingSite(): { href: string; what: string; here: string } | null {
  if (FIGHTS_LIVE) {
    return MAINNET_SITE ? { href: MAINNET_SITE, what: "Trade for real on mainnet", here: "Fights run here, on devnet, with free test shares." } : null;
  }
  return { href: DEVNET_SITE, what: "Fight on devnet, free", here: "Trading runs here, on mainnet, in your own wallet." };
}
