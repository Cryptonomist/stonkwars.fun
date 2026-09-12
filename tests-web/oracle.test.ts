/* The oracle's two promises: the bytes it signs are the bytes the program
 * parses, and the price it picks for a moment is the one the rules name. */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import {
  medianAtBoundary,
  priceAtBoundary,
  quoteMessage,
  signedQuoteInstruction,
  sourceAt,
  QUOTE_LEN,
} from "../src/lib/oracle";
import { nyToMs } from "../src/lib/market";

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

  /* OUT OF HOURS, THE TOKEN PRICES THE STOCK.
   *
   * The exchange shuts and the pool does not, which is the argument for
   * putting a share on a chain at all. The defence against a thin minute being
   * bought is that the price is the median of fifteen of them. */
  describe("medianAtBoundary", () => {
    /** A window of minute bars ending exactly at `boundary`. */
    const window = (closes: (number | null)[], boundary = 900) => ({
      t: closes.map((_, i) => boundary - (closes.length - i) * 60),
      c: closes,
    });

    it("takes the middle close of the window, as of the boundary", () => {
      const bars = window([10, 12, 11, 13, 9, 10, 11, 12, 10]);
      expect(medianAtBoundary(bars, 900)).to.deep.equal({ price: 110_000n, publishTime: 900 });
    });

    it("cannot be moved by one minute, however far that minute goes", () => {
      const honest = [100, 100, 101, 100, 99, 100, 100, 101, 100, 100, 99, 100, 100, 100, 101];
      const before = medianAtBoundary(window(honest), 900)!.price;
      // Somebody empties a thin pool in the last minute before the bell.
      expect(medianAtBoundary(window([...honest.slice(0, -1), 140]), 900)!.price).to.equal(before);
      // Three bought minutes still do not reach the middle of fifteen.
      expect(medianAtBoundary(window([...honest.slice(0, -3), 140, 141, 139]), 900)!.price).to.equal(before);
    });

    it("averages the two middle closes, so a sort cannot decide it", () => {
      expect(medianAtBoundary(window([10, 20, 30, 40, 50, 60]), 900)!.price).to.equal(350_000n);
    });

    it("ignores minutes older than the window, and anything at or after the boundary", () => {
      const bars = { t: [0, 60, 120, 840, 900, 960], c: [1, 1, 1, 50, 999, 999] };
      // Only the bar ending at 900 is inside the window, which is too few.
      expect(medianAtBoundary(bars, 900)).to.equal(null);
    });

    it("gives nothing when the pool barely traded", () => {
      expect(medianAtBoundary(window([10, null, null, 11, null, null, 12]), 900)).to.equal(null);
      expect(medianAtBoundary(window([10, 0, -1, 11, null]), 900)).to.equal(null);
      expect(medianAtBoundary({ t: [], c: [] }, 900)).to.equal(null);
    });
  });

  describe("which market answers for a moment", () => {
    // 2026-09-15 is a Tuesday; 2026-09-13 a Sunday.
    const at = (hh: number, mm: number, day = 15) => Math.floor(nyToMs(2026, 9, day, hh, mm, 0) / 1000);
    const listed = { market: "US", pool: "somepool" };

    it("uses the exchange right through its extended hours", () => {
      expect(sourceAt(at(4, 0), listed)).to.equal("exchange"); // pre-market opens
      expect(sourceAt(at(12, 0), listed)).to.equal("exchange");
      expect(sourceAt(at(19, 59), listed)).to.equal("exchange"); // after-hours still going
    });

    it("uses the token once the exchange is shut", () => {
      expect(sourceAt(at(20, 0), listed)).to.equal("onchain"); // after-hours over
      expect(sourceAt(at(2, 30), listed)).to.equal("onchain"); // the middle of the night
      expect(sourceAt(at(12, 0, 13), listed)).to.equal("onchain"); // a Sunday
    });

    it("keeps exchange hours for a stock with no pool worth reading", () => {
      expect(sourceAt(at(2, 30), { market: "US" })).to.equal("exchange");
    });

    it("keeps exchange hours for a listing whose sessions we do not model", () => {
      // Hong Kong trades while New York sleeps; guessing would be worse than
      // waiting for its own bars.
      expect(sourceAt(at(2, 30), { market: "HK", pool: "somepool" })).to.equal("exchange");
    });
  });
});
