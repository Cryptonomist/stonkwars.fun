/* Which token a stock trades as, and what a quote means. Server and tests only:
 * it carries the full mainnet token list, which has no business in a page. */

import mainnetTokens from "@/data/stocks.mainnet-beta.json";

import { fromAtomic, PAY, type JupiterQuote, type PayWith, type QuoteSummary, type Side } from "./swap";

type MainnetToken = { ticker: string; symbol: string; issuer: string; mint: string; decimals: number; tokenProgram: string };
const TOKENS: MainnetToken[] = (mainnetTokens as { tokens: MainnetToken[] }).tokens;

/** The token a trade buys or sells for a stock: the xStocks token where there is one. */
export function mainnetStockToken(ticker: string): MainnetToken | null {
  const all = TOKENS.filter((t) => t.ticker === ticker);
  return all.find((t) => t.issuer === "xStocks") ?? all[0] ?? null;
}

export type Leg = { mint: string; decimals: number; tokenProgram: string; symbol: string };
export type Pair = { input: Leg; output: Leg; stock: MainnetToken };

export function pairFor(side: Side, ticker: string, pay: PayWith): Pair | null {
  const stock = mainnetStockToken(ticker);
  if (!stock) return null;
  const s: Leg = { mint: stock.mint, decimals: stock.decimals, tokenProgram: stock.tokenProgram, symbol: stock.symbol };
  const p: Leg = PAY[pay];
  return side === "buy" ? { input: p, output: s, stock } : { input: s, output: p, stock };
}

/** What a quote's two mints are, if they are a trade this site offers, and nothing else. */
export function tradeFor(inputMint: string, outputMint: string): { ticker: string; side: Side; pay: PayWith; pair: Pair } | null {
  for (const pay of Object.keys(PAY) as PayWith[]) {
    const payMint = PAY[pay].mint;
    const side: Side | null = inputMint === payMint ? "buy" : outputMint === payMint ? "sell" : null;
    if (!side) continue;
    const stockMint = side === "buy" ? outputMint : inputMint;
    const stock = TOKENS.find((t) => t.mint === stockMint);
    if (!stock) continue;
    const pair = pairFor(side, stock.ticker, pay);
    if (pair && pair.stock.mint === stockMint) return { ticker: stock.ticker, side, pay, pair };
  }
  return null;
}

export function summarize(q: JupiterQuote, side: Side, ticker: string, pay: PayWith): QuoteSummary | null {
  const pair = pairFor(side, ticker, pay);
  if (!pair || q.inputMint !== pair.input.mint || q.outputMint !== pair.output.mint) return null;
  const inAmt = fromAtomic(q.inAmount, pair.input.decimals);
  const outAmt = fromAtomic(q.outAmount, pair.output.decimals);
  const feeAmt = q.platformFee && q.platformFee.feeBps > 0 ? fromAtomic(q.platformFee.amount, pair.output.decimals) : 0;
  const shares = side === "buy" ? outAmt + feeAmt : inAmt;
  const money = side === "buy" ? inAmt : outAmt + feeAmt;
  return {
    side,
    ticker,
    pay,
    stockSymbol: pair.stock.symbol,
    stockDecimals: pair.stock.decimals,
    input: { symbol: pair.input.symbol, amount: inAmt },
    output: { symbol: pair.output.symbol, amount: outAmt, minimum: fromAtomic(q.otherAmountThreshold, pair.output.decimals) },
    pricePerShare: shares > 0 ? money / shares : 0,
    priceImpactPct: Number(q.priceImpactPct) * 100,
    route: [...new Set(q.routePlan.map((r) => r.swapInfo.label).filter((l): l is string => !!l))],
    fee: feeAmt > 0 && q.platformFee ? { bps: q.platformFee.feeBps, amount: feeAmt, symbol: pair.output.symbol } : null,
  };
}
