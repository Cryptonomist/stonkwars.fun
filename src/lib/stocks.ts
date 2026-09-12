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

import poolsJson from "@/data/pools.json";
import rosterJson from "@/data/roster.json";
import { type StakeAsset } from "@/lib/duel";

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
  return { symbol: s.quote, currency: s.currency, market: s.market, pool: POOLS[s.ticker]?.pool };
}

/** Whether a stock can settle a fight outside its exchange's hours. */
export const tradesAroundTheClock = (ticker: string) => !!POOLS[ticker];

/** How many of the roster can, for the pages that say so. */
export const AROUND_THE_CLOCK = Object.keys(POOLS).length;

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

/** "NVDAx": the symbol of the token a stock is staked as here. */
export const tokenSymbol = (ticker: string) => tokensFor(ticker)[0]?.symbol ?? `${ticker}x`;

/** How a stock is priced, in the words the page uses. */
export const sourceLabel = (s: Pick<Stock, "source">) =>
  s.source === "pyth" ? "Pyth" : "Stonk Wars oracle";
