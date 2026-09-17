/* COMPANIES THAT ARE NOT PUBLIC YET.
 *
 * OpenAI, Anthropic, SpaceX and a few others have no ticker, no exchange and no
 * closing bell, because they have never listed. PreStocks tokenizes exposure to
 * them on Solana, and those tokens trade around the clock in ordinary pools. So
 * they can be watched and bought here like anything else.
 *
 * THEY CANNOT BE FOUGHT OVER, AND THE REASON IS NOT SQUEAMISHNESS.
 *
 * Every one of these mints carries Token-2022 extensions that hand the issuer
 * powers over tokens it does not hold: `permanentDelegate` lets them move
 * anyone's balance, and `pausableConfig` lets them stop transfers entirely.
 * This program's whole promise is that once two people stake, nobody, including
 * us, can take the stakes out or stop the fight finishing. For a mint with a
 * permanent delegate that promise is simply untrue, so these are never staked
 * and never escrowed. (There are two more reasons the code would have to solve
 * even if the first were fine: a 50 bps transfer fee, so escrow would receive
 * less than was staked, and a transfer hook whose accounts an ordinary
 * transfer_checked does not pass.)
 *
 * The list is generated from chain, not typed by hand: see the note on `pool`.
 *
 * SPACEX IS NOT HERE ON PURPOSE. SpaceX already lists on this site as SPCX,
 * tokenized by xStocks, Ondo and Backpack, and that one can be fought over. A
 * second, thinner SpaceX that could not would be a worse copy of a better
 * entry. Figure AI, by contrast, stays: the roster's FIGR is Figure Technology
 * Solutions, the listed lender, which is a different company with a confusingly
 * similar name, and the blurb says so. */

import prestocksJson from "@/data/prestocks.json";

export type PreStock = {
  /** How this site names the company: OPENAI, ANTHROPIC. */
  ticker: string;
  name: string;
  blurb: string;
  /** What the token calls itself on chain, which is not always the ticker
   *  (Anthropic's token is ANTHRP, Anduril's is ANDURL). */
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
  /* The deepest Solana pool where this token is the BASE asset.
   *
   * Base matters. Anthropic's deepest pool of any kind pairs it as the quote
   * side of someone else's token, and that pool reports its price as $0.00.
   * Taking "the biggest pool" would have priced a whole market at zero. */
  pool: string;
  poolName: string;
  color: string;
  /** The market as it stood when the file was generated, for the gate below. */
  seen: { liquidityUsd: number; volume24hUsd: number; trades24h: number; priceUsd: number };
};

export const PRESTOCKS = prestocksJson as PreStock[];

/* Said on the page, and asserted in the tests, so the two cannot drift.
 *
 * It used to give only the issuer's powers as the reason, which read as
 * inconsistent the moment the rest of the site admitted that the issuers of
 * ordinary tokenized stocks hold much the same powers. The honest answer is
 * that a fight has no test version of a private company to use, so it would
 * have to escrow the real token, and these mints refuse that outright. */
export const NOT_STAKEABLE_BECAUSE =
  "There is no test version of a private company, so a fight would have to escrow the real token, and these mints will not have it: a 50 bps transfer fee means the escrow receives less than was staked, a transfer hook wants accounts an ordinary transfer does not pass, and the issuer can pause transfers or move them out of any wallet at will. So these are traded and watched here, never staked.";

/* HOW BUSY IS BUSY ENOUGH.
 *
 * A price is only honest if the market actually traded near the moment it
 * claims. SpaceX holds the deepest pool of the eight and trades about a hundred
 * times a day, roughly once every thirteen minutes; OpenAI trades that often
 * every minute. Deep is not the same as busy, and only busy makes a price.
 *
 * So the badge is drawn from trades, not from liquidity, and the thin ones say
 * so rather than being quietly presented as though they were the same thing. */
export const BUSY_TRADES_24H = 2_000;
export const QUIET_TRADES_24H = 500;

export type Activity = "busy" | "steady" | "quiet";

/** Live count when the route has one, else the count in the file. */
export function activityOf(p: PreStock, trades24h?: number | null): Activity {
  const n = trades24h ?? p.seen.trades24h;
  if (n >= BUSY_TRADES_24H) return "busy";
  if (n >= QUIET_TRADES_24H) return "steady";
  return "quiet";
}

export const ACTIVITY_WORDS: Record<Activity, string> = {
  busy: "trades every minute",
  steady: "trades through the day",
  quiet: "trades rarely, so its price can be stale",
};

export const byPreTicker = (ticker: string): PreStock | undefined =>
  PRESTOCKS.find((p) => p.ticker === ticker.toUpperCase());

/** Roughly what one token is worth, as of the file. Live prices come from the route. */
export const seenPrice = (p: PreStock) => p.seen.priceUsd;
