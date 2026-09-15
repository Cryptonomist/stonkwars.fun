/* Buying and selling tokenized stocks, the parts every side shares.
 *
 * A trade is a swap on Solana mainnet, routed by Jupiter, between a stock's
 * token and USDC or SOL. The user's own wallet signs it; Stonk Wars never holds
 * a key or a balance. The server asks Jupiter for the route and the unsigned
 * transaction (lib/jupiter.server.ts, app/api/swap); which token a stock trades
 * as lives in lib/swapPairs.ts, kept out of the browser bundle.
 *
 * Only mainnet has markets for these tokens, so on devnet the panel shows the
 * live mainnet quote for reference and the free test shares beside it, and the
 * server refuses to build a transaction. */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type Side = "buy" | "sell";
export type PayWith = "USDC" | "SOL";

export const PAY: Record<PayWith, { mint: string; decimals: number; tokenProgram: string; symbol: string }> = {
  USDC: { mint: USDC_MINT, decimals: 6, tokenProgram: TOKEN, symbol: "USDC" },
  SOL: { mint: SOL_MINT, decimals: 9, tokenProgram: TOKEN, symbol: "SOL" },
};

/** A decimal string to base units, exactly: no floats, extra decimals refused. */
export function toAtomic(amount: string, decimals: number): bigint | null {
  const m = /^\s*(\d*)(?:\.(\d*))?\s*$/.exec(amount);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export const fromAtomic = (atomic: bigint | string, decimals: number) => Number(BigInt(atomic)) / 10 ** decimals;

/* The platform's cut of a swap, in basis points. Set by the deployment, capped
 * here at 1%, and only charged when the server can pay it into a token account
 * the treasury actually has (see jupiter.server.ts). */
export const MAX_SWAP_FEE_BPS = 100;
export const swapFeeBps = (raw = process.env.NEXT_PUBLIC_SWAP_FEE_BPS) => {
  const n = Math.floor(Number(raw ?? 0));
  return Number.isFinite(n) ? Math.min(MAX_SWAP_FEE_BPS, Math.max(0, n)) : 0;
};

/** The USDC a buy starts at for shares worth `usd`: 3% over (price moves, any fee), whole dollars, at least $5. */
export const buyAmountFor = (usd: number | null | undefined) =>
  String(Math.max(5, Math.ceil((usd != null && Number.isFinite(usd) ? usd : 25) * 1.03)));

export const SLIPPAGE_CHOICES = [50, 100, 200] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Jupiter's quote, as much of it as this site reads. */
export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: { amount: string; feeBps: number } | null;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
};

export type QuoteSummary = {
  side: Side;
  ticker: string;
  pay: PayWith;
  stockSymbol: string;
  stockDecimals: number;
  input: { symbol: string; amount: number };
  output: { symbol: string; amount: number; minimum: number };
  /** USDC or SOL per share, before the fee. */
  pricePerShare: number;
  priceImpactPct: number;
  route: string[];
  fee: { bps: number; amount: number; symbol: string } | null;
};

export type QuoteResponse = {
  quote: JupiterQuote;
  summary: QuoteSummary;
  feeAccount: string | null;
  /** The configured rate, and why it is or is not charged on this quote (jupiter.server.ts FeeStatus). */
  feeStatus: { bps: number; status: string };
  at: number;
};
