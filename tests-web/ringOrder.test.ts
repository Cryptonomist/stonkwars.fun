/* The front page's board order.
 *
 * The bug this pins: a fight that can never start was sorted with the fights
 * waiting for their start, so "TSLA vs NVDA, taken, can never start" sat near
 * the top of the front page, the first thing a judge opening the site sees and
 * the one row on it that looked broken. Stuck fights go last and fall off a
 * full board. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import {
  OUTCOME_CREATOR,
  OUTCOME_NONE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_SETTLED,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { ringOrder } from "../src/lib/ringOrder";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => {
  const m = MINTS.get(ticker);
  if (!m) throw new Error(`no devnet mint for ${ticker}`);
  return new PublicKey(m);
};

const NONE: PricePoint = { price: BigInt(0), expo: -8, publishTime: 0 };
const T0 = 1_789_000_000;
const NOW = T0 + 3_600;

function duel(label: string, partial: Partial<DuelView>): DuelView & { label: string } {
  return {
    label,
    address: PublicKey.unique(),
    creator: PublicKey.unique(),
    opponent: PublicKey.default,
    status: STATUS_OPEN,
    outcome: OUTCOME_NONE,
    seed: BigInt(1),
    invitee: PublicKey.default,
    winner: PublicKey.default,
    creatorMint: mint("NVDA"),
    opponentMint: mint("AAPL"),
    creatorTokenProgram: PublicKey.default,
    opponentTokenProgram: PublicKey.default,
    creatorFeed: "",
    opponentFeed: "",
    creatorSource: 0,
    opponentSource: 0,
    oracle: PublicKey.default,
    creatorAmount: BigInt(1),
    opponentAmount: BigInt(1),
    durationSecs: 900,
    endTs: 0,
    expiresTs: NOW + 86_400,
    createdTs: T0,
    acceptedTs: 0,
    startTs: 0,
    creatorStart: NONE,
    opponentStart: NONE,
    creatorEnd: NONE,
    opponentEnd: NONE,
    taunt: "",
    ...partial,
  };
}

const labels = (ds: DuelView[]) => ds.map((d) => (d as DuelView & { label: string }).label);

describe("the front page's board order", () => {
  const live = duel("live", { status: STATUS_LIVE, acceptedTs: T0 + 100, endTs: NOW + 600 });
  const taken = duel("taken", { status: STATUS_ACCEPTED, acceptedTs: T0 + 200 });
  const stuck = duel("never starts", { status: STATUS_ACCEPTED, acceptedTs: T0 + 300 });
  const open = duel("open", { status: STATUS_OPEN, createdTs: T0 + 50 });
  const done = duel("result", { status: STATUS_SETTLED, outcome: OUTCOME_CREATOR, endTs: T0 + 10 });

  /* Stands in for "late, or can never be priced", which needs a clock and the
   * markets' hours to decide; the order is what is under test here. */
  const isStuck = (d: DuelView) => (d as DuelView & { label: string }).label === "never starts";

  it("puts a fight that can never start after everything still in play", () => {
    /* Newest take first would have put it above "taken", since it was taken
     * later. It must not lead the board just because it is recent. */
    const order = labels(ringOrder([stuck, taken, open, live, done], NOW, 10, isStuck));
    expect(order).to.deep.equal(["live", "taken", "open", "never starts", "result"]);
  });

  it("drops it altogether when the board is full", () => {
    const order = labels(ringOrder([stuck, taken, open, live, done], NOW, 3, isStuck));
    expect(order).to.deep.equal(["live", "taken", "open"]);
    expect(order).to.not.include("never starts");
  });

  it("leaves the order alone when nothing is stuck", () => {
    const order = labels(ringOrder([taken, open, live, done], NOW, 10, () => false));
    expect(order).to.deep.equal(["live", "taken", "open", "result"]);
  });

  it("leaves off an open challenge that has expired", () => {
    const expired = duel("expired", { status: STATUS_OPEN, expiresTs: NOW - 1 });
    expect(labels(ringOrder([expired, open], NOW, 10, () => false))).to.deep.equal(["open"]);
  });
});
