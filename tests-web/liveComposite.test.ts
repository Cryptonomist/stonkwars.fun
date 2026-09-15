/* The live 24/7 median a page shows while the exchange is shut. Each parser is
 * held to the shape its venue really answered with (one request each, 15 Sep
 * 2026, 03:48 UTC, AAPL's rows kept as they came), and the median to the same
 * quorum and guard as a composite minute. */

import { expect } from "chai";

import { COMPOSITE_FROM, VENUE_ORDER } from "../src/lib/composite";
import { liveMedianAt, parseTickers, pinnedAt, tickerRequest } from "../src/lib/liveComposite";
import { liveSourceFor } from "../src/lib/livePrice";
import { nyToMs } from "../src/lib/market";
import { sourceWords } from "../src/lib/pricemath";
import { byTicker } from "../src/lib/stocks";
import { inputsAt } from "../src/lib/venues247";

/* What each venue answered for AAPL, trimmed to the fields read and one
 * neighbour, exactly as the values came. */
const ANSWERS = {
  hyperliquid: { "xyz:AAPL": "331.345", "xyz:TSLA": "359.6" },
  okx: { code: "0", data: [{ instId: "AAPL-USDT-SWAP", last: "331.36" }, { instId: "BTC-USDT-SWAP", last: "0" }] },
  bitget: { code: "00000", data: [{ symbol: "AAPLUSDT", lastPr: "331.63" }] },
  binance: [
    { symbol: "TSLABUSDT", price: "359.54000000" },
    { symbol: "AAPLBUSDT", price: "331.61000000" },
  ],
  lighter: { code: 200, order_book_details: [{ symbol: "AAPL", market_id: 113, last_trade_price: 331.443 }] },
  backpack: [{ symbol: "AAPL.US_USDC_PERP", lastPrice: "331.44" }],
  gate: [{ contract: "AAPL_USDT", last: "331.49" }],
  mexc: { success: true, data: [{ symbol: "AAPLSTOCK_USDT", lastPrice: 331.59 }] },
  bingx: { code: 0, data: [{ symbol: "NCSKAAPL2USD-USDT", lastPrice: "331.60" }] },
} as const;

const AT = COMPOSITE_FROM + 86_400;

describe("the live 24/7 median", () => {
  it("reads each venue's bulk answer for the instrument pinned for the stock", () => {
    const pinned = Object.fromEntries(inputsAt("AAPL", AT).map((i) => [i.venue, i.instrument]));
    expect(Object.keys(pinned).sort()).to.deep.equal([...VENUE_ORDER].sort());
    const read = Object.fromEntries(VENUE_ORDER.map((v) => [v, parseTickers(v, ANSWERS[v])[pinned[v]]]));
    expect(read).to.deep.equal({
      hyperliquid: "331.345",
      okx: "331.36",
      bitget: "331.63",
      binance: "331.61000000",
      lighter: "331.443",
      backpack: "331.44",
      gate: "331.49",
      mexc: "331.59",
      bingx: "331.60",
    });
    // A zero is not a price.
    expect(parseTickers("okx", ANSWERS.okx)).to.not.have.property("BTC-USDT-SWAP");
    expect(parseTickers("gate", { error: "rate limited" })).to.deep.equal({});
  });

  it("is the median of those nine, 331.49, through the composite minute's quorum and guard", () => {
    const prices = Object.fromEntries(VENUE_ORDER.map((v) => [v, parseTickers(v, ANSWERS[v])]));
    expect(liveMedianAt("AAPL", AT, prices)).to.deep.equal({ ticks: 3_314_900n, markets: 9 });
    // A print 10% out is dropped by the guard: the median of the other eight, between 331.443 and 331.59.
    const pushed = { ...prices, gate: { AAPL_USDT: "364.64" } };
    expect(liveMedianAt("AAPL", AT, pushed)).to.deep.equal({ ticks: 3_315_165n, markets: 9 });
  });

  it("has no live price without 3 markets, 2 of them anchors, and none before the pins start", () => {
    const prices = Object.fromEntries(VENUE_ORDER.map((v) => [v, parseTickers(v, ANSWERS[v])]));
    const only = (venues: string[]) => Object.fromEntries(Object.entries(prices).filter(([v]) => venues.includes(v)));
    expect(liveMedianAt("AAPL", AT, only(["gate", "mexc", "bingx", "okx"]))).to.equal(null);
    expect(liveMedianAt("AAPL", AT, only(["okx", "bitget"]))).to.equal(null);
    expect(liveMedianAt("AAPL", AT, only(["okx", "bitget", "gate"]))).to.deep.equal({ ticks: 3_314_900n, markets: 3 });
    expect(liveMedianAt("AAPL", COMPOSITE_FROM - 1, prices)).to.equal(null);
  });

  it("names Binance's pinned symbols in its one request, and asks every other venue for all of its markets", () => {
    const symbols = pinnedAt("binance", AT);
    expect(symbols).to.include("AAPLBUSDT");
    expect(decodeURIComponent(tickerRequest("binance", symbols).url)).to.equal(
      `https://data-api.binance.vision/api/v3/ticker/price?symbols=${JSON.stringify(symbols)}`,
    );
    expect(tickerRequest("hyperliquid", []).init?.body).to.equal('{"type":"allMids","dex":"xyz"}');
    expect(pinnedAt("okx", COMPOSITE_FROM - 1)).to.deep.equal([]);
  });

  it("is the live source of a 24/7 stock while the exchange is shut after the cutover, and says so", () => {
    const saturday = Math.floor(nyToMs(2026, 9, 19, 12, 0) / 1000);
    expect(liveSourceFor(byTicker("AAPL")!, saturday)).to.equal("composite");
    expect(liveSourceFor(byTicker("TSLA")!, saturday)).to.equal("composite");
    expect(liveSourceFor(byTicker("KO")!, saturday)).to.equal("last");
    expect(sourceWords("composite")).to.equal("24/7 median");
  });
});
