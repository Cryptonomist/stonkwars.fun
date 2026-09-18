/* Pyth's confidence band, which the site fetched and discarded until now.
 *
 * The band is the thing a Pyth price has that a scraped one does not, so the
 * rules about when it is shown matter: only for a Pyth quote, never for a
 * source that fills conf with "0", and never as something a fight settles on. */

import { expect } from "chai";

import { bandWords, confBand, type Quote } from "../src/lib/pricemath";

const quote = (over: Partial<Quote> = {}): Quote => ({
  ticker: "TSLA",
  price: "4123456",
  expo: -4,
  conf: "1230",
  publishTime: 1_789_000_000,
  source: "pyth",
  ...over,
});

describe("Pyth's confidence band", () => {
  it("reads the band off a Pyth quote, in dollars and as a share of the price", () => {
    const b = confBand(quote());
    expect(b, "a Pyth quote has a band").to.not.equal(null);
    // 1230 ticks at 1e-4 is $0.123, against a price of $412.3456.
    expect(b!.usd).to.be.closeTo(0.123, 1e-9);
    expect(b!.pct).to.be.closeTo((0.123 / 412.3456) * 100, 1e-9);
  });

  it("gives nothing for a source that does not publish one", () => {
    /* Every other source sets conf to "0", so a band drawn from them would be
     * a number the market never said. */
    for (const source of ["regular", "extended", "perp", "pool", "composite", "last"] as const) {
      expect(confBand(quote({ source, conf: "0" })), source).to.equal(null);
      /* And not even when something upstream leaves a stale conf behind. */
      expect(confBand(quote({ source, conf: "1230" })), `${source} with a stray conf`).to.equal(null);
    }
  });

  it("gives nothing when there is no quote, no band, or no price to measure it against", () => {
    expect(confBand(undefined)).to.equal(null);
    expect(confBand(quote({ conf: "0" }))).to.equal(null);
    expect(confBand(quote({ conf: "-5" }))).to.equal(null);
    expect(confBand(quote({ conf: "not a number" }))).to.equal(null);
    expect(confBand(quote({ price: "0" }))).to.equal(null);
  });

  it("calls a band tight, normal or wide by its share of the price", () => {
    expect(bandWords(0.01)).to.equal("tight");
    expect(bandWords(0.049)).to.equal("tight");
    expect(bandWords(0.05)).to.equal("normal");
    expect(bandWords(0.24)).to.equal("normal");
    expect(bandWords(0.25)).to.equal("wide");
    expect(bandWords(3)).to.equal("wide");
  });

  it("scales with the exponent rather than assuming one", () => {
    /* The same mantissa at a different exponent is a different number of
     * dollars, and a band that ignored expo would be wrong by orders of ten. */
    const a = confBand(quote({ conf: "1230", expo: -4 }))!;
    const b = confBand(quote({ conf: "1230", expo: -6, price: "412345600" }))!;
    expect(a.usd).to.be.closeTo(0.123, 1e-9);
    expect(b.usd).to.be.closeTo(0.00123, 1e-9);
  });
});
