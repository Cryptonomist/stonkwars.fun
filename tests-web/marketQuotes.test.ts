/* The live price path when its source misbehaves. Everything here is a failure
 * branch: a batch that errors, a source that never answers, a symbol left out,
 * a currency with no rate, a price of zero. The rule they share is the one in
 * the function's own comment: what the source does not answer for is left out,
 * and it never fails the rest. No network: fetch is stubbed. */

import { expect } from "chai";

import { marketQuotes } from "../src/lib/marketPrices.server";
import { fxFor } from "../src/lib/oracle";
import { ROSTER, type Stock } from "../src/lib/stocks";

type Answer = { price?: number; closes?: (number | null)[]; prevClose?: number; time?: number };

const spark = (answers: Record<string, Answer>) => ({
  spark: {
    result: Object.entries(answers).map(([symbol, a]) => ({
      symbol,
      response: [
        {
          meta: { regularMarketPrice: a.price, regularMarketTime: a.time ?? 1_789_000_000, chartPreviousClose: a.prevClose },
          indicators: { quote: [{ close: a.closes ?? [] }] },
        },
      ],
    })),
  },
});

const symbolsIn = (url: string) => decodeURIComponent(new URL(url).searchParams.get("symbols") ?? "").split(",");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const US = ROSTER.filter((s) => s.market === "US" && s.currency === "USD");
const HK = ROSTER.find((s) => s.market === "HK" && s.currency === "HKD") as Stock;

describe("live prices when the source misbehaves", () => {
  const real = globalThis.fetch;
  let calls: string[] = [];
  const stub = (handler: (url: string) => Response | Promise<Response>) => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return handler(url);
    }) as typeof fetch;
  };
  afterEach(() => {
    globalThis.fetch = real;
  });

  it("keeps the batches that answered when one batch errors", async () => {
    const stocks = US.slice(0, 25);
    const firstBatch = new Set(stocks.slice(0, 20).map((s) => s.quote));
    stub((url) => {
      const asked = symbolsIn(url);
      if (asked.some((s) => firstBatch.has(s))) return json({ error: "rate limited" }, 429);
      return json(spark(Object.fromEntries(asked.map((s) => [s, { price: 100, closes: [98, 99, 100] }]))));
    });
    const quotes = await marketQuotes(stocks);
    expect(calls).to.have.length(2);
    expect(Object.keys(quotes).sort()).to.deep.equal(stocks.slice(20).map((s) => s.ticker).sort());
  });

  it("answers with nothing, and does not throw, when the source never answers", async () => {
    stub(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await marketQuotes(US.slice(0, 3))).to.deep.equal({});
  });

  it("leaves out a symbol the source skipped, and a price that is not a price", async () => {
    const [a, b, c] = US.slice(0, 3);
    stub(() => json(spark({ [a.quote]: { price: 250.5, closes: [240, 250.5] }, [c.quote]: { price: 0, closes: [10, 0] } })));
    const quotes = await marketQuotes([a, b, c]);
    expect(Object.keys(quotes)).to.deep.equal([a.ticker]);
    expect(quotes[a.ticker].price).to.equal("2505000");
    expect(quotes[a.ticker].expo).to.equal(-4);
  });

  it("measures the day from the close before the latest, or the source's own previous close", async () => {
    const [a, b] = US.slice(0, 2);
    stub(() => json(spark({ [a.quote]: { price: 102, closes: [99, null, 100, 102] }, [b.quote]: { price: 50, closes: [50], prevClose: 48 } })));
    const quotes = await marketQuotes([a, b]);
    expect(quotes[a.ticker].prev).to.equal("1000000", "the session before the latest, skipping the gap");
    expect(quotes[b.ticker].prev).to.equal("480000", "one close is not enough, so the source's previous close");
  });

  it("leaves a foreign listing out rather than price it in the wrong currency", async () => {
    const fx = fxFor(HK.currency)!;
    stub(() => json(spark({ [HK.quote]: { price: 80, closes: [79, 80] } })));
    expect(await marketQuotes([HK])).to.deep.equal({}, "no rate, no dollars, no quote");

    stub(() => json(spark({ [HK.quote]: { price: 80, closes: [79, 80] }, [fx.symbol]: { price: 0.128, closes: [0.128, 0.128] } })));
    const quotes = await marketQuotes([HK]);
    const dollars = Number(quotes[HK.ticker].price) / 1e4;
    expect(dollars).to.be.closeTo(80 * 0.128 * fx.scale, 0.001);
  });
});
