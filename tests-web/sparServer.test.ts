/* The sparring wallet when things go wrong. It spends from the faucet key, once
 * a minute, with nobody watching, so its failure branches are about one thing:
 * when it cannot do the job properly it must do NOTHING, say why in words that
 * carry no key, and not try again in a loop.
 *
 * Throwaway keypairs, a stub for the chain and a stubbed fetch: no network, no
 * real key, and the assertion that matters in every case is that no
 * transaction was sent. */

import { expect } from "chai";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";

import devnet from "../src/data/stocks.devnet.json";
import { OUTCOME_NONE, STATUS_OPEN, type DuelView, type PricePoint } from "../src/lib/duel";
import { SEATS_PER_TICK } from "../src/lib/spar";
import { sparKeys, sparTick, takeForSpar } from "../src/lib/spar.server";
import { mixedHoursAt } from "../src/lib/stocks";

const MINTS = new Map((devnet as { tokens: { ticker: string; mint: string }[] }).tokens.map((t) => [t.ticker, t.mint]));
const mint = (ticker: string) => new PublicKey(MINTS.get(ticker)!);
const NONE: PricePoint = { price: BigInt(0), expo: -8, publishTime: 0 };

const keys = { spar: Keypair.generate(), faucet: Keypair.generate() };

/** A chain that counts what is sent to it, and can be told to fail its reads. */
function chain(opts: { accounts?: unknown[]; failList?: boolean } = {}) {
  const sent: unknown[] = [];
  const conn = {
    getProgramAccounts: async () => {
      if (opts.failList) throw new Error("429 Too Many Requests: https://rpc.example/?api-key=SECRET");
      return opts.accounts ?? [];
    },
    getTokenAccountBalance: async () => {
      throw new Error("could not find account");
    },
    getBalance: async () => 1_000_000_000,
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (tx: unknown) => {
      sent.push(tx);
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  } as unknown as Connection;
  return { conn, sent };
}

function callout(partial: Partial<DuelView> = {}): DuelView {
  const now = Math.floor(Date.now() / 1000);
  return {
    address: PublicKey.unique(),
    creator: PublicKey.unique(),
    opponent: PublicKey.default,
    status: STATUS_OPEN,
    outcome: OUTCOME_NONE,
    seed: BigInt(1),
    invitee: keys.spar.publicKey,
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
    creatorAmount: BigInt(10_000_000),
    opponentAmount: BigInt(10_000_000),
    durationSecs: 43_200,
    endTs: 0,
    expiresTs: now + 3_600,
    createdTs: now - 60,
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

describe("the sparring wallet when things go wrong", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    /* Every market data source is down for the length of each test. */
    globalThis.fetch = (async () => {
      throw new Error("connect ETIMEDOUT");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("says which setting is missing, and never a key, when it is not configured", () => {
    const got = sparKeys();
    expect(got).to.have.property("error");
    const why = (got as { error: string }).error;
    expect(why).to.match(/is not set|devnet only|does not match|JSON array/);
    expect(why).to.not.match(/\[\s*\d+\s*,/, "no key material in the message");
  });

  it("does not take a challenge it cannot value: no price, no stake, nothing sent", async () => {
    const { conn, sent } = chain();
    const d = callout();
    const got = await takeForSpar(conn, d, keys);
    expect(got.ok).to.equal(false);
    expect(sent).to.have.length(0);
    /* When the two markets line up right now, the refusal is the price; at an
     * hour when they do not, the hours rule speaks first. Either way: nothing. */
    const hours = mixedHoursAt("NVDA", "AMD", Math.floor(Date.now() / 1000), d, "taker");
    expect((got as { skipped: string }).skipped).to.equal(hours ?? "no live price to value the stake");
  });

  it("refuses what is not addressed to it, its own challenge and an open-ended round, before asking anything", async () => {
    const { conn, sent } = chain();
    let asked = 0;
    globalThis.fetch = (async () => {
      asked++;
      throw new Error("down");
    }) as typeof fetch;
    const cases: [Partial<DuelView>, RegExp][] = [
      [{ invitee: PublicKey.unique() }, /not addressed/],
      [{ creator: keys.spar.publicKey }, /its own challenge/],
      [{ durationSecs: 0 }, /timed rounds/],
      [{ durationSecs: 7 * 86_400 }, /timed rounds/],
      [{ expiresTs: 1 }, /expired/],
    ];
    for (const [partial, why] of cases) {
      const got = await takeForSpar(conn, callout(partial), keys);
      expect(got.ok).to.equal(false);
      expect((got as { skipped: string }).skipped).to.match(why);
    }
    expect(asked).to.equal(0, "a refusal on the rules costs no market data call");
    expect(sent).to.have.length(0);
  });

  it("with no prices, opens no seat, sends nothing, and stops at the first failure", async () => {
    const { conn, sent } = chain({ accounts: [{ pubkey: PublicKey.unique(), account: { data: Buffer.from("not a duel") } }] });
    const got = await sparTick(conn, keys);
    expect(got.takes).to.deep.equal([]);
    expect(got.seats).to.have.length(1, `one attempt, not ${SEATS_PER_TICK}: a seat that fails ends the loop`);
    expect(got.seats[0]).to.have.property("skipped");
    expect(sent).to.have.length(0);
  });

  it("lets a failed read of the chain fail the tick, for its caller to report, without sending", async () => {
    const { conn, sent } = chain({ failList: true });
    const err = await sparTick(conn, keys).catch((e: Error) => e);
    expect(err).to.be.instanceOf(Error);
    expect(sent).to.have.length(0);
  });
});
