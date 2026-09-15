/* A 24/7 STOCK'S PRICE RIGHT NOW, FOR THE PAGE.
 *
 * While the exchange is shut a fight is priced by the composite (composite.ts):
 * the median of three finished minutes of the venues pinned for the stock,
 * each corrected by its premium, stamped after the window has closed. A page
 * showing a stock's price now cannot wait for that, and asking every venue for
 * its minute candles for every tile on screen would be hundreds of requests.
 *
 * So the live price is the same pinned markets' latest prices, from one bulk
 * request per venue that answers for all of its stocks at once: the last trade
 * at OKX, Bitget, Binance, Lighter, Backpack, Gate, MEXC and BingX, and the
 * order book's mid at Hyperliquid, which publishes no bulk last trade. Each
 * stock's value is their median through the same quorum and guard as one
 * composite minute (minuteMedian: at least 3 markets, 2 of them anchors, and
 * anything 50 bps from the median dropped). Too few answers, and there is no
 * live price: the page keeps the last one it had rather than invent one.
 *
 * Real prices, never a model, and never an input to a result: the program
 * reads only the boundary prices a crank posts. It is not the premium-corrected
 * median a fight settles on, and can sit a few basis points from it, so the
 * page labels it "24/7 median", not the settle price. The shapes were read from
 * each venue's live answer on 15 Sep 2026 (one request each).
 *
 * Pure, so the tests hold every parser to a real answer; the server fetches
 * (liveComposite.server.ts). */

import { closeText, minuteMedian, QUORUM, QUORUM_ANCHORS, toTicks, VENUES, type VenueId } from "./composite";
import { inputsAt, VENUES247, type Venues247 } from "./venues247";

export type TickerRequest = { url: string; init?: { method: "POST"; headers: Record<string, string>; body: string } };

/** Every pinned instrument at a venue, for the one request that needs them named. */
export const pinnedAt = (venue: VenueId, at: number, file: Venues247 = VENUES247): string[] =>
  [...new Set(Object.keys(file.tickers).flatMap((t) => inputsAt(t, at, file).filter((i) => i.venue === venue).map((i) => i.instrument)))].sort();

/** The one bulk request a venue answers every pinned market's latest price with. */
export function tickerRequest(venue: VenueId, instruments: readonly string[]): TickerRequest {
  switch (venue) {
    case "hyperliquid":
      return {
        url: "https://api.hyperliquid.xyz/info",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids", dex: "xyz" }) },
      };
    case "okx":
      return { url: "https://www.okx.com/api/v5/market/tickers?instType=SWAP" };
    case "bitget":
      return { url: "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES" };
    case "binance":
      // The whole list would be every Binance symbol; naming the pinned ones keeps it to a few hundred bytes.
      return { url: `https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(instruments))}` };
    case "lighter":
      return { url: "https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails" };
    case "backpack":
      return { url: "https://api.backpack.exchange/api/v1/tickers" };
    case "gate":
      return { url: "https://api.gateio.ws/api/v4/futures/usdt/tickers" };
    case "mexc":
      return { url: "https://contract.mexc.com/api/v1/contract/ticker" };
    case "bingx":
      return { url: "https://open-api.bingx.com/openApi/swap/v2/quote/ticker" };
  }
}

type Row = Record<string, unknown>;
const rows = (x: unknown): Row[] => (Array.isArray(x) ? x.filter((r): r is Row => !!r && typeof r === "object") : []);
const field = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Row)[k] : undefined);

/** A venue's bulk answer as instrument -> price text, positive prices only. */
export function parseTickers(venue: VenueId, body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: unknown, price: unknown) => {
    const text = closeText(price);
    const ticks = text === null ? null : toTicks(text);
    if (typeof id === "string" || typeof id === "number") {
      if (ticks !== null && ticks > 0n) out[String(id)] = text!;
    }
  };
  switch (venue) {
    case "hyperliquid":
      if (body && typeof body === "object" && !Array.isArray(body)) for (const [coin, mid] of Object.entries(body)) put(coin, mid);
      break;
    case "okx":
      for (const r of rows(field(body, "data"))) put(r.instId, r.last);
      break;
    case "bitget":
      for (const r of rows(field(body, "data"))) put(r.symbol, r.lastPr);
      break;
    case "binance":
      for (const r of rows(body)) put(r.symbol, r.price);
      break;
    case "lighter":
      for (const r of rows(field(body, "order_book_details"))) put(r.market_id, r.last_trade_price);
      break;
    case "backpack":
      for (const r of rows(body)) put(r.symbol, r.lastPrice);
      break;
    case "gate":
      for (const r of rows(body)) put(r.contract, r.last);
      break;
    case "mexc":
      for (const r of rows(field(body, "data"))) put(r.symbol, r.lastPrice);
      break;
    case "bingx":
      for (const r of rows(field(body, "data"))) put(r.symbol, r.lastPrice);
      break;
  }
  return out;
}

export type LiveMedian = { ticks: bigint; markets: number };

/** A stock's live 24/7 median at `at` from each venue's latest prices, or null
 *  when fewer than 3 pinned markets (2 of them anchors) answered. */
export function liveMedianAt(
  ticker: string,
  at: number,
  prices: Partial<Record<VenueId, Record<string, string>>>,
  file: Venues247 = VENUES247,
): LiveMedian | null {
  const inputs = inputsAt(ticker, at, file).flatMap((i) => {
    const text = prices[i.venue]?.[i.instrument];
    const ticks = text === undefined ? null : toTicks(text);
    return ticks !== null && ticks > 0n ? [{ anchor: VENUES[i.venue].anchor, value: ticks }] : [];
  });
  if (inputs.length < QUORUM || inputs.filter((x) => x.anchor).length < QUORUM_ANCHORS) return null;
  return { ticks: minuteMedian(inputs).value, markets: inputs.length };
}
