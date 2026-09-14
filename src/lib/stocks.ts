/* The roster: every tokenized stock that can fight, where its price comes from,
 * and (per cluster) the tokens it can be staked as.
 *
 * src/data/roster.json is built by scripts/build-roster.ts from live data: the
 * issuers' token lists, Pyth's feed list, and the market data source. Each
 * stock has one feed id, the same on every cluster and for every issuer: the
 * Pyth feed id where Pyth lists the stock, or a derived one where it does not.
 *
 * `source` says who prices it on this deployment. "pyth": Pyth updates, checked
 * on chain, trusting nobody. "signed": the oracle's quotes, from the stock's
 * one-minute bars (lib/oracle.ts). The registry on chain records the same
 * choice; setup reads it from here.
 *
 * Tokens are per cluster. On devnet and localnet they are test mints the setup
 * script creates, one per stock; on mainnet they are the issuers' tokenized
 * shares, sometimes several issuers for one stock.
 */

import { PublicKey } from "@solana/web3.js";

import perpsJson from "@/data/perps.json";
import poolsJson from "@/data/pools.json";
import rosterJson from "@/data/roster.json";
import { type DuelView, type StakeAsset } from "@/lib/duel";
import { nyParts, openingAfter, session } from "@/lib/market";

export type Stock = {
  ticker: string;
  name: string;
  kind: "stock" | "etf";
  market: string;
  currency: string;
  /** Feed id, hex, no 0x. */
  feed: string;
  /** True when `feed` is a real Pyth feed id. */
  pyth: boolean;
  source: "pyth" | "signed";
  /** The stock's symbol at the market data source. */
  quote: string;
  /** Accent for the ticker badge. */
  color: string;
  /** Who tokenizes it on Solana mainnet. */
  issuers: string[];
};

export type Token = {
  ticker: string;
  symbol: string;
  issuer: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
};

/* Test clusters list their mints compactly, since every test token is the
 * setup script's: 8 decimals, Token-2022. */
