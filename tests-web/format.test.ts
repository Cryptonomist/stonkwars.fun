import { expect } from "chai";

import { pct, points } from "../src/lib/format";

/* Two decimals suit a trading day and lie on a quiet weekend. One settled
 * fight had its sides at -0.0108% and -0.0046%, which at two decimals reads
 * "-0.01%" against "-0.00%": a move that happened, printed as nothing, beside
 * the words "winner takes both". */

describe("a move on an ordinary day", () => {
  it("keeps two decimals and its sign", () => {
    expect(pct(3.121)).to.equal("+3.12%");
    expect(pct(-0.85)).to.equal("-0.85%");
    expect(pct(12)).to.equal("+12.00%");
  });

  it("prints a real zero as zero, because there it is true", () => {
    expect(pct(0)).to.equal("0.00%");
  });
});

describe("a move on a dead weekend", () => {
  it("widens rather than rounding a real move away", () => {
    expect(pct(-0.0046)).to.equal("-0.0046%");
    expect(pct(-0.0108)).to.equal("-0.011%");
  });

  it("widens only as far as it has to", () => {
    expect(pct(-0.004)).to.equal("-0.004%");
    expect(pct(0.09)).to.equal("+0.09%");
  });

  it("gives up rather than printing a hundred zeros", () => {
    // Smaller than any price feed resolves; six decimals is the floor.
    expect(pct(1e-12)).to.equal("0.00%");
  });

  it("never loses the sign of something that moved", () => {
    for (const n of [-0.0046, -0.0001, -1e-6]) expect(pct(n)).to.match(/^-/);
    for (const n of [0.0046, 0.0001, 1e-6]) expect(pct(n)).to.match(/^\+/);
  });
});

describe("the margin between two moves", () => {
  it("reads plainly when the fight was not close", () => {
    expect(points(1.23)).to.equal("1.23");
    expect(points(-1.23)).to.equal("1.23");
  });

  it("shows the margin that actually decided a quiet fight", () => {
    // -0.0108 against -0.0046: the gap is 0.0062, not "0.01".
    expect(points(-0.0108 - -0.0046)).to.equal("0.0062");
  });
});
