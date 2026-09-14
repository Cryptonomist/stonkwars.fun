/* The readings every board takes from the duel list. A record shown on the
 * leaderboard and on a profile, an age on the Wire and a toast all come from
 * these, so they are pinned against fixtures built the way the chain builds a
 * duel: real devnet test mints, prices as mantissa and exponent, and the
 * timestamps the program writes. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import {
  calledOut,
  fightEvents,
  headToHead,
  inWindow,
  isRosterFight,
  lastBell,
  loserTake,
  margin,
  recordFor,
  records,
  tickerRecord,
} from "../src/lib/derive";
import {
  OUTCOME_CREATOR,
  OUTCOME_NONE,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { rankFighters } from "../src/lib/leaderboard";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => {
  const m = MINTS.get(ticker);
  if (!m) throw new Error(`${ticker} has no devnet mint`);
  return new PublicKey(m);
};

const EXPO = -8;
/** A price in dollars as the program stores it. */
const px = (dollars: number, publishTime = 0): PricePoint => ({
  price: BigInt(Math.round(dollars * 1e8)),
  expo: EXPO,
  publishTime,
});
const NONE = px(0);
const shares = (n: number) => BigInt(Math.round(n * 1e8));

const T0 = 1_789_000_000;

function makeDuel(partial: Partial<DuelView> = {}): DuelView {
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
    opponentMint: mint("AAPL"),
    creatorTokenProgram: PublicKey.default,
    opponentTokenProgram: PublicKey.default,
    creatorFeed: "",
    opponentFeed: "",
    creatorSource: 0,
    opponentSource: 0,
    oracle: PublicKey.default,
    creatorAmount: shares(0.1),
    opponentAmount: shares(0.1),
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

/** A settled fight between two wallets. `p1Move` and `p2Move` are percent. */
function fought(
  creator: PublicKey,
  opponent: PublicKey,
  endTs: number,
  p1Move: number,
  p2Move: number,
  extra: Partial<DuelView> = {},
): DuelView {
  const outcome = p1Move > p2Move ? OUTCOME_CREATOR : p2Move > p1Move ? OUTCOME_OPPONENT : OUTCOME_TIE;
  return makeDuel({
    creator,
    opponent,
    status: outcome === OUTCOME_TIE ? STATUS_REFUNDED : STATUS_SETTLED,
    outcome,
    createdTs: endTs - 900,
    acceptedTs: endTs - 600,
    startTs: endTs - 300,
    endTs,
    creatorStart: px(100),
    opponentStart: px(200),
    creatorEnd: px(100 * (1 + p1Move / 100)),
    opponentEnd: px(200 * (1 + p2Move / 100)),
    ...extra,
  });
}

describe("which fights are stock fights", () => {
  it("counts two listed stocks", () => {
    expect(isRosterFight(makeDuel())).to.equal(true);
  });

  it("leaves out a fight staked in test ETH", () => {
    expect(isRosterFight(makeDuel({ opponentMint: mint("ETHt") }))).to.equal(false);
    expect(isRosterFight(makeDuel({ creatorMint: PublicKey.unique() }))).to.equal(false);
  });
});

describe("what a win was worth", () => {
  it("values the loser's stake at the loser's own end price", () => {
    const a = PublicKey.unique();
    const b = PublicKey.unique();
    // AAPL (the answerer) loses: 0.1 shares at its end price of 196.
    const d = fought(a, b, T0, 1, -2);
    const take = loserTake(d)!;
    expect(take.ticker).to.equal("AAPL");
    expect(take.shares).to.equal(shares(0.1));
    expect(take.usd).to.be.closeTo(19.6, 1e-9);
  });

  it("is nothing for a dead heat or an unfinished fight", () => {
    const a = PublicKey.unique();
    const b = PublicKey.unique();
    expect(loserTake(fought(a, b, T0, 1, 1))).to.equal(null);
    expect(loserTake(makeDuel())).to.equal(null);
  });

  it("measures the margin in percentage points between the on-chain moves", () => {
    const d = fought(PublicKey.unique(), PublicKey.unique(), T0, -0.0108, -0.0046);
    expect(margin(d)).to.be.closeTo(0.0062, 1e-6);
    expect(margin(makeDuel())).to.equal(null);
  });
});

describe("the wire", () => {
  const now = T0 + 10_000;

  it("lists every step a settled fight took, newest first", () => {
    const d = fought(PublicKey.unique(), PublicKey.unique(), T0 + 5_000, 2, 1, { taunt: "cooked" });
    const events = fightEvents([d], now);
    expect(events.map((e) => e.kind)).to.deep.equal(["bell", "live", "taken", "opened"]);
    expect(events.map((e) => e.at)).to.deep.equal([T0 + 5_000, T0 + 4_700, T0 + 4_400, T0 + 4_100]);
    const bell = events[0];
    expect(bell.id).to.equal(`${d.address.toBase58()}:bell`);
    expect(bell.winnerSide).to.equal("p1");
    expect(bell.take?.ticker).to.equal("AAPL");
    expect(bell.margin).to.be.closeTo(1, 1e-9);
    expect(bell.taunt).to.equal("cooked");
  });

  it("interleaves fights by time and names every kind", () => {
    const open = makeDuel({ createdTs: T0 + 9_000 });
    const expired = makeDuel({ createdTs: T0, expiresTs: T0 + 8_000 });
    const live = makeDuel({
      status: STATUS_LIVE,
      opponent: PublicKey.unique(),
      acceptedTs: T0 + 7_000,
      startTs: T0 + 7_010,
      endTs: T0 + 7_310,
    });
    const heat = fought(PublicKey.unique(), PublicKey.unique(), T0 + 6_000, 0.5, 0.5);
    const events = fightEvents([open, expired, live, heat], now);
    expect(events.map((e) => e.kind)).to.deep.equal([
      "opened",
      "expired",
      "live",
      "taken",
      "heat",
      "live",
      "taken",
      "opened",
      "opened",
      "opened",
    ]);
    for (let i = 1; i < events.length; i++) expect(events[i - 1].at).to.be.at.least(events[i].at);
  });

  it("hides test-token fights unless asked", () => {
    const test = makeDuel({ creatorMint: mint("SOLt") });
    expect(fightEvents([test], now)).to.have.length(0);
    expect(fightEvents([test], now, { rosterOnly: false })).to.have.length(1);
  });
});

describe("a fighter's record", () => {
  const me = PublicKey.unique();
  const rival = PublicKey.unique();
  const other = PublicKey.unique();
  const wallet = me.toBase58();

  // Oldest to newest: W W L W W W T W, deliberately out of order in the list.
  const history = [
    fought(me, rival, T0 + 700, 2, 1), // W
    fought(rival, me, T0 + 100, 1, 3), // W, from the answering corner
    fought(me, other, T0 + 200, 3, 1), // W
    fought(me, rival, T0 + 300, -1, 1), // L
    fought(other, me, T0 + 400, 0, 1), // W
    fought(me, rival, T0 + 500, 1, 0), // W
    fought(me, other, T0 + 600, 0.4, 0.4), // T
    fought(rival, other, T0 + 800, 5, 1), // not mine
  ];

  it("counts wins, losses, ties and fights", () => {
    const r = recordFor(wallet, history);
    expect([r.wins, r.losses, r.ties, r.fights]).to.deep.equal([5, 1, 1, 7]);
    expect(r.lastTs).to.equal(T0 + 700);
  });

  it("keeps form oldest first, and counts the streak back from the latest result", () => {
    const r = recordFor(wallet, history);
    expect(r.form).to.deep.equal(["W", "W", "L", "W", "W", "T", "W"]);
    expect(r.streak).to.equal(1); // the tie ended a run of two
    expect(r.best).to.equal(2);
  });

  it("keeps only the last ten results", () => {
    const many = Array.from({ length: 12 }, (_, i) => fought(me, rival, T0 + i, i < 2 ? -1 : 1, 0));
    const r = recordFor(wallet, many);
    expect(r.form).to.have.length(10);
    expect(r.form.every((x) => x === "W")).to.equal(true);
    expect(r.best).to.equal(10);
  });

  it("adds up what was taken and what was lost at end prices", () => {
    const r = recordFor(wallet, history);
    const lossFight = history.find((d) => d.endTs === T0 + 300)!;
    expect(r.lost).to.be.closeTo(loserTake(lossFight)!.usd, 1e-9);
    const wins = history.filter((d) => d.endTs !== T0 + 300 && d.endTs !== T0 + 600 && d.endTs !== T0 + 800);
    expect(r.taken).to.be.closeTo(
      wins.reduce((s, d) => s + loserTake(d)!.usd, 0),
      1e-9,
    );
  });

  it("names rivals by fights, with the record against each", () => {
    const h = headToHead(wallet, history);
    expect(h[0].wallet).to.equal(rival.toBase58());
    expect([h[0].fights, h[0].wins, h[0].losses]).to.deep.equal([4, 3, 1]);
    expect(h[1].wallet).to.equal(other.toBase58());
    expect([h[1].fights, h[1].wins, h[1].ties]).to.deep.equal([3, 2, 1]);
  });
});

describe("ranking fighters", () => {
  it("ranks by money taken, then wins, then fewer losses", () => {
    const rich = PublicKey.unique();
    const busy = PublicKey.unique();
    const clean = PublicKey.unique();
    const sparring = PublicKey.unique();
    const duels = [
      // rich: one win against a big stake
      fought(rich, sparring, T0 + 1, 1, 0, { opponentAmount: shares(10) }),
      // busy: three small wins
      fought(busy, sparring, T0 + 2, 1, 0, { opponentAmount: shares(0.01) }),
      fought(busy, sparring, T0 + 3, 1, 0, { opponentAmount: shares(0.01) }),
      fought(busy, sparring, T0 + 4, 1, 0, { opponentAmount: shares(0.01) }),
      // clean: no wins and no losses, just a dead heat
      fought(clean, sparring, T0 + 5, 1, 1),
    ];
    const order = rankFighters(duels, 8).map((r) => r.wallet);
    expect(order.slice(0, 2)).to.deep.equal([rich.toBase58(), busy.toBase58()]);
    // Nothing taken by either: clean has no losses, sparring has four.
    expect(order.slice(2)).to.deep.equal([clean.toBase58(), sparring.toBase58()]);
    const second = rankFighters(duels, 8)[1];
    expect(second.winRate).to.equal(1);
    expect(second.form).to.deep.equal(["W", "W", "W"]);
  });
});

describe("records and time", () => {
  const a = PublicKey.unique();
  const b = PublicKey.unique();

  it("finds the closest finish, and does not count a dead heat as one", () => {
    const tie = fought(a, b, T0 + 1, 0.3, 0.3);
    const close = fought(a, b, T0 + 2, 0.31, 0.3);
    const wide = fought(a, b, T0 + 3, -4, 2);
    const r = records([tie, close, wide]);
    expect(r.closest?.address).to.equal(close.address.toBase58());
    expect(r.closest?.margin).to.be.closeTo(0.01, 1e-6);
    // The winner of the wide fight rose 2%, the biggest winning move here.
    expect(r.biggestMove?.address).to.equal(wide.address.toBase58());
    expect(r.biggestMove?.ticker).to.equal("AAPL");
    expect(r.biggestMove?.move).to.be.closeTo(2, 1e-6);
    expect(r.longestStreak).to.deep.equal({ wallet: a.toBase58(), best: 1 });
  });

  it("has no records before anything is settled", () => {
    expect(records([makeDuel()])).to.deep.equal({ closest: null, biggestMove: null, longestStreak: null });
    expect(lastBell([makeDuel()])).to.equal(0);
  });

  it("finds the last bell among results", () => {
    const live = makeDuel({ status: STATUS_LIVE, endTs: T0 + 900 });
    expect(lastBell([fought(a, b, T0 + 10, 1, 0), fought(a, b, T0 + 20, 1, 1), live])).to.equal(T0 + 20);
  });

  it("keeps fights with a bell inside the window", () => {
    const now = T0 + 100_000;
    const old = fought(a, b, now - 8 * 86_400, 1, 0);
    const week = fought(a, b, now - 3 * 86_400, 1, 0);
    const today = fought(a, b, now - 3_600, 1, 0);
    const open = makeDuel();
    expect(inWindow([old, week, today, open], 7 * 86_400, now)).to.deep.equal([week, today]);
    expect(inWindow([old, week, today, open], 86_400, now)).to.deep.equal([today]);
  });

  it("counts a stock's record from whichever corner it stood in", () => {
    const duels = [
      fought(a, b, T0 + 1, 1, 0), // NVDA wins
      fought(a, b, T0 + 2, 0, 1), // AAPL wins
      fought(a, b, T0 + 3, 1, 0, { creatorMint: mint("AAPL"), opponentMint: mint("MSFT") }), // AAPL wins
      makeDuel({ creatorMint: mint("AAPL"), opponentMint: mint("META") }),
    ];
    expect(tickerRecord("AAPL", duels, T0)).to.deep.equal({ fights: 3, wins: 2, losses: 1, ties: 0, open: 1 });
    expect(tickerRecord("AAPL", duels, T0 + 2 * 86_400).open).to.equal(0);
  });
});

describe("called out", () => {
  const me = PublicKey.unique();
  const now = T0 + 1_000;

  it("finds open challenges only this wallet may take", () => {
    const mine = makeDuel({ invitee: me });
    const anyone = makeDuel();
    const someoneElse = makeDuel({ invitee: PublicKey.unique() });
    const lapsed = makeDuel({ invitee: me, expiresTs: now - 1 });
    const taken = makeDuel({ invitee: me, status: STATUS_ACCEPTED, opponent: me, acceptedTs: now - 10 });
    expect(calledOut(me.toBase58(), [mine, anyone, someoneElse, lapsed, taken], now)).to.deep.equal([mine]);
  });
});
