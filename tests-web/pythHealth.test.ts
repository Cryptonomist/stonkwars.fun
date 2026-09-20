/* The guard for a lapsed Pyth key. When Pyth stops answering, the live price
 * falls back to the exchange's without a sound, and a fight made on a Pyth
 * stock then could never start. These pin when the pages refuse, and just as
 * much when they must stay quiet. */

import { expect } from "chai";

import { pythPricesAt } from "../src/lib/market";
import type { Quote } from "../src/lib/pricemath";
import { PYTH_DOWN, pythDownFor } from "../src/lib/pythHealth";

const quote = (source: Quote["source"]): Quote => ({
  ticker: "VOO",
  price: "70290500",
  expo: -5,
  conf: "0",
  publishTime: 1,
  source,
});

/* Wednesday 16 Sep 2026, 11:00 AM New York: Pyth prints. Saturday 19 Sep,
 * noon: it does not. Both asserted, so a change to the hours model fails here
 * rather than quietly turning the cases below into nothing. */
const OPEN = Date.UTC(2026, 8, 16, 15, 0, 0) / 1000;
const WEEKEND = Date.UTC(2026, 8, 19, 16, 0, 0) / 1000;

describe("pyth health", () => {
  it("stands on an hours model that says what these cases assume", () => {
    expect(pythPricesAt(OPEN)).to.equal(true);
    expect(pythPricesAt(WEEKEND)).to.equal(false);
  });

  it("refuses when Pyth should print and the quote came from somewhere else", () => {
    expect(pythDownFor(["VOO"], { VOO: quote("regular") }, OPEN)).to.equal(PYTH_DOWN);
    expect(pythDownFor(["VOO"], { VOO: quote("last") }, OPEN)).to.equal(PYTH_DOWN);
  });

  it("stays quiet when Pyth answered", () => {
    expect(pythDownFor(["VOO"], { VOO: quote("pyth") }, OPEN)).to.equal(null);
  });

  it("stays quiet while Pyth's own market is shut: the hours rules speak for that", () => {
    expect(pythDownFor(["VOO"], { VOO: quote("last") }, WEEKEND)).to.equal(null);
  });

  it("stays quiet with no Pyth side, and before any quote has loaded", () => {
    expect(pythDownFor([], { NVDA: quote("regular") }, OPEN)).to.equal(null);
    expect(pythDownFor(["VOO"], undefined, OPEN)).to.equal(null);
    expect(pythDownFor(["VOO"], {}, OPEN)).to.equal(null);
  });
});
