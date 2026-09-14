/* The sparring wallet takes only what a lone visitor's demo needs: an open,
 * unexpired challenge addressed to it, from somebody else, on a timed round
 * short enough to watch to the end. The market-hours rule is applied on top of
 * this at the take, by the same mixedHoursAt every other taker gets. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { STATUS_ACCEPTED, STATUS_OPEN } from "../src/lib/duel";
import { sparRefusal, SPAR_MAX_ROUND_SECS } from "../src/lib/spar";

const SPAR = PublicKey.unique();
const CREATOR = PublicKey.unique();
const NOW = 1_789_000_000;

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
  it("takes an open 5 or 15 minute challenge addressed to it", () => {
    expect(sparRefusal(challenge(), NOW, SPAR.toBase58())).to.equal(null);
    expect(sparRefusal(challenge({ durationSecs: 300 }), NOW, SPAR.toBase58())).to.equal(null);
  });

  it("leaves alone what is not addressed to it, or open to anyone", () => {
    expect(sparRefusal(challenge({ invitee: PublicKey.unique() }), NOW, SPAR.toBase58())).to.match(/not addressed/);
    expect(sparRefusal(challenge({ invitee: PublicKey.default }), NOW, SPAR.toBase58())).to.match(/not addressed/);
  });

  it("never takes its own challenge, a taken or expired one, or a long or fixed-end round", () => {
    expect(sparRefusal(challenge({ creator: SPAR }), NOW, SPAR.toBase58())).to.match(/own/);
    expect(sparRefusal(challenge({ status: STATUS_ACCEPTED }), NOW, SPAR.toBase58())).to.match(/not open/);
    expect(sparRefusal(challenge({ expiresTs: NOW }), NOW, SPAR.toBase58())).to.match(/expired/);
    expect(sparRefusal(challenge({ durationSecs: SPAR_MAX_ROUND_SECS + 1 }), NOW, SPAR.toBase58())).to.match(/rounds/);
    expect(sparRefusal(challenge({ durationSecs: 0, endTs: NOW + 7_200 }), NOW, SPAR.toBase58())).to.match(/rounds/);
  });
});
