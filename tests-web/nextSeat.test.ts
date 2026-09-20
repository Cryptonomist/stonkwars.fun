/* The seat offered at the bell. It must be one the wallet can take this
 * second: offering a seat that waits for Monday's open, or the viewer's own
 * challenge, or the fight they are looking at, would be a button that leads
 * nowhere at the exact moment the session is decided. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import { OUTCOME_NONE, STATUS_LIVE, STATUS_OPEN, type DuelView, type PricePoint } from "../src/lib/duel";
import { nextSeat } from "../src/lib/nextSeat";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => new PublicKey(MINTS.get(ticker)!);
const NONE: PricePoint = { price: BigInt(0), expo: -8, publishTime: 0 };
const NOW = 1_789_003_600;

function seat(partial: Partial<DuelView> = {}): DuelView {
  return {
    address: PublicKey.unique(),
    creator: PublicKey.unique(),
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
    creatorAmount: BigInt(1),
    opponentAmount: BigInt(1),
    durationSecs: 900,
    endTs: 0,
    expiresTs: NOW + 3_600,
    createdTs: NOW - 600,
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

const me = PublicKey.unique().toBase58();
const free = () => null;

describe("the seat offered at the bell", () => {
  it("offers the open seat nearest its deadline", () => {
    const later = seat({ expiresTs: NOW + 9_000 });
    const sooner = seat({ expiresTs: NOW + 1_200 });
    expect(nextSeat([later, sooner], { wallet: me, now: NOW, blocked: free })?.duel).to.equal(sooner);
  });

  it("puts a seat the wallet can already stake ahead of a nearer one, to skip the faucet", () => {
    const nearer = seat({ expiresTs: NOW + 600 });
    const held = seat({ expiresTs: NOW + 9_000, opponentMint: mint("MSFT") });
    const pick = nextSeat([nearer, held], { wallet: me, now: NOW, blocked: free, holds: (d) => d === held });
    expect(pick?.duel).to.equal(held);
    expect(pick?.holdsStake).to.equal(true);
  });

  it("never offers a seat that cannot be taken fairly right now", () => {
    const waits = seat();
    const ready = seat({ expiresTs: NOW + 9_000 });
    const blocked = (d: DuelView) => (d === waits ? "NVDA's exchange is shut." : null);
    expect(nextSeat([waits, ready], { wallet: me, now: NOW, blocked })?.duel).to.equal(ready);
    expect(nextSeat([waits], { wallet: me, now: NOW, blocked })).to.equal(null);
  });

  it("never offers the fight being looked at, the viewer's own challenge, an expired one or a taken one", () => {
    const here = seat();
    const mine = seat({ creator: new PublicKey(me) });
    const expired = seat({ expiresTs: NOW - 1 });
    const live = seat({ status: STATUS_LIVE });
    const opts = { wallet: me, now: NOW, blocked: free, except: here.address.toBase58() };
    expect(nextSeat([here, mine, expired, live], opts)).to.equal(null);
  });

  it("offers a call-out only to the wallet it names, and open seats to a visitor with no wallet", () => {
    const forMe = seat({ invitee: new PublicKey(me) });
    const forThem = seat({ invitee: PublicKey.unique() });
    expect(nextSeat([forThem, forMe], { wallet: me, now: NOW, blocked: free })?.duel).to.equal(forMe);
    expect(nextSeat([forMe], { wallet: null, now: NOW, blocked: free })).to.equal(null);
    const anyone = seat();
    expect(nextSeat([anyone], { wallet: null, now: NOW, blocked: free })?.duel).to.equal(anyone);
  });

  it("says nothing before the clock is known", () => {
    expect(nextSeat([seat()], { wallet: me, now: 0, blocked: free })).to.equal(null);
  });
});
