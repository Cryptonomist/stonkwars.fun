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
import { session } from "@/lib/market";

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
 *  equity feeds stop publishing with the market, so a Pyth-priced stock keeps
 *  exchange hours however busy its off-hours markets are. */
export const tradesAroundTheClock = (ticker: string) => {
  const s = byTicker(ticker);
  return !!s && s.source !== "pyth" && (!!PERPS[ticker] || !!POOLS[ticker]);
};

/* WHERE A FIGHT ENDING AT `boundary` WOULD GET ITS PRICE.
 *
 * "waits" is the one worth saying out loud: the stock is real, the fight is
 * legal, and nothing will settle it until its market opens again. Somebody
 * picking TSLA at midnight should be told that before they stake, not after.
 *
 * A listing outside the US keeps its own exchange's hours, which we do not
 * model, so it is never called a wait. */
export function pricedAt(ticker: string, boundary: number): "exchange" | "perp" | "pool" | "waits" {
  const s = byTicker(ticker);
  if (!s) return "waits";
  if (s.market !== "US" || session(boundary * 1_000) !== "closed") return "exchange";
  if (!tradesAroundTheClock(ticker)) return "waits";
  return PERPS[ticker] ? "perp" : "pool";
}

/* WHETHER TWO STOCKS CAN START A FIGHT FAIRLY AT `start`.
 *
 * Each side's start is its own first price after the boundary. When one stock
 * waits for its exchange and the other trades now, those two prices land hours
 * or days apart, and the fight is decided by the gap between them rather than
 * by the round. Two that both wait start together at the open, and two that
 * both trade start together now; either is fair. Returns the sentence that
 * explains the unfair case, for the page to show beside the button it
 * disables, or null when the pair can start.
 *
 * A ticker off the roster is left alone: pricedAt calls it a wait, but that
 * says nothing about its hours. */
export function mixedHoursAt(a: string, b: string, start: number): string | null {
  if (!byTicker(a) || !byTicker(b)) return null;
  const aWaits = pricedAt(a, start) === "waits";
  const bWaits = pricedAt(b, start) === "waits";
  if (aWaits === bWaits) return null;
  const [waits, trades] = aWaits ? [a, b] : [b, a];
  return (
    `${waits} waits for its exchange to open but ${trades} trades now, so their start prices would be days apart. ` +
    "Pick two that both trade now, or two that both wait."
  );
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
