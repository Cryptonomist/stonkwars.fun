/* The oracle's two promises: the bytes it signs are the bytes the program
 * parses, and the price it picks for a moment is the one the rules name. */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import { priceAtBoundary, quoteMessage, signedQuoteInstruction, QUOTE_LEN } from "../src/lib/oracle";

/* The same vector is asserted in programs/duel/src/quote.rs
 * (`the_message_layout_is_pinned`), so the two sides cannot drift apart. */
const GOLDEN =
  "53544f4e4b574152533a50524943453a7631" +
  "09".repeat(32) +
  "e803000000000000" + // boundary 1000
  "8855000000000000" + // price 21896
  "feffffff" + // expo -2
  "fc03000000000000"; // publish_time 1020

describe("oracle", () => {
  it("signs exactly the layout the program reads", () => {
    const m = quoteMessage({ feed: "09".repeat(32), boundary: 1000, price: 21896n, expo: -2, publishTime: 1020 });
    expect(m.length).to.equal(QUOTE_LEN);
    expect(Buffer.from(m).toString("hex")).to.equal(GOLDEN);
  });

  it("refuses a feed id that is not 32 bytes", () => {
    expect(() => quoteMessage({ feed: "abcd", boundary: 1, price: 1n, expo: -4, publishTime: 1 })).to.throw(/32 bytes/);
  });

  it("puts key, signature and message in the Ed25519 instruction, all pointing at itself", () => {
    const oracle = Keypair.generate();
    const q = { feed: "09".repeat(32), boundary: 1000, price: 21896n, expo: -2, publishTime: 1020 };
    const data = signedQuoteInstruction(oracle, q).data;
    expect(data[0]).to.equal(1);
    const u16 = (at: number) => data.readUInt16LE(at);
    const [sigAt, sigIx, keyAt, keyIx, msgAt, msgLen, msgIx] = [2, 4, 6, 8, 10, 12, 14].map(u16);
    expect([sigIx, keyIx, msgIx]).to.deep.equal([0xffff, 0xffff, 0xffff]);
    expect(Buffer.from(data.subarray(keyAt, keyAt + 32)).equals(oracle.publicKey.toBuffer())).to.be.true;
    expect(Buffer.from(data.subarray(msgAt, msgAt + msgLen)).toString("hex")).to.equal(GOLDEN);
    expect(sigAt + 64).to.be.at.most(data.length);
  });

  describe("priceAtBoundary", () => {
    const bars = { t: [0, 60, 120], c: [10, null, 12.5] as (number | null)[] };

    it("takes the close of the bar the boundary falls in, as of the bar's end", () => {
      expect(priceAtBoundary(bars, 30, 1_000)).to.deep.equal({ price: 100_000n, publishTime: 60 });
      expect(priceAtBoundary(bars, 0, 1_000)).to.deep.equal({ price: 100_000n, publishTime: 60 });
    });

    it("skips a minute with no trade to the next bar that has one", () => {
      // The boundary is the end of bar 0, bar 1 is empty, so bar 2.
      expect(priceAtBoundary(bars, 60, 1_000)).to.deep.equal({ price: 125_000n, publishTime: 180 });
      expect(priceAtBoundary(bars, 90, 1_000)).to.deep.equal({ price: 125_000n, publishTime: 180 });
    });

    it("waits while the bar is still forming, and when there is none yet", () => {
      expect(priceAtBoundary(bars, 30, 60 + 19)).to.equal(null);
      expect(priceAtBoundary(bars, 30, 60 + 20)).to.deep.equal({ price: 100_000n, publishTime: 60 });
      expect(priceAtBoundary(bars, 200, 10_000)).to.equal(null);
      expect(priceAtBoundary({ t: [], c: [] }, 30, 1_000)).to.equal(null);
    });

    it("rounds the source's float noise away, the same way every time", () => {
      const noisy = { t: [0], c: [332.6000061035156] };
      expect(priceAtBoundary(noisy, 10, 1_000)?.price).to.equal(3_326_000n);
    });
  });
});
