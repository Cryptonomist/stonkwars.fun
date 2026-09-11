/* DEVELOPMENT ONLY: a synthetic price for any stock at any second.
 *
 * Shared by /api/prices (under DEV_FAKE_PRICES=1) and scripts/dev-crank.ts, so
 * that on a local validator the live board and the settled result agree with
 * each other. Nothing in a real deployment reads this. */

export const DEV_BASE: Record<string, number> = {
  NVDA: 211.02, TSLA: 364.11, AAPL: 305.92, MSFT: 512.4, GOOGL: 238.7, AMZN: 241.3, META: 781.2,
  AMD: 188.4, PLTR: 176.9, COIN: 331.5, HOOD: 128.2, MSTR: 402.6, SPY: 765.48, QQQ: 612.3,
};

const ORDER = Object.keys(DEV_BASE);

/** Mantissa at expo -5 for `ticker` at unix second `t`. */
export function devPrice(ticker: string, t: number): bigint {
  const i = Math.max(0, ORDER.indexOf(ticker));
  const base = DEV_BASE[ticker] ?? 100;
  const wobble = 1 + 0.006 * Math.sin(t / 97 + i) + 0.003 * Math.sin(t / 13 + 2 * i);
  return BigInt(Math.round(base * wobble * 1e5));
}

export const DEV_EXPO = -5;
