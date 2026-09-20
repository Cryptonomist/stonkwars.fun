/* What a returning fighter is told. The failure this exists for is silence: a
 * 12 hour seat taken on Saturday, a tab closed, and on Sunday not a word about
 * the result. The opposite failure matters as much: telling somebody the same
 * thing twice, or inventing news on a first visit. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import {
  OUTCOME_CREATOR,
  OUTCOME_NONE,
  OUTCOME_OPPONENT,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_SETTLED,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { DIGEST_MAX, sinceLastVisit } from "../src/lib/sinceLastVisit";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => new PublicKey(MINTS.get(ticker)!);
const at = (price: number): PricePoint => ({ price: BigInt(Math.round(price * 1e4)), expo: -4, publishTime: 1 });
const NONE: PricePoint = { price: BigInt(0), expo: -8, publishTime: 0 };

const NOW = 1_789_100_000;
const LEFT = NOW - 40_000; // about eleven hours ago
const ME = PublicKey.unique();
const THEM = PublicKey.unique();

function duel(partial: Partial<DuelView>): DuelView {
  return {
    address: PublicKey.unique(),
    creator: THEM,
    opponent: PublicKey.default,
    status: STATUS_OPEN,
    outcome: OUTCOME_NONE,
    seed: BigInt(1),
    invitee: PublicKey.default,
    winner: PublicKey.default,
    creatorMint: mint("NVDA"),
    opponentMint: mint("AMD"),
    creatorTokenProgram: PublicKey.default,
    opponentTokenProgram: PublicKey.default,
    creatorFeed: "",
    opponentFeed: "",
    creatorSource: 1,
    opponentSource: 1,
    oracle: PublicKey.default,
    creatorAmount: BigInt(14_800_000),
    opponentAmount: BigInt(23_400_000),
    durationSecs: 43_200,
    endTs: 0,
    expiresTs: NOW + 3_600,
    createdTs: LEFT - 50_000,
    acceptedTs: 0,
    startTs: 0,
    creatorStart: NONE,
    opponentStart: NONE,
    creatorEnd: NONE,
    opponentEnd: NONE,
    taunt: "",
    ...partial,
  } as DuelView;
}

/** A settled fight I took (I am the opponent, backing AMD). */
const settled = (outcome: number, endTs: number) =>
  duel({
    opponent: ME,
    status: STATUS_SETTLED,
    outcome,
    acceptedTs: endTs - 43_200,
    startTs: endTs - 43_190,
    endTs,
    creatorStart: at(200),
    creatorEnd: at(201),
    opponentStart: at(100),
    opponentEnd: outcome === OUTCOME_OPPONENT ? at(102) : at(100.1),
  });

const me = ME.toBase58();

describe("what a returning fighter is told", () => {
  it("tells a win that landed overnight, in the winner's tone, with what was taken", () => {
    const d = settled(OUTCOME_OPPONENT, NOW - 5_000);
    const [n] = sinceLastVisit([d], me, LEFT, NOW);
    expect(n.tone).to.equal("win");
    expect(n.title).to.match(/^While you were away: AMD won and took .* NVDAx\.$/);
    expect(n.href).to.equal(`/f/${d.address.toBase58()}`);
    expect(n.id).to.equal(`${d.address.toBase58()}:bell`);
  });

  it("tells a loss as cooked, and offers the rematch", () => {
    const [n] = sinceLastVisit([settled(OUTCOME_CREATOR, NOW - 5_000)], me, LEFT, NOW);
    expect(n.tone).to.equal("cooked");
    expect(n.title).to.match(/cooked\. NVDA beat AMD by .* points\. Run it back\?$/);
  });

  it("tells a call-out made since, and a challenge of mine that was taken", () => {
    const called = duel({ invitee: ME, createdTs: NOW - 900 });
    const taken = duel({ creator: ME, opponent: THEM, status: STATUS_LIVE, acceptedTs: NOW - 600, endTs: NOW + 40_000 });
    const titles = sinceLastVisit([called, taken], me, LEFT, NOW).map((n) => n.title);
    expect(titles).to.deep.equal([
      "While you were away, your NVDA challenge was taken.",
      "You were called out while you were away: NVDA vs AMD.",
    ]);
  });

  it("says nothing on a first visit, without a wallet, or about other people's fights", () => {
    const d = settled(OUTCOME_OPPONENT, NOW - 5_000);
    expect(sinceLastVisit([d], me, null, NOW)).to.deep.equal([]);
    expect(sinceLastVisit([d], null, LEFT, NOW)).to.deep.equal([]);
    const theirs = duel({ opponent: PublicKey.unique(), status: STATUS_SETTLED, outcome: OUTCOME_OPPONENT, endTs: NOW - 5_000 });
    expect(sinceLastVisit([theirs], me, LEFT, NOW)).to.deep.equal([]);
  });

  it("does not repeat what was seen before leaving, or what a toast already told", () => {
    const old = settled(OUTCOME_OPPONENT, LEFT - 7_200);
    expect(sinceLastVisit([old], me, LEFT, NOW)).to.deep.equal([]);
    const fresh = settled(OUTCOME_OPPONENT, NOW - 5_000);
    const told = new Set([`${fresh.address.toBase58()}:bell`]);
    expect(sinceLastVisit([fresh], me, LEFT, NOW, told)).to.deep.equal([]);
  });

  it("still tells a bell that rang just before leaving, when the result had not been posted yet", () => {
    const d = settled(OUTCOME_OPPONENT, LEFT - 300);
    expect(sinceLastVisit([d], me, LEFT, NOW)).to.have.length(1);
  });

  it("ignores an expired call-out, caps the list, and looks back a week at most", () => {
    expect(sinceLastVisit([duel({ invitee: ME, createdTs: NOW - 900, expiresTs: NOW - 1 })], me, LEFT, NOW)).to.deep.equal([]);
    const many = Array.from({ length: 9 }, (_, i) => settled(OUTCOME_OPPONENT, NOW - 1_000 - i * 100));
    const got = sinceLastVisit(many, me, LEFT, NOW);
    expect(got).to.have.length(DIGEST_MAX);
    expect(got[0].href).to.equal(`/f/${many[0].address.toBase58()}`, "newest first");
    const ancient = settled(OUTCOME_OPPONENT, NOW - 9 * 86_400);
    expect(sinceLastVisit([ancient], me, NOW - 30 * 86_400, NOW)).to.deep.equal([]);
  });
});
