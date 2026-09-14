import { expect } from "chai";

import { mixedHoursAt, pricedAt, tradesAroundTheClock } from "../src/lib/stocks";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const SATURDAY = at("2026-09-12T18:00:00Z");
const FRIDAY_OPEN = at("2026-09-11T18:00:00Z"); // 2 PM ET

describe("fights across trading hours", () => {
  it("starts from two stocks that trade around the clock", () => {
    // The page's default pair and the faucet's starter set.
    for (const t of ["AAPL", "NVDA", "MSFT", "GOOGL"]) {
      expect(tradesAroundTheClock(t), t).to.equal(true);
      expect(pricedAt(t, SATURDAY), t).to.not.equal("waits");
    }
  });

  it("refuses a pair with exactly one side waiting for its exchange", () => {
    expect(pricedAt("TSLA", SATURDAY)).to.equal("waits");
    const said =
      "TSLA waits for its exchange to open but NVDA trades now, so their start prices would be days apart. " +
      "Pick two that both trade now, or two that both wait.";
    expect(mixedHoursAt("TSLA", "NVDA", SATURDAY)).to.equal(said);
    expect(mixedHoursAt("NVDA", "TSLA", SATURDAY)).to.equal(said);
  });

  it("allows two that both trade, two that both wait, and any pair in session", () => {
    expect(mixedHoursAt("AAPL", "NVDA", SATURDAY)).to.equal(null);
    expect(mixedHoursAt("TSLA", "QQQ", SATURDAY)).to.equal(null);
    expect(mixedHoursAt("TSLA", "NVDA", FRIDAY_OPEN)).to.equal(null);
  });

  it("says nothing about a ticker off the roster", () => {
    expect(mixedHoursAt("?", "NVDA", SATURDAY)).to.equal(null);
  });
});
