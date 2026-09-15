/* Trading: amounts convert exactly, a quote is only ever a stock's token against
 * USDC or SOL, the fee is capped, and a quote reads back as what the panel shows. */

import { expect } from "chai";

import { MAX_SWAP_FEE_BPS, PAY, SOL_MINT, swapFeeBps, toAtomic, USDC_MINT, type JupiterQuote } from "../src/lib/swap";
import { mainnetStockToken, pairFor, summarize, tradeFor } from "../src/lib/swapPairs";

const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

describe("trading", () => {
  it("converts typed amounts to base units exactly, and refuses what it cannot", () => {
    expect(toAtomic("25", 6)).to.equal(25_000_000n);
    expect(toAtomic("0.1", 9)).to.equal(100_000_000n);
    expect(toAtomic(".5", 6)).to.equal(500_000n);
    expect(toAtomic("0.00000001", 8)).to.equal(1n);
    expect(toAtomic("0.000000001", 8)).to.equal(null, "more decimals than the token has");
    for (const bad of ["", ".", "abc", "-1", "1e3", "1.2.3"]) expect(toAtomic(bad, 6), bad).to.equal(null);
  });

  it("trades a stock as its xStocks token", () => {
    const t = mainnetStockToken("TSLA")!;
    expect(t.mint).to.equal(TSLAX);
    expect(t.issuer).to.equal("xStocks");
    expect(mainnetStockToken("NOT_A_STOCK")).to.equal(null);
  });

  it("builds a buy as pay-in, stock-out and a sell the other way", () => {
    const buy = pairFor("buy", "TSLA", "USDC")!;
    expect([buy.input.mint, buy.output.mint]).to.deep.equal([USDC_MINT, TSLAX]);
    const sell = pairFor("sell", "TSLA", "SOL")!;
    expect([sell.input.mint, sell.output.mint]).to.deep.equal([TSLAX, SOL_MINT]);
  });

  it("recognises only a stock's token against USDC or SOL as a trade", () => {
    expect(tradeFor(USDC_MINT, TSLAX)).to.include({ ticker: "TSLA", side: "buy", pay: "USDC" });
    expect(tradeFor(TSLAX, SOL_MINT)).to.include({ ticker: "TSLA", side: "sell", pay: "SOL" });
    expect(tradeFor(USDC_MINT, SOL_MINT)).to.equal(null, "no stock");
    expect(tradeFor(TSLAX, TSLAX)).to.equal(null);
    expect(tradeFor(USDC_MINT, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).to.equal(null, "a memecoin");
  });

  it("caps the swap fee and treats nonsense as none", () => {
    expect(swapFeeBps("50")).to.equal(50);
    expect(swapFeeBps("5000")).to.equal(MAX_SWAP_FEE_BPS);
    expect(swapFeeBps("-3")).to.equal(0);
    expect(swapFeeBps("nope")).to.equal(0);
    expect(swapFeeBps(undefined)).to.equal(0);
  });

  it("reads a real Jupiter quote the way the panel shows it", () => {
    // Recorded from lite-api.jup.ag: $25 of USDC for TSLAx with a 1% fee.
    const q: JupiterQuote = {
      inputMint: USDC_MINT,
      outputMint: TSLAX,
      inAmount: "25000000",
      outAmount: "6960732",
      otherAmountThreshold: "6891125",
      swapMode: "ExactIn",
      slippageBps: 100,
      platformFee: { amount: "70310", feeBps: 100 },
      priceImpactPct: "0.0027769196707621878110752357",
      routePlan: [{ swapInfo: { label: "Riptide" } }],
    };
    const s = summarize(q, "buy", "TSLA", "USDC")!;
    expect(s.output.amount).to.be.closeTo(0.06960732, 1e-12);
    expect(s.output.minimum).to.be.closeTo(0.06891125, 1e-12);
    expect(s.fee).to.deep.include({ bps: 100, symbol: "TSLAx" });
    expect(s.fee!.amount).to.be.closeTo(0.0007031, 1e-12);
    expect(s.pricePerShare).to.be.closeTo(25 / 0.07031042, 1e-6);
    expect(s.priceImpactPct).to.be.closeTo(0.2777, 1e-3);
    expect(s.route).to.deep.equal(["Riptide"]);
    expect(summarize({ ...q, outputMint: SOL_MINT }, "buy", "TSLA", "USDC")).to.equal(null, "a quote for another pair");
    expect(PAY.USDC.decimals).to.equal(6);
  });
});
