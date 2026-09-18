/* The private companies: tradable here, never stakeable, and the reason said
 * out loud. These tests exist because the dangerous failure is silent: a mint
 * with a permanent delegate quietly becoming something people can stake. */

import { expect } from "chai";

import { PRESTOCKS, activityOf, byPreTicker, NOT_STAKEABLE_BECAUSE } from "../src/lib/prestocks";
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

  it("says why, in words a page can print", () => {
    expect(NOT_STAKEABLE_BECAUSE).to.match(/pause/i);
    expect(NOT_STAKEABLE_BECAUSE).to.match(/move them out of any wallet/i);
  });

  it("keeps every pre-IPO company on this desk and none of them in the roster", () => {
    /* The PreStocks bounty rules out a project that integrates any pre-IPO
     * token that is not theirs. SpaceX has never listed, so SPCX was one
     * however it was wrapped; it now sits here instead of in the roster.
     * Figure AI is unrelated: the roster's FIGR is Figure Technology
     * Solutions, a listed lender with a confusingly similar name. */
    expect(byPreTicker("SPACEX"), "SpaceX belongs on this desk").to.not.equal(undefined);
    expect(ROSTER.some((r) => r.ticker === "SPCX"), "SPCX must not be fightable").to.equal(false);
    expect(byPreTicker("FIGUREAI"), "Figure AI is its own company").to.not.equal(undefined);
    expect(ROSTER.some((r) => r.ticker === "FIGR"), "FIGR is the listed lender").to.equal(true);
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
