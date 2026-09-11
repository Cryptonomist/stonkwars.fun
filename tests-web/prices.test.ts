import { expect } from "chai";

import { movePct, stakeForDollars, stakeValue } from "../src/lib/prices";
import { healthFor, koGap } from "../src/lib/health";

const NVDA = { price: "21101503", expo: -5 }; // $211.01503
const SPY = { price: "76547926", expo: -5 }; // $765.47926

describe("stake sizing", () => {
  it("turns dollars into base units in integers, rounding down", () => {
    const raw = stakeForDollars(BigInt(2_500), NVDA, 8);
    // 2500 * 10^13 / (21101503 * 100)
    expect(raw).to.equal(BigInt(2_500) * BigInt(10) ** BigInt(13) / (BigInt(21_101_503) * BigInt(100)));
    expect(raw).to.equal(BigInt(11_847_497));
    // Never more than the dollars asked for.
    expect(stakeValue(raw, 8, NVDA)!).to.be.at.most(25).and.above(24.9999);
  });

  it("sizes both sides of a fight to the same dollars", () => {
    const a = stakeValue(stakeForDollars(BigInt(10_000), NVDA, 8), 8, NVDA)!;
    const b = stakeValue(stakeForDollars(BigInt(10_000), SPY, 8), 8, SPY)!;
    expect(Math.abs(a - b)).to.be.below(0.0001);
  });

  it("refuses a non-positive price rather than dividing by it", () => {
    expect(stakeForDollars(BigInt(2_500), { price: "0", expo: -5 }, 8)).to.equal(BigInt(0));
  });
});

describe("moves and health", () => {
  it("measures percent moves across exponents", () => {
    expect(movePct({ price: "10000", expo: -2 }, { price: "103000", expo: -3 })).to.be.closeTo(3, 1e-9);
    expect(movePct({ price: "10000", expo: -2 }, { price: "9900", expo: -2 })).to.be.closeTo(-1, 1e-9);
  });

  it("empties the trailing bar at the round's knockout gap", () => {
    expect(koGap(5 * 60)).to.equal(0.5);
    expect(koGap(3_600)).to.equal(1);
    expect(koGap(7 * 86_400)).to.equal(4);
    expect(healthFor(3, 1, 2)).to.deep.equal([100, 0]);
    expect(healthFor(1, 1.5, 1)).to.deep.equal([50, 100]);
    expect(healthFor(0.2, 0.2, 0.5)).to.deep.equal([100, 100]);
  });
});
