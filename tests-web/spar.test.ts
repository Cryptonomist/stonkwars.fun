/* The sparring wallet takes only what a lone visitor's demo needs: an open,
 * unexpired challenge addressed to it, from somebody else, on a timed round of
 * a day or less. The market-hours rule is applied on top of this at the take,
 * by the same mixedHoursAt every other taker gets. Its own seats are planned by
 * a pure function, pinned here with a stand-in for that rule. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { STATUS_ACCEPTED, STATUS_OPEN } from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { planSeat, sparRefusal, sparRoundFor, SPAR_MAX_ROUND_SECS, SPAR_SEAT_PAIRS } from "../src/lib/spar";
import { byTicker, mixedHoursAt, stakeAssetFor } from "../src/lib/stocks";

const SPAR = PublicKey.unique();
const CREATOR = PublicKey.unique();
const NOW = 1_789_000_000;
const ny = (day: number, hh: number, mm: number) => Math.floor(nyToMs(2026, 9, day, hh, mm) / 1000);

const challenge = (over: Partial<Parameters<typeof sparRefusal>[0]> = {}) => ({
  status: STATUS_OPEN,
  invitee: SPAR,
  creator: CREATOR,
  expiresTs: NOW + 3_600,
  durationSecs: 900,
  endTs: 0,
  ...over,
});

describe("the sparring wallet", () => {
  it("takes an open timed challenge addressed to it, from 5 minutes to a day", () => {
    for (const secs of [300, 900, 3_600, 43_200, 86_400]) {
      expect(sparRefusal(challenge({ durationSecs: secs }), NOW, SPAR.toBase58()), String(secs)).to.equal(null);
    }
    expect(SPAR_MAX_ROUND_SECS).to.equal(86_400);
  });

  it("leaves alone what is not addressed to it, or open to anyone", () => {
    expect(sparRefusal(challenge({ invitee: PublicKey.unique() }), NOW, SPAR.toBase58())).to.match(/not addressed/);
    expect(sparRefusal(challenge({ invitee: PublicKey.default }), NOW, SPAR.toBase58())).to.match(/not addressed/);
  });

  it("never takes its own challenge, a taken or expired one, one longer than a day, or a fixed-end round", () => {
    expect(sparRefusal(challenge({ creator: SPAR }), NOW, SPAR.toBase58())).to.match(/own/);
    expect(sparRefusal(challenge({ status: STATUS_ACCEPTED }), NOW, SPAR.toBase58())).to.match(/not open/);
    expect(sparRefusal(challenge({ expiresTs: NOW }), NOW, SPAR.toBase58())).to.match(/expired/);
    expect(sparRefusal(challenge({ durationSecs: SPAR_MAX_ROUND_SECS + 1 }), NOW, SPAR.toBase58())).to.match(/24 hours/);
    expect(sparRefusal(challenge({ durationSecs: 0, endTs: NOW + 7_200 }), NOW, SPAR.toBase58())).to.match(/24 hours/);
  });

  it("offers a visitor 15 minutes while the exchange trades and the overnight round while it is shut", () => {
    expect(sparRoundFor(ny(15, 11, 0) * 1000)).to.equal("15m"); // Tuesday, regular session
    expect(sparRoundFor(ny(15, 6, 0) * 1000)).to.equal("15m"); // pre-market
    expect(sparRoundFor(ny(15, 22, 0) * 1000)).to.equal("12h"); // weeknight
    expect(sparRoundFor(ny(19, 14, 0) * 1000)).to.equal("12h"); // Saturday
  });

  describe("its own seats", () => {
    /* The rule a real take is judged by, from a taker's side. */
    const fair = (a: string, b: string, takeAt: number, durationSecs: number, expiresTs: number) =>
      !!stakeAssetFor(a) && !!stakeAssetFor(b) && mixedHoursAt(a, b, takeAt, { durationSecs, endTs: 0, expiresTs }, "taker") === null;

    it("only pairs stocks that are on the roster with a test token, and fight around the clock", () => {
      for (const [a, b] of SPAR_SEAT_PAIRS) {
        expect(byTicker(a), a).to.not.equal(undefined);
        expect(byTicker(b), b).to.not.equal(undefined);
        expect(stakeAssetFor(a), a).to.not.equal(null);
        expect(stakeAssetFor(b), b).to.not.equal(null);
      }
    });

    it("opens a 15 minute seat in the session, and the overnight round once the exchange is shut", () => {
      const midday = ny(15, 11, 0);
      expect(planSeat(midday, new Set(), fair)).to.deep.include({ a: "NVDA", b: "AMD", durationSecs: 900 });
      const night = ny(15, 22, 0);
      const plan = planSeat(night, new Set(), fair);
      expect(plan?.durationSecs).to.be.oneOf([43_200, 86_400]);
      const saturday = ny(19, 14, 0);
      expect(planSeat(saturday, new Set(), fair)?.durationSecs).to.be.oneOf([43_200, 86_400]);
    });

    it("never opens a seat that could not be taken fairly at either end of its window", () => {
      // 7:30 PM: a 15 minute seat open 90 minutes could still be taken after 8 PM, when it would be refused.
      const evening = ny(15, 19, 30);
      const plan = planSeat(evening, new Set(), fair)!;
      expect(plan.durationSecs).to.not.equal(900);
      expect(fair(plan.a, plan.b, evening, plan.durationSecs, plan.expiresTs)).to.equal(true);
      expect(fair(plan.a, plan.b, plan.expiresTs - 120, plan.durationSecs, plan.expiresTs)).to.equal(true);
    });

    it("skips pairs already open, and opens nothing when every pair is", () => {
      const midday = ny(15, 11, 0);
      expect(planSeat(midday, new Set(["NVDA/AMD"]), fair)).to.deep.include({ a: "AAPL", b: "MSFT" });
      const all = new Set(SPAR_SEAT_PAIRS.map(([a, b]) => `${a}/${b}`));
      expect(planSeat(midday, all, fair)).to.equal(null);
      expect(planSeat(midday, new Set(), () => false)).to.equal(null);
    });
  });
});
