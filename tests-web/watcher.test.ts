/* The toasts a fighter gets come from comparing two reads of the duel list.
 * These pin every transition that speaks, the silence of the first read, and
 * the silence about fights the viewer is not in and has not opened. Fixtures
 * use real devnet test mints, so tickers resolve the way the page resolves them. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import {
  OUTCOME_CREATOR,
  OUTCOME_NONE,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  OUTCOME_VOID,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { diffFights } from "../src/lib/watcher";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => {
  const m = MINTS.get(ticker);
  if (!m) throw new Error(`${ticker} has no devnet mint`);
  return new PublicKey(m);
};

const px = (dollars: number): PricePoint => ({ price: BigInt(Math.round(dollars * 1e8)), expo: -8, publishTime: 0 });
const NONE = px(0);
const shares = (n: number) => BigInt(Math.round(n * 1e8));

const T0 = 1_789_000_000;
const ME = PublicKey.unique();
const THEM = PublicKey.unique();
const SPECTATOR = PublicKey.unique();

function makeDuel(partial: Partial<DuelView> = {}): DuelView {
  return {
    address: PublicKey.unique(),
    creator: ME,
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
    creatorAmount: shares(0.1),
    opponentAmount: shares(0.11),
    durationSecs: 300,
    endTs: 0,
    expiresTs: T0 + 86_400,
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

/** The same account, one step further on. */
const later = (d: DuelView, patch: Partial<DuelView>): DuelView => ({ ...d, ...patch });

const taken = { opponent: THEM, status: STATUS_ACCEPTED, acceptedTs: T0 + 60 };
const live = { ...taken, status: STATUS_LIVE, startTs: T0 + 62, endTs: T0 + 362 };
/* NVDA 100 to 101 (+1%), AAPL 200 to 201.42 (+0.71%): NVDA by 0.29 points. */
const prices = {
  creatorStart: px(100),
  creatorEnd: px(101),
  opponentStart: px(200),
  opponentEnd: px(201.42),
};
const creatorWins = { ...live, ...prices, status: STATUS_SETTLED, outcome: OUTCOME_CREATOR };
const opponentWins = { ...live, ...prices, status: STATUS_SETTLED, outcome: OUTCOME_OPPONENT };

const me = ME.toBase58();
const NOW = T0 + 100;

describe("diffFights", () => {
  it("says nothing on the first read", () => {
    const d = makeDuel({ invitee: ME, creator: THEM });
    expect(diffFights([], [d], me, [], NOW)).to.deep.equal([]);
  });

  it("tells the creator their challenge was taken, linking the fight", () => {
    const d = makeDuel();
    const [n, ...rest] = diffFights([d], [later(d, taken)], me, [], NOW);
    expect(rest).to.have.length(0);
    expect(n.title).to.equal("Your NVDA challenge was taken.");
    expect(n.tone).to.equal("neutral");
    expect(n.href).to.equal(`/f/${d.address.toBase58()}`);
    expect(n.id).to.equal(`${d.address.toBase58()}:taken`);
  });

  it("does not tell the taker their own take", () => {
    const d = makeDuel({ creator: THEM });
    expect(diffFights([d], [later(d, { ...taken, opponent: ME })], me, [], NOW)).to.deep.equal([]);
  });

  it("tells the creator both when a fight is taken and started between two reads", () => {
    const d = makeDuel();
    const titles = diffFights([d], [later(d, live)], me, [], NOW).map((n) => n.title);
    expect(titles).to.deep.equal(["Your NVDA challenge was taken.", "Round live: NVDA vs AAPL."]);
  });

  it("announces a live round to both fighters", () => {
    const d = makeDuel(taken);
    const next = later(d, live);
    expect(diffFights([d], [next], me, [], NOW).map((n) => n.title)).to.deep.equal(["Round live: NVDA vs AAPL."]);
    expect(diffFights([d], [next], THEM.toBase58(), [], NOW).map((n) => n.title)).to.deep.equal([
      "Round live: NVDA vs AAPL.",
    ]);
  });

  it("pays the winner in the loser's shares, in the win tone", () => {
    const d = makeDuel(live);
    const [n] = diffFights([d], [later(d, creatorWins)], me, [], NOW);
    expect(n.title).to.equal("Bell. You took 0.11 AAPLx.");
    expect(n.tone).to.equal("win");
  });

  it("tells the loser who beat them, by how many percentage points", () => {
    const d = makeDuel(live);
    const [n] = diffFights([d], [later(d, opponentWins)], me, [], NOW);
    expect(n.title).to.equal("Cooked. AAPL beat NVDA by 0.29 percentage points. Run it back?");
    expect(n.tone).to.equal("cooked");
  });

  it("tells a watcher who did not fight only that it is final", () => {
    const d = makeDuel({ ...live, creator: THEM, opponent: SPECTATOR });
    const [n] = diffFights([d], [later(d, creatorWins)], me, [d.address.toBase58()], NOW);
    expect(n.title).to.equal("NVDA vs AAPL is final.");
    expect(n.tone).to.equal("neutral");
  });

  it("calls a tie a dead heat", () => {
    const d = makeDuel(live);
    const next = later(d, { ...prices, status: STATUS_REFUNDED, outcome: OUTCOME_TIE });
    expect(diffFights([d], [next], me, [], NOW).map((n) => n.title)).to.deep.equal(["Dead heat. Both stakes home."]);
  });

  it("says a voided fight sent both stakes home", () => {
    const d = makeDuel(taken);
    const next = later(d, { status: STATUS_VOID, outcome: OUTCOME_VOID });
    expect(diffFights([d], [next], me, [], NOW).map((n) => n.title)).to.deep.equal([
      "NVDA vs AAPL voided. Both stakes home.",
    ]);
  });

  it("tells a wallet it was called out when a new challenge names it", () => {
    const old = makeDuel({ creator: THEM });
    const call = makeDuel({ creator: THEM, invitee: ME });
    const [n, ...rest] = diffFights([old], [old, call], me, [], NOW);
    expect(rest).to.have.length(0);
    expect(n.title).to.equal("You were called out: NVDA vs AAPL.");
    expect(n.href).to.equal(`/f/${call.address.toBase58()}`);
  });

  it("does not call out with a challenge that has already expired", () => {
    const old = makeDuel({ creator: THEM });
    const call = makeDuel({ creator: THEM, invitee: ME, expiresTs: NOW - 1 });
    expect(diffFights([old], [old, call], me, [], NOW)).to.deep.equal([]);
  });

  it("stays quiet about fights the viewer is not in and has not opened", () => {
    const d = makeDuel({ creator: THEM });
    const e = makeDuel({ ...live, creator: THEM, opponent: SPECTATOR });
    const fresh = makeDuel({ creator: THEM, invitee: SPECTATOR });
    const out = diffFights(
      [d, e],
      [later(d, { ...taken, opponent: SPECTATOR }), later(e, creatorWins), fresh],
      me,
      [],
      NOW,
    );
    expect(out).to.deep.equal([]);
  });

  it("follows a watched fight with no wallet connected", () => {
    const d = makeDuel({ ...taken, creator: THEM, opponent: SPECTATOR });
    const out = diffFights([d], [later(d, live)], null, [d.address.toBase58()], NOW);
    expect(out.map((n) => n.title)).to.deep.equal(["Round live: NVDA vs AAPL."]);
  });

  it("says nothing when a status has not changed", () => {
    const d = makeDuel(live);
    expect(diffFights([d], [later(d, {})], me, [d.address.toBase58()], NOW)).to.deep.equal([]);
  });
});
