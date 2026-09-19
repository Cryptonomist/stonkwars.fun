/* COMPANIES THAT ARE NOT PUBLIC YET.
 *
 * OpenAI, Anthropic and the other companies on this desk have no ticker, no
 * exchange and no closing bell, because they have not listed. PreStocks
 * tokenizes exposure to them on Solana, and those tokens trade around the clock
 * in ordinary pools. So they can be watched and bought here like anything else.
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
 * even if the first were fine. The issuer takes a transfer fee and sets its
 * rate: 50 bps in epoch 1038, with 100 bps already scheduled from epoch 1039,
 * so escrow would receive less than was staked, by an amount the issuer can
 * change. And the mints carry a transfer-hook extension: no hook program is set
 * today, but the same key can set one, and every transfer would then need
 * accounts an ordinary transfer_checked does not pass. One key holds all of it,
 * on all seven mints: fee, hook, pause, freeze and delegate.)
 *
 * NOTHING SAID ON THE PAGE NAMES THE FEE RATE, AND THAT IS DELIBERATE. It read
 * "a 50 bps transfer fee" until a check found 100 bps waiting in the mint's
 * newer fee setting. Both were true, a day apart. The issuer can change it
 * again, so the page says there is a fee and who sets it, and a test fails if a
 * number creeps back in.
 *
 * The list is generated, not typed by hand: scripts/build-prestocks.mjs takes
 * the companies and mints from PreStocks' own API, decimals and token program
 * from each mint on chain, and the pool from GeckoTerminal (see `pool`).
 *
 * SPACEX IS NOT HERE, AND THAT IS DELIBERATE. SpaceX has listed: it trades on
 * Nasdaq as SPCX, the roster carries it, and xStocks, Ondo and Backpack tokenize
 * it, so it can be fought over like any listed stock. PreStocks still lists a
 * SpaceX token, but putting it on a desk of companies that have not listed
 * would be a false label as well as a thinner, unstakeable copy of a better
 * entry.
 *
 * It was once moved here, and SPCX taken off the roster, on the premise that
 * SpaceX had never listed and so SPCX broke the PreStocks bounty's rule against
 * other issuers' pre-IPO tokens. The premise was false: the venue evidence in
 * scripts/data had described SPCX as "Class A common stock (Nasdaq: SPCX)" the
 * whole time. Whether a company has listed is a fact to check against an
 * exchange listing, never a name to match against a list of private companies.
 *
 * THE NEXT ONE. OpenAI and Anthropic both filed confidentially to go public in
 * June 2026, and Anthropic was reported in September to be aiming for November.
 * The day one of these lists, this desk is wrong about it. It leaves the way
 * SpaceX did: add it to EXCLUDE in scripts/build-prestocks.mjs and
 * regenerate, and the roster picks up its ticker once the issuers tokenize
 * the listed share. The page says "not listed yet" rather than "never listed"
 * for exactly this reason.
 *
 * Figure AI stays for a different reason: the roster's FIGR is Figure
 * Technology Solutions, the listed lender, a different company with a
 * confusingly similar name, and the pre-IPO desk says so beside it. */

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
  /* Which DEX that pool is on, as GeckoTerminal ids it ("meteora",
   * "raydium-clmm"). Recorded rather than assumed: six of the seven are
   * Meteora pools and Figure AI's is Raydium, so a page that said "Meteora"
   * across the board would be wrong about one of them today and could be wrong
   * about more tomorrow. */
  dex?: string;
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
  "There is no test version of a private company, so a fight would have to escrow the real token, and these mints rule that out: the issuer takes a transfer fee and can change its rate, so the escrow would receive less than was staked, and it can switch on a transfer hook, pause transfers or move them out of any wallet at will. So these are traded and watched here, never staked.";

/* HOW BUSY IS BUSY ENOUGH.
 *
 * A price is only honest if the market actually traded near the moment it
 * claims. A deep pool is not the same as a busy one: when this file was last
 * generated, Kalshi's pool was one of the deepest here and traded about a
 * twentieth as often as OpenAI's. Only busy makes a price.
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

/** A DEX id as a person writes it. Unknown ids come back tidied rather than
 *  dropped, so a new venue shows its own name instead of disappearing. */
export function dexName(id?: string): string | null {
  if (!id) return null;
  const known: Record<string, string> = {
    meteora: "Meteora",
    "meteora-dlmm": "Meteora DLMM",
    "raydium-clmm": "Raydium CLMM",
    raydium: "Raydium",
    orca: "Orca",
    "orca-whirlpool": "Orca Whirlpool",
  };
  if (known[id]) return known[id];
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Where to look at the pool a price came from. */
export const poolLink = (pool: string) => `https://www.geckoterminal.com/solana/pools/${pool}`;

export const byPreTicker = (ticker: string): PreStock | undefined =>
  PRESTOCKS.find((p) => p.ticker === ticker.toUpperCase());

/** Roughly what one token is worth, as of the file. Live prices come from the route. */
export const seenPrice = (p: PreStock) => p.seen.priceUsd;