const TEST_TOKEN = { issuer: "test", decimals: 8, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" };

export const ROSTER = rosterJson as Stock[];

/* The Solana pool that prices each stock when its exchange is shut, pinned so
 * that anyone can read the same number we did. Stocks missing from it have no
 * pool deep enough to be worth reading, and keep exchange hours. */
const POOLS = poolsJson as Record<string, { pool: string; liquidityUsd: number; volume24hUsd: number; at: string }>;

/* The perpetual market that prices each stock when its exchange is shut. It
 * prints every minute, including weekends, which a pool does not, so it is
 * preferred over one. Every entry was checked to be the same company as the
 * stock it prices; see scripts/build-perps.ts. */
const PERPS = perpsJson as Record<
  string,
  { coin: string; notional24h: number; minutesPerHour: number; markVsMarket: number; at: string }
>;

export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as "devnet" | "localnet" | "mainnet-beta";

/* Only this cluster's token list goes into the bundle. NEXT_PUBLIC_CLUSTER is
 * a literal at build time, so the bundler drops the other branches, and with
 * them a thousand-odd mints nobody on this cluster can use. */
/* eslint-disable @typescript-eslint/no-require-imports */
const deployment: { tokens?: (Pick<Token, "ticker" | "symbol" | "mint"> & Partial<Token>)[] } =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet-beta"
    ? require("@/data/stocks.mainnet-beta.json")
    : process.env.NEXT_PUBLIC_CLUSTER === "localnet"
      ? require("@/data/stocks.localnet.json")
      : require("@/data/stocks.devnet.json");
/* eslint-enable @typescript-eslint/no-require-imports */

/** Every token that can be staked on this cluster. */
export const TOKENS: Token[] = (deployment.tokens ?? []).map((t) => ({ ...TEST_TOKEN, ...t }));

const tokensByTicker = new Map<string, Token[]>();
for (const t of TOKENS) tokensByTicker.set(t.ticker, [...(tokensByTicker.get(t.ticker) ?? []), t]);
const tokenByMint = new Map(TOKENS.map((t) => [t.mint, t]));

/** Stocks with at least one stakeable token here, in roster order. */
export const STAKEABLE = ROSTER.filter((s) => tokensByTicker.has(s.ticker));

/* Tokenized shares carry 8 decimals across the board (xStocks, and the test
 * mints). Anything that shows an amount for a specific mint should still ask
 * decimalsForMint. */
export const STAKE_DECIMALS = TOKENS[0]?.decimals ?? 8;

export const byTicker = (ticker: string) => ROSTER.find((s) => s.ticker === ticker);
export const byFeed = (feed: string) =>
  ROSTER.find((s) => s.feed === feed.replace(/^0x/, "").toLowerCase());

/* WHERE A STOCK'S PRICE COMES FROM, BY FEED ID.
 *
 * Its symbol at the market data source and the currency that source quotes it
 * in, plus the Solana pool that prices it while its exchange is shut. A stock
 * with no pinned pool keeps exchange hours; see scripts/build-pools.ts. */
export function quoteSymbolFor(feed: string) {
  const s = byFeed(feed);
  if (!s) return undefined;
  return {
    symbol: s.quote,
    currency: s.currency,
    market: s.market,
    pool: POOLS[s.ticker]?.pool,
    perp: PERPS[s.ticker]?.coin,
  };
}

/** Whether a stock can settle a fight outside its exchange's hours. Pyth's
 *  equity feeds print in the regular session only, so a Pyth-priced stock
 *  keeps those hours however busy its off-hours markets are. */
export const tradesAroundTheClock = (ticker: string) => {
  const s = byTicker(ticker);
  return !!s && s.source !== "pyth" && (!!PERPS[ticker] || !!POOLS[ticker]);
};

/* WHEN A SIDE'S PRICE AT `boundary` CAN BEGIN TO EXIST.
 *
 * Every side of a fight is priced at its own first price at or after a
 * boundary, and this is the moment that price can first appear: the boundary
 * itself when something prices the stock then, or else the opening it waits
 * for. It is the one answer the pages build on, and it is the price clock's
 * answer (priceClock.ts), from the same openingAfter, so a page cannot let a
 * fight be taken on hours the crank does not price it on. A test holds the
 * two together, second for second, across a holiday, an early close and a
 * daylight saving change (tests-web/stocks.test.ts).
 *
 *   Pyth, US          the regular session only, 9:30 to the close. Pyth's US
 *                     equity feeds do not print in pre-market or after-hours,
 *                     so a boundary at 7pm on a Friday waits for Monday 9:30.
 *   signed, perp/pool the boundary, always: the exchange's bars from 4am to
 *                     8pm, and the perp or pool whenever the exchange is shut.
 *   signed, neither   the exchange's bars, 4am to 8pm; shut, it waits for the
 *                     next 4am, as oracle.ts's exchangeBarFinal does.
 *   outside the US    the boundary: its own exchange's hours are not modelled,
 *                     so it is never called a wait.
 *
 * Unix seconds, never before the boundary. Null for a ticker off the roster,
 * or if nothing opens within ten days. */
export function firstPriceAt(ticker: string, boundary: number): number | null {
  const s = byTicker(ticker);
  if (!s) return null;
  if (s.market !== "US") return boundary;
  if (s.source === "pyth") return openingAfter(boundary, "regular");
  if (PERPS[ticker] || POOLS[ticker]) return boundary;
  return openingAfter(boundary, "extended");
}

/* WHERE A FIGHT ENDING AT `boundary` WOULD GET ITS PRICE.
 *
 * "waits" is the one worth saying out loud: the stock is real, the fight is
 * legal, and nothing will settle it until its market opens again. Somebody
 * picking TSLA at midnight should be told that before they stake, not after.
 *
 * It is firstPriceAt's answer in words. A Pyth stock waits outside the regular
 * session, pre-market and after-hours included: it used to be called priced
 * by its exchange whenever the exchange's bars ran, from 4am to 8pm, which is
 * not when Pyth prints. A listing outside the US keeps its own exchange's
 * hours, which we do not model, so it is never called a wait. */
export function pricedAt(ticker: string, boundary: number): "exchange" | "perp" | "pool" | "waits" {
  const s = byTicker(ticker);
  if (!s || firstPriceAt(ticker, boundary) !== boundary) return "waits";
  if (s.market !== "US" || session(boundary * 1_000) !== "closed") return "exchange";
  return PERPS[ticker] ? "perp" : "pool";
}

/* HOW FAR APART TWO SIDES' PRICES MAY START.
 *
 * In session, a Pyth side's price is a print a second or two after the
 * boundary and a bar-priced side's is the close of the minute the boundary
 * falls in, up to a minute later. Fights have always started and ended that
 * far apart, and nobody's round is decided by it. So two sides whose prices
 * can first exist within a minute of each other count as starting together:
 * TSLA at Monday's 9:30:00 print and NVDA at the pre-market bar that closes
 * then are as fair as any fight at noon. Beyond a minute the gap is the
 * fight. */
export const SAME_PRICE_SECS = 60;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "4:30 PM ET", for New York wall-clock parts. */
const clockWords = (p: { hh: number; mm: number }) =>
  `${p.hh % 12 || 12}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "AM" : "PM"} ET`;

/** "Monday 4:30 PM ET". */
function nyWords(unix: number): string {
  const p = nyParts(unix * 1_000);
  return `${WEEKDAY_NAMES[p.wd]} ${clockWords(p)}`;
}

/** "Monday's 9:30 AM ET opening bell", "Monday's 4:00 AM ET pre-market open". */
function openingWords(unix: number): string {
  const p = nyParts(unix * 1_000);
  const what = p.hh === 9 && p.mm === 30 ? " opening bell" : p.hh === 4 && p.mm === 0 ? " pre-market open" : "";
  return `${WEEKDAY_NAMES[p.wd]}'s ${clockWords(p)}${what}`;
}

/** "days", "hours" or "minutes": how far apart two prices would land, said plainly. */
const apart = (secs: number) => (secs >= 86_400 ? "days" : secs >= 3_600 ? "hours" : "minutes");

/* WHETHER TWO STOCKS CAN FIGHT FAIRLY, STARTING AT `start`.
 *
 * Each side's start is its own first price after the boundary, and so is each
 * side's end. When the two can first exist more than SAME_PRICE_SECS apart,
 * the fight is decided by the gap between them rather than by the round. That
 * happens three ways:
 *
 *   One side waits and the other trades now: TSLA (Pyth) at 7pm on a Friday
 *   against NVDA, which has after-hours bars. NVDA would start then and TSLA
 *   at Monday's opening bell, so the weekend would decide it.
 *
 *   Both wait, for different openings: TSLA on a Saturday against a stock
 *   with neither perp nor pool. One starts at Monday's 9:30 bell and the other
 *   at Monday's 4am pre-market.
 *
 *   The pair starts together but the round ends where they part: TSLA against
 *   NVDA, an hour from 3:30pm on a Monday. TSLA's session closes at 4, so the
 *   round would end on NVDA's 4:30 bar and on TSLA's Tuesday 9:30 print.
 *
 * Two that start and end together are fair whatever their markets. `round`
 * is the fight's end rule as the program holds it: a duration counted from
 * the later side's start price, or a fixed end. A duration's end is checked at
 * both ends of the minute that start price can take. Without `round` only the
 * start is checked.
 *
 * Returns the sentence that explains the unfair case, for the page to show
 * beside the button it disables, or null when the pair can fight. A ticker
 * off the roster is left alone: nothing here knows its hours. */
export function mixedHoursAt(
  a: string,
  b: string,
  start: number,
  round?: { durationSecs: number; endTs: number },
): string | null {
  const fa = firstPriceAt(a, start);
  const fb = firstPriceAt(b, start);
  if (fa === null || fb === null) return null;

  if (Math.abs(fa - fb) > SAME_PRICE_SECS) {
    const [early, late, fe, fl] = fa < fb ? [a, b, fa, fb] : [b, a, fb, fa];
    const gap = apart(fl - fe);
    if (fe - start <= SAME_PRICE_SECS) {
      return (
        `${late} waits for its exchange to open but ${early} trades now, so their start prices would be ${gap} apart. ` +
        "Pick two that both trade now, or two that both wait."
      );
    }
    return (
      `${early} would start at ${openingWords(fe)} but ${late} not until ${openingWords(fl)}, ` +
      `so their start prices would be ${gap} apart. Pick two that open at the same time, or two that both trade now.`
    );
  }

  if (!round) return null;
  const begins = Math.max(fa, fb);
  const ends =
    round.durationSecs > 0
      ? [begins + round.durationSecs, begins + SAME_PRICE_SECS + round.durationSecs]
      : round.endTs > 0
        ? [round.endTs]
        : [];
  for (const end of ends) {
    const ea = firstPriceAt(a, end);
    const eb = firstPriceAt(b, end);
    if (ea === null || eb === null || Math.abs(ea - eb) <= SAME_PRICE_SECS) continue;
    const [early, late, fe, fl] = ea < eb ? [a, b, ea, eb] : [b, a, eb, ea];
    const when = `${round.durationSecs > 0 ? "around" : "at"} ${nyWords(end)}`;
    const middle =
      fe - end <= SAME_PRICE_SECS
        ? `when ${early} still trades but ${late} waits for ${openingWords(fl)}`
        : `when neither trades, and ${early} would take its end price at ${openingWords(fe)} but ${late} not until ${openingWords(fl)}`;
    return (
      `This round would end ${when}, ${middle}, so their end prices would be ${apart(fl - fe)} apart. ` +
      "Pick a round that ends while both trade, or two that trade the same hours."
    );
  }
  return null;
}

/** How many of the roster can, for the pages that say so. */
export const AROUND_THE_CLOCK = ROSTER.filter((s) => tradesAroundTheClock(s.ticker)).length;

export const tokensFor = (ticker: string) => tokensByTicker.get(ticker) ?? [];

/** The token a stock is staked as on this cluster (its first issuer's), or
 * null if it has none. */
export function stakeAssetFor(ticker: string): StakeAsset | null {
  const t = tokensFor(ticker)[0];
  return t ? { mint: new PublicKey(t.mint), tokenProgram: new PublicKey(t.tokenProgram) } : null;
}

export function tokenForMint(mint: PublicKey | string): Token | undefined {
  return tokenByMint.get(typeof mint === "string" ? mint : mint.toBase58());
}

export const tickerForMint = (mint: PublicKey | string) => tokenForMint(mint)?.ticker;
export const decimalsForMint = (mint: PublicKey | string) => tokenForMint(mint)?.decimals ?? STAKE_DECIMALS;

/* WHETHER A FIGHT IS BETWEEN TWO LISTED STOCKS.
 *
 * The program takes any mint, and early test fights were staked in test BTC,
 * ETH and SOL, or in mints this cluster's token list no longer names at all.
 * They stay on chain, but they are not stock fights: counted, they swamp the
 * tally with test crypto and fill the boards with "? VS ?" rows. Both sides
 * must map to a token here and that token's ticker must be on the roster. */
export function isListedDuel(d: Pick<DuelView, "creatorMint" | "opponentMint">): boolean {
  const listed = (mint: PublicKey) => {
    const ticker = tickerForMint(mint);
    return !!ticker && !!byTicker(ticker);
  };
  return listed(d.creatorMint) && listed(d.opponentMint);
}

/** "NVDAx": the symbol of the token a stock is staked as here. */
export const tokenSymbol = (ticker: string) => tokensFor(ticker)[0]?.symbol ?? `${ticker}x`;

/** How a stock is priced, in the words the page uses. */
export const sourceLabel = (s: Pick<Stock, "source">) =>
  s.source === "pyth" ? "Pyth" : "Stonk Wars oracle";
