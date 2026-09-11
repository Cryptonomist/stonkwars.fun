import { expect } from "chai";

import { comboOf, gapOf, hitFrom, liveHits, COMBO_MIN, COMBO_MS, HIT_POINTS, type Hit } from "../src/lib/fightFeel";

const hit = (side: "p1" | "p2", at: number, damage = 0.05, id = at): Hit => ({ id, side, damage, at });

describe("the gap", () => {
  it("is the challenger's lead in points", () => {
    expect(gapOf(1.2, 0.5)).to.be.closeTo(0.7, 1e-12);
    expect(gapOf(-0.4, 0.6)).to.be.closeTo(-1, 1e-12);
  });
});

describe("hits", () => {
  it("credits the fighter the gap moved towards", () => {
    expect(hitFrom(0, 0.4, 1_000, 1)).to.include({ side: "p1", at: 1_000, id: 1 });
    expect(hitFrom(0.4, 0, 1_000, 2)).to.include({ side: "p2" });
  });

  it("measures damage as the size of the move, not the size of the gap", () => {
    // A commanding lead that barely grows is a light hit.
    expect(hitFrom(3, 3.04, 0, 1)!.damage).to.be.closeTo(0.04, 1e-12);
    // A fighter behind by nothing who takes a big swing lands a heavy one.
    expect(hitFrom(0, -0.5, 0, 2)!.damage).to.be.closeTo(0.5, 1e-12);
  });

  it("ignores ticks too small to be a punch", () => {
    expect(hitFrom(0, HIT_POINTS / 2, 0, 1)).to.equal(null);
    expect(hitFrom(0, 0, 0, 1)).to.equal(null);
    expect(hitFrom(0, HIT_POINTS, 0, 1)).to.not.equal(null);
  });

  it("draws nothing from a price that is not a number", () => {
    expect(hitFrom(0, NaN, 0, 1)).to.equal(null);
    expect(hitFrom(NaN, 1, 0, 1)).to.equal(null);
    expect(hitFrom(0, Infinity, 0, 1)).to.equal(null);
  });
});

describe("combos", () => {
  it("needs a run by one fighter, not just a busy round", () => {
    const trading = [hit("p1", 1), hit("p2", 2), hit("p1", 3)];
    expect(comboOf(trading, 4)).to.equal(null);
    expect(comboOf([hit("p1", 1), hit("p1", 2)], 3)).to.equal(null);
  });

  it("counts the run and adds up what it cost", () => {
    const combo = comboOf([hit("p2", 1, 0.1), hit("p1", 2, 0.2), hit("p1", 3, 0.3), hit("p1", 4, 0.4)], 5)!;
    expect(combo.side).to.equal("p1");
    expect(combo.count).to.equal(COMBO_MIN);
    expect(combo.damage).to.be.closeTo(0.9, 1e-12); // the run only, not the p2 hit before it
  });

  it("ends when the fighter stops throwing", () => {
    const run = [hit("p1", 1_000), hit("p1", 2_000), hit("p1", 3_000)];
    expect(comboOf(run, 3_500)).to.not.equal(null);
    expect(comboOf(run, 3_000 + COMBO_MS + 1)).to.equal(null);
  });

  it("is broken by one hit the other way, then starts over", () => {
    const hits = [hit("p1", 1), hit("p1", 2), hit("p1", 3), hit("p2", 4)];
    expect(comboOf(hits, 5)).to.equal(null);
    expect(comboOf([...hits, hit("p2", 5), hit("p2", 6)], 7)!.side).to.equal("p2");
  });
});

describe("what stays on screen", () => {
  it("keeps the recent few and drops the stale ones", () => {
    const hits = [hit("p1", 0), ...Array.from({ length: 8 }, (_, i) => hit("p2", 10_000 + i))];
    const live = liveHits(hits, 10_010);
    expect(live).to.have.length(6);
    expect(live.every((h) => h.at >= 10_000)).to.equal(true); // the hit from before the window is gone
  });
});
