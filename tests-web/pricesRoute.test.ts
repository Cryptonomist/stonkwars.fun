/* /api/prices when the market data source is down. Every board and every
 * ticket reads this route, so what it does on a bad minute decides whether the
 * site shows prices or blanks: a stock it has priced before keeps its last
 * known price, a failure is never cached at the edge, and it never throws.
 * No network: fetch is stubbed, and the clock is moved past the route's cache. */

import { expect } from "chai";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/prices/route";

/* Two US stocks that are not priced by Pyth and not pinned to the 24/7 venues,
 * so at any hour their price is the exchange's and the stub below is the only
 * thing answering. Nothing else in the suite asks this route about them. */
const T1 = "GME";
const T2 = "UBER";

const spark = (url: string, price: number) => {
  const symbols = decodeURIComponent(new URL(url).searchParams.get("symbols") ?? "").split(",");
  return {
    spark: {
      result: symbols.map((symbol) => ({
        symbol,
        response: [{ meta: { regularMarketPrice: price, regularMarketTime: 1_789_000_000 }, indicators: { quote: [{ close: [price - 1, price] }] } }],
      })),
    },
  };
};

const ask = (t: string) => GET(new NextRequest(`http://localhost/api/prices?t=${t}`));

describe("/api/prices when the source is down", () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  afterEach(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  });

  it("refuses a request that names no stock, without asking anybody", async () => {
    let asked = 0;
    globalThis.fetch = (async () => {
      asked++;
      return new Response("{}");
    }) as typeof fetch;
    const r = await ask("NOT_A_TICKER");
    expect(r.status).to.equal(400);
    expect(asked).to.equal(0);
  });

  it("keeps the last known price when the source goes down, and says so to no cache", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(spark(String(input), 25.5)), { status: 200 })) as typeof fetch;
    const first = await ask(T1);
    expect(first.status).to.equal(200);
    expect(first.headers.get("cache-control")).to.contain("s-maxage=5");
    const price = ((await first.json()) as { quotes: Record<string, { price: string }> }).quotes[T1].price;
    expect(price).to.equal("255000");

    /* Six seconds on, past the route's own five second cache, and every
     * upstream is down. */
    const later = realNow() + 6_000;
    Date.now = () => later;
    globalThis.fetch = (async () => {
      throw new Error("connect ETIMEDOUT");
    }) as typeof fetch;
    const second = await ask(T1);
    expect(second.status).to.equal(200);
    const body = (await second.json()) as { quotes: Record<string, { price: string }>; error?: string };
    expect(body.quotes[T1].price).to.equal("255000", "the last price it knew");
    expect(body.error).to.equal(undefined);
  });

  it("answers a stock it has never priced with no quote rather than an error page", async () => {
    globalThis.fetch = (async () => new Response("upstream is on fire", { status: 503 })) as typeof fetch;
    const r = await ask(T2);
    expect(r.status).to.be.oneOf([200, 503]);
    const body = (await r.json()) as { quotes: Record<string, unknown>; at: number };
    expect(body.quotes).to.deep.equal({});
    expect(body.at).to.be.a("number");
    if (r.status === 503) expect(r.headers.get("cache-control")).to.equal("no-store");
  });
});
