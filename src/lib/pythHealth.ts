/* IS PYTH ANSWERING? A fight must not be made on a price nobody can fetch.
 *
 * Pyth's prices are public and signed, but reading them takes a key, and a key
 * can lapse (ours is a trial). When it does, nothing on the page breaks: the
 * live price quietly falls back to the exchange's (marketPrices.server.ts), so
 * the ticket would size a stake and let somebody make a fight whose start
 * price can never be posted. It would sit there until the week-long stall
 * refund, in front of whoever was looking.
 *
 * So the pages ask the one thing they can see: for a stock the chain prices by
 * Pyth, at a moment Pyth's feed should be printing, did the live quote come
 * from Pyth? If it did not, Pyth is not answering us, and the fight is refused
 * with a sentence that says so. While Pyth's own market is shut the quote is
 * rightly not Pyth's, and the hours rules (stocks.ts) already speak for that,
 * so this stays silent. It also stays silent until a quote has loaded: no
 * answer yet is not the same as a wrong one. */

import { pythPricesAt } from "./market";
import type { Quote } from "./pricemath";

export const PYTH_DOWN =
  "Pyth is not answering right now, and this stock's price comes from Pyth, so a fight on it could not start. Pick another stock, or try again shortly.";

/** `pythTickers`: the sides of this fight the chain prices by Pyth. */
export function pythDownFor(
  pythTickers: string[],
  quotes: Record<string, Quote | undefined> | undefined,
  now: number,
): string | null {
  if (!pythTickers.length || !quotes || !pythPricesAt(now)) return null;
  for (const t of pythTickers) {
    const q = quotes[t];
    if (q && q.source !== "pyth") return PYTH_DOWN;
  }
  return null;
}
