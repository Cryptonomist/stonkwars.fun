/* A Pyth-priced stock keeps its move on the day. Pyth never sends the close
 * before today, so the exchange's close is carried over to the Pyth quote,
 * rescaled to Pyth's exponent (lib/pricemath withPrev, used by liveQuotes). */

import { expect } from "chai";

import { dayChangePct, quoteValue, withPrev, type Quote } from "../src/lib/pricemath";

const PYTH_TSLA: Quote = { ticker: "TSLA", price: "34512345", expo: -5, conf: "1200", publishTime: 1_789_000_000 };
// The exchange counts in 10^-4: $340.0000 last close, $345.1000 now.
const MARKET_TSLA: Quote = {
  ticker: "TSLA",
  price: "3451000",
  expo: -4,
  conf: "0",
  publishTime: 1_789_000_000,
  prev: "3400000",
};

describe("previous close carried to a Pyth quote", () => {
  it("rescales the exchange's close to the Pyth exponent", () => {
    const q = withPrev(PYTH_TSLA, MARKET_TSLA);
    expect(q.prev).to.equal("34000000");
    // The price, exponent and everything else are still Pyth's.
    expect(q.price).to.equal(PYTH_TSLA.price);
    expect(q.expo).to.equal(-5);
    expect(quoteValue({ price: q.prev!, expo: q.expo })).to.be.closeTo(340, 1e-9);
    expect(dayChangePct(q)).to.be.closeTo(((345.12345 - 340) / 340) * 100, 1e-9);
  });

  it("works when the other source counts in finer units", () => {
    const q = withPrev({ ...PYTH_TSLA, expo: -2, price: "34512" }, MARKET_TSLA);
    expect(q.prev).to.equal("34000");
  });

  it("leaves a quote alone when there is no close to carry", () => {
    expect(withPrev(PYTH_TSLA, undefined)).to.equal(PYTH_TSLA);
    expect(withPrev(PYTH_TSLA, { expo: -4 })).to.equal(PYTH_TSLA);
    expect(withPrev(PYTH_TSLA, { expo: -4, prev: "0" })).to.equal(PYTH_TSLA);
  });

  it("never overwrites a close the quote already has", () => {
    const own = { ...PYTH_TSLA, prev: "33000000" };
    expect(withPrev(own, MARKET_TSLA).prev).to.equal("33000000");
  });
});
