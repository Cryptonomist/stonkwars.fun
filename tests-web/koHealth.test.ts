/* The bars at the bell say what the program decided: the loser is empty, the
 * winner is standing, and a dead heat knocks nobody out. They used to be drawn
 * from the gap alone, which left both fighters nearly full under a K.O. */

import { expect } from "chai";

import { OUTCOME_CREATOR, OUTCOME_OPPONENT, OUTCOME_TIE } from "../src/lib/duel";
import {
  healthFor,
  koGap,
  OUTCOME_CREATOR_WON,
  OUTCOME_OPPONENT_WON,
  settledHealth,
  WINNER_FLOOR,
} from "../src/lib/health";

describe("settledHealth", () => {
  it("uses the program's own outcome values", () => {
    expect(OUTCOME_CREATOR_WON).to.equal(OUTCOME_CREATOR);
    expect(OUTCOME_OPPONENT_WON).to.equal(OUTCOME_OPPONENT);
  });

  it("empties the challenger's bar when the answer wins", () => {
    // A 6 minute round won by 0.0062 points: the gap alone barely dents a bar.
    const [h1, h2] = settledHealth(-0.0108, -0.0046, OUTCOME_OPPONENT, 360);
    expect(h1).to.equal(0);
    expect(h2).to.equal(100);
  });

  it("empties the answer's bar when the challenger wins", () => {
    const [h1, h2] = settledHealth(0.42, -0.1, OUTCOME_CREATOR, 3_600);
    expect(h2).to.equal(0);
    expect(h1).to.equal(100);
  });

  it("never draws the winner below a sliver, even against the gap", () => {
    /* The bars follow the result, not the display arithmetic: if the two ever
     * disagreed, the winner still stands. */
    const [h1, h2] = settledHealth(-3, 3, OUTCOME_CREATOR, 300);
    expect(h1).to.equal(WINNER_FLOOR);
    expect(h2).to.equal(0);
  });

  it("leaves a dead heat as the gap drew it", () => {
    const gapped = healthFor(0.01, 0.01, koGap(300));
    expect(settledHealth(0.01, 0.01, OUTCOME_TIE, 300)).to.deep.equal(gapped);
    expect(settledHealth(0.01, 0.01, OUTCOME_TIE, 300)).to.deep.equal([100, 100]);
  });
});
