/* Exhibition bouts: the maths, and the promise that nothing is at stake.
 *
 * The result of an exhibition is not checked by any program, so these are the
 * only thing standing between the page and a wrong winner. */

import { expect } from "chai";

import {
  DEAD_HEAT_POINTS,
  legFrom,
  movePct,
  NOTHING_AT_STAKE,
  verdictOf,
  verdictWords,
  WINDOWS,
  isWindowId,
  type Leg,
} from "../src/lib/exhibition";

const leg = (ticker: string, closes: (number | null)[]): Leg =>
  legFrom(ticker, ticker, "pool", closes.map((_, i) => 1_789_000_000 + i * 60), closes);

describe("exhibition bouts", () => {
  it("measures each side from its own first traded price", () => {
    /* The window may open before a side has traded. Percent has to run from
     * the first price that exists, not from a gap, or every later point is
     * measured against nothing. */
    const l = leg("OPENAI", [null, null, 100, 110, 105]);
    expect(l.first).to.equal(100);
    expect(l.last).to.equal(105);
    expect(l.pct[0]).to.equal(null);
    expect(l.pct[1]).to.equal(null);
    expect(l.pct[2]).to.equal(0);
    expect(l.pct[3]).to.be.closeTo(10, 1e-9);
    expect(l.pct[4]).to.be.closeTo(5, 1e-9);
  });

  it("takes the last traded price as the close, not the last bar", () => {
    /* A pool can report an empty final minute. Taking that as the close would
     * void a bout that plainly had a winner. */
    const l = leg("SPACEX", [50, 52, null, null]);
    expect(l.last).to.equal(52);
    expect(movePct(l.first, l.last)).to.be.closeTo(4, 1e-9);
  });

  it("gives the bout to the bigger percentage move, whichever side it is", () => {
    const a = leg("OPENAI", [100, 103]);        // +3%
    const b = leg("NVDA", [200, 202]);          // +1%
    const v = verdictOf(a, b);
    expect(v.kind).to.equal("decided");
    if (v.kind !== "decided") throw new Error("unreachable");
    expect(v.winner).to.equal("OPENAI");
    expect(v.loser).to.equal("NVDA");
    expect(v.margin).to.be.closeTo(2, 1e-9);

    /* And the other way round, so the order of the arguments cannot decide it. */
    const back = verdictOf(b, a);
    expect(back.kind).to.equal("decided");
    if (back.kind !== "decided") throw new Error("unreachable");
    expect(back.winner).to.equal("OPENAI");
    expect(back.margin).to.be.closeTo(2, 1e-9);
  });

  it("gives it to the side that fell less when both fell", () => {
    const a = leg("ANTHROPIC", [100, 95]);      // -5%
    const b = leg("KALSHI", [100, 90]);         // -10%
    const v = verdictOf(a, b);
    if (v.kind !== "decided") throw new Error("expected a result");
    expect(v.winner).to.equal("ANTHROPIC");
    expect(v.margin).to.be.closeTo(5, 1e-9);
  });

  it("calls a real tie a dead heat rather than picking on a rounding artefact", () => {
    const a = leg("OPENAI", [100, 110]);
    const b = leg("NVDA", [50, 55]);            // both exactly +10%
    expect(verdictOf(a, b).kind).to.equal("dead-heat");

    /* Just inside the threshold is still a dead heat; just outside is decided. */
    const near = leg("NVDA", [100, 110 + 110 * (DEAD_HEAT_POINTS / 2 / 100)]);
    expect(verdictOf(a, near).kind).to.equal("dead-heat");
    const clear = leg("NVDA", [100, 110.02]);
    expect(verdictOf(a, clear).kind).to.equal("decided");
  });

  it("refuses to call a bout where a side never traded", () => {
    const a = leg("OPENAI", [100, 110]);
    const empty = leg("ANDURIL", [null, null]);
    const v = verdictOf(a, empty);
    expect(v.kind).to.equal("no-contest");
    if (v.kind !== "no-contest") throw new Error("unreachable");
    expect(v.why).to.match(/ANDURIL/);

    const neither = verdictOf(empty, leg("KALSHI", [null]));
    if (neither.kind !== "no-contest") throw new Error("unreachable");
    expect(neither.why).to.match(/Neither/);
  });

  it("refuses a side whose first price is zero rather than dividing by it", () => {
    const zero = legFrom("X", "X", "pool", [1, 2], [0, 5]);
    expect(zero.first).to.equal(5, "a zero close is not a price");
    expect(movePct(0, 5)).to.equal(null);
  });

  it("says in the words on the page that nothing is at stake", () => {
    /* The whole reason exhibitions exist is that these tokens must never be
     * escrowed. If the page stops saying so, this fails. */
    expect(NOTHING_AT_STAKE).to.match(/no stake/i);
    expect(NOTHING_AT_STAKE).to.match(/nothing is escrowed/i);
    expect(NOTHING_AT_STAKE).to.match(/not on chain/i);
    expect(NOTHING_AT_STAKE).to.match(/prices are the real ones/i);
  });

  it("puts the winner first in the words, and names no winner when there is none", () => {
    const a = leg("OPENAI", [100, 103]);
    const b = leg("NVDA", [200, 202]);
    expect(verdictWords(verdictOf(a, b))).to.match(/^OPENAI cooked NVDA by 2\.000 percentage points\.$/);
    expect(verdictWords({ kind: "dead-heat" })).to.match(/dead heat/i);
    expect(verdictWords({ kind: "no-contest", why: "X did not trade." })).to.match(/^No contest\./);
  });

  it("offers windows a pool can actually be asked for", () => {
    /* A day of minute bars is 1,440 points from a source that rate limits, so
     * anything longer than an hour is drawn at hour buckets. */
    expect(isWindowId("24h")).to.equal(true);
    expect(isWindowId("3y")).to.equal(false);
    expect(WINDOWS["1h"].bucket).to.equal("minute");
    expect(WINDOWS["24h"].bucket).to.equal("hour");
    expect(WINDOWS["7d"].bucket).to.equal("hour");
    for (const w of Object.values(WINDOWS)) expect(w.secs).to.be.greaterThan(0);
  });
});
