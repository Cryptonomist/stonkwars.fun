/* The private companies: tradable here, never stakeable, and the reason said
 * out loud. These tests exist because the dangerous failure is silent: a mint
 * with a permanent delegate quietly becoming something people can stake. */

import { expect } from "chai";

import { PRESTOCKS, activityOf, byPreTicker, dexName, NOT_STAKEABLE_BECAUSE } from "../src/lib/prestocks";
import { mainnetStockToken, pairFor, tradeFor } from "../src/lib/swapPairs";
import { ROSTER, STAKEABLE } from "../src/lib/stocks";

describe("private companies", () => {
  it("is a real list with the fields a trade needs", () => {
    expect(PRESTOCKS.length).to.be.greaterThan(0);
    for (const p of PRESTOCKS) {
      expect(p.ticker, "ticker").to.match(/^[A-Z0-9]{2,12}$/);
      expect(p.mint, `${p.ticker} mint`).to.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(p.decimals, `${p.ticker} decimals`).to.be.within(0, 18);
      expect(p.pool, `${p.ticker} pool`).to.have.length.greaterThan(20);
      expect(p.symbol, `${p.ticker} symbol`).to.have.length.greaterThan(0);
      expect(p.blurb, `${p.ticker} blurb`).to.have.length.greaterThan(0);
    }
  });

  /* THE ONE THAT MATTERS. These mints let their issuer move tokens out of any
   * wallet and pause transfers, so escrow cannot promise what a fight promises.
   * Nothing may put them within reach of a stake. */
  it("never reaches the list of things that can be staked", () => {
    for (const p of PRESTOCKS) {
      expect(ROSTER.some((r) => r.ticker === p.ticker), `${p.ticker} is in ROSTER`).to.equal(false);
      expect(STAKEABLE.some((s) => s.ticker === p.ticker), `${p.ticker} is stakeable`).to.equal(false);
    }
  });

  it("names the venue each pool is on rather than assuming one", () => {
    /* The page says where a price was read. Six of the seven pools are on
     * Meteora and Figure AI's is on Raydium, so a page that said "Meteora"
     * across the board would be wrong about one of them. Every entry carries
     * its own, and dexName turns an id nobody has mapped into a readable name
     * rather than dropping it. */
    for (const p of PRESTOCKS) {
      expect(p.dex, `${p.ticker} records its dex`).to.be.a("string").and.not.equal("");
      expect(dexName(p.dex), `${p.ticker} has a readable venue name`).to.be.a("string");
    }
    expect(dexName("meteora")).to.equal("Meteora");
    expect(dexName("raydium-clmm")).to.equal("Raydium CLMM");
    expect(dexName("some-new-amm")).to.equal("Some New Amm", "an unmapped id is tidied, not dropped");
    expect(dexName(undefined)).to.equal(null);
    expect(new Set(PRESTOCKS.map((p) => p.dex)).size, "they are not all on one venue").to.be.greaterThan(1);
  });

  it("says why, in words a page can print", () => {
    expect(NOT_STAKEABLE_BECAUSE).to.match(/pause/i);
    expect(NOT_STAKEABLE_BECAUSE).to.match(/move them out of any wallet/i);
    expect(NOT_STAKEABLE_BECAUSE).to.match(/transfer fee/i);
  });

  it("never names a fee rate the issuer can change", () => {
    /* The page said "a 50 bps transfer fee". The mints held 50 bps in epoch
     * 1038 and 100 bps scheduled from epoch 1039, so the sentence was true for
     * one more day. The issuer holds the fee authority and can move it again,
     * so the page names who sets the fee, never a rate. */
    expect(NOT_STAKEABLE_BECAUSE).to.not.match(/\d\s*(bps|basis points?|%|percent)/i);
  });

  it("does not repeat a company the roster already lists and can fight over", () => {
    /* SpaceX has listed: it trades on Nasdaq as SPCX, the roster carries it and
     * it can be fought over, so PreStocks' thinner, unstakeable SpaceX token is
     * left off a desk of companies that have not listed. It was once moved here
     * on the false premise that SpaceX had never listed; this pins it back.
     * Figure AI stays: the roster's FIGR is Figure Technology Solutions, a
     * listed lender with a confusingly similar name. */
    expect(byPreTicker("SPACEX"), "SpaceX should not be duplicated on the desk").to.equal(undefined);
    expect(ROSTER.some((r) => r.ticker === "SPCX"), "SPCX is a listed stock and fightable").to.equal(true);
    expect(byPreTicker("FIGUREAI"), "Figure AI is its own company").to.not.equal(undefined);
    expect(ROSTER.some((r) => r.ticker === "FIGR"), "FIGR is the listed lender").to.equal(true);
  });

  it("keeps a listed fund sold as pre-IPO exposure off the roster", () => {
    /* PreStocks' bounty rules out any other issuer's pre-IPO exposure. VCX,
     * the Fundrise fund, is listed on the NYSE but sold as a way into OpenAI,
     * Anthropic and SpaceX, so it stays off (scripts/build-roster.ts, EXCLUDED)
     * rather than leave a judge to decide what it is. */
    expect(ROSTER.some((r) => r.ticker === "VCX"), "VCX is on the roster").to.equal(false);
    expect(mainnetStockToken("VCX"), "VCX resolves a token").to.equal(null);
  });

  it("can be quoted through exactly the same path as a listed stock", () => {
    for (const p of PRESTOCKS) {
      const token = mainnetStockToken(p.ticker);
      expect(token, `${p.ticker} resolves a token`).to.not.equal(null);
      expect(token!.mint).to.equal(p.mint);
      const pair = pairFor("buy", p.ticker, "USDC");
      expect(pair, `${p.ticker} pairs for a buy`).to.not.equal(null);
      const back = tradeFor(pair!.input.mint, pair!.output.mint);
      expect(back?.ticker, `${p.ticker} round trips`).to.equal(p.ticker);
      expect(back?.side).to.equal("buy");
    }
  });

  it("calls a market busy or quiet by how much it trades, not how deep it is", () => {
    const thin = { ...PRESTOCKS[0], seen: { ...PRESTOCKS[0].seen, trades24h: 100 } };
    expect(activityOf(thin)).to.equal("quiet");
    expect(activityOf(thin, 9_000)).to.equal("busy", "a live count wins over the file");
    expect(activityOf(thin, 800)).to.equal("steady");
  });
});
