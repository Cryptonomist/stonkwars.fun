/* The settler pass's promises: it waits for a price instead of dropping the
 * job, one stuck fight cannot hold the others, one failed read does not lose a
 * whole pass, a fight whose market is shut costs nobody a request, and a fight
 * somebody else already moved costs nothing at all.
 *
 * NOTHING HERE TOUCHES A NETWORK. The Connection is a stub that keeps duel
 * accounts in a map and records what would have been sent; the oracle's quote
 * function and Hermes are stubs too. Live fights on devnet are never read. */

import { expect } from "chai";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import type { HermesClient } from "@pythnetwork/hermes-client";

import {
  chooseJobs,
  crankJob,
  crankOnce,
  listJobs,
  NotYet,
  signedQuotes,
  type CrankJob,
  type JobOptions,
  type QuoteSymbol,
} from "../src/lib/crank";
import { SendFailed, sendInOrder } from "../src/lib/crankTx";
import {
  coder,
  duelsWithStatus,
  PROGRAM_ID,
  SOURCE_PYTH,
  SOURCE_SIGNED,
  START_DELAY_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_VOID,
  TOKEN_PROGRAM_ID,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS, firstBarEnd, type quoteAt } from "../src/lib/oracle";
import { byTicker, quoteSymbolFor } from "../src/lib/stocks";

const nowSecs = () => Math.floor(Date.now() / 1000);
const ny = (day: number, hh: number, mm: number, ss = 0) => Math.floor(nyToMs(2026, 9, day, hh, mm, ss) / 1000);
const key = () => Keypair.generate().publicKey;
const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

const oracle = Keypair.generate();
const payer = Keypair.generate();

/* ─── A duel, as the chain would hold it ──────────────────────────────────── */

let feedCounter = 0x10;
const zero: PricePoint = { price: 0n, expo: 0, publishTime: 0 };

function duel(over: Partial<DuelView>): DuelView {
  return {
    address: key(),
    creator: key(),
    opponent: key(),
    status: STATUS_ACCEPTED,
    outcome: 0,
    seed: 1n,
    invitee: PublicKey.default,
    winner: PublicKey.default,
    creatorMint: key(),
    opponentMint: key(),
    creatorTokenProgram: TOKEN_PROGRAM_ID,
    opponentTokenProgram: TOKEN_PROGRAM_ID,
    creatorFeed: hex(feedCounter++),
    opponentFeed: hex(feedCounter++),
    creatorSource: SOURCE_SIGNED,
    opponentSource: SOURCE_SIGNED,
    oracle: oracle.publicKey,
    creatorAmount: 100n,
    opponentAmount: 100n,
    durationSecs: 300,
    endTs: 0,
    expiresTs: 0,
    createdTs: 0,
    acceptedTs: 0,
    startTs: 0,
    creatorStart: zero,
    opponentStart: zero,
    creatorEnd: zero,
    opponentEnd: zero,
    taunt: "",
    ...over,
  };
}

const bn = (n: bigint | number) => new BN(n.toString());
const point = (p: PricePoint) => ({ price: bn(p.price), expo: p.expo, publish_time: bn(p.publishTime) });

/** The account bytes for a duel, through the program's own IDL. */
async function encode(d: DuelView): Promise<Buffer> {
  const feed = (h: string) => [...Buffer.from(h, "hex")];
  return coder.accounts.encode("Duel", {
    creator: d.creator,
    opponent: d.opponent,
    status: d.status,
    outcome: d.outcome,
    seed: bn(d.seed),
    invitee: d.invitee,
    winner: d.winner,
    creator_mint: d.creatorMint,
    opponent_mint: d.opponentMint,
    creator_token_program: d.creatorTokenProgram,
    opponent_token_program: d.opponentTokenProgram,
    creator_feed: feed(d.creatorFeed),
    opponent_feed: feed(d.opponentFeed),
    creator_source: d.creatorSource,
    opponent_source: d.opponentSource,
    oracle: d.oracle,
    creator_amount: bn(d.creatorAmount),
    opponent_amount: bn(d.opponentAmount),
    duration_secs: bn(d.durationSecs),
    end_ts: bn(d.endTs),
    expires_ts: bn(d.expiresTs),
    created_ts: bn(d.createdTs),
    accepted_ts: bn(d.acceptedTs),
    start_ts: bn(d.startTs),
    creator_start: point(d.creatorStart),
    opponent_start: point(d.opponentStart),
    creator_end: point(d.creatorEnd),
    opponent_end: point(d.opponentEnd),
    bump: 255,
    taunt: d.taunt,
  });
}

/* ─── A chain that is not there ───────────────────────────────────────────── */

const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const statusOfFilter = (filters: GetProgramAccountsFilter[]) => {
  const bytes = (filters[1] as { memcmp: { bytes: string } }).memcmp.bytes;
  return [STATUS_ACCEPTED, STATUS_LIVE, STATUS_VOID].find(
    (s) => (duelsWithStatus(s)[1] as { memcmp: { bytes: string } }).memcmp.bytes === bytes,
  );
};

class StubChain {
  accounts = new Map<string, Buffer>();
  /** Per status: throw to make that list fail. */
  failList = new Set<number>();
  /** Every sendRawTransaction call, whether it was forwarded or refused. */
  sendCalls: { at: number; skipPreflight: boolean }[] = [];
  /** Transactions the stub forwarded. */
  forwarded: { at: number; signature: string }[] = [];
  refuse: (call: number) => Error | null = () => null;
  statusCalls = 0;
  blockhashCalls = 0;
  infoCalls = 0;

  async put(...duels: DuelView[]) {
    for (const d of duels) this.accounts.set(d.address.toBase58(), await encode(d));
  }

  conn(): Connection {
    const self = this;
    return {
      async getProgramAccounts(_program: PublicKey, config: { filters: GetProgramAccountsFilter[] }) {
        const status = statusOfFilter(config.filters)!;
        if (self.failList.has(status)) throw new Error("429 Too Many Requests");
        const out = [];
        for (const [address, data] of self.accounts) {
          if (coder.accounts.decode("Duel", data).status === status) {
            out.push({ pubkey: new PublicKey(address), account: { data, owner: PROGRAM_ID, lamports: 1, executable: false } });
          }
        }
        return out;
      },
      async getAccountInfo(address: PublicKey) {
        self.infoCalls++;
        const data = self.accounts.get(address.toBase58());
        return data ? { data, owner: PROGRAM_ID, lamports: 1, executable: false } : null;
      },
      async getLatestBlockhash() {
        self.blockhashCalls++;
        return { blockhash: BLOCKHASH, lastValidBlockHeight: 1_000_000 };
      },
      async sendRawTransaction(raw: Uint8Array | Buffer | number[], opts?: { skipPreflight?: boolean }) {
        const call = self.sendCalls.push({ at: Date.now(), skipPreflight: !!opts?.skipPreflight });
        const refusal = self.refuse(call);
        if (refusal) throw refusal;
        // The first signature, after the one-byte count.
        const signature = utils.bytes.bs58.encode(Buffer.from(Uint8Array.from(raw as Uint8Array).subarray(1, 65)));
        self.forwarded.push({ at: Date.now(), signature });
        return signature;
      },
      async getSignatureStatuses(sigs: string[]) {
        self.statusCalls++;
        return { context: { slot: 1 }, value: sigs.map(() => ({ confirmationStatus: "confirmed", err: null })) };
      },
      async getBlockHeight() {
        return 1;
      },
      async getSignatureStatus() {
        return { context: { slot: 1 }, value: { confirmationStatus: "confirmed", err: null } };
      },
    } as unknown as Connection;
  }
}

/* ─── Prices that are not there either ────────────────────────────────────── */

/** Every stub stock trades in Hong Kong: always its own exchange's bars, so
 *  the clock is the plain minute close whatever day the suite runs. */
const hk: QuoteSymbol = (feed) => ({ symbol: `T${feed.slice(0, 4)}`, currency: "USD", market: "HK" });

const goodQuote: typeof quoteAt = async (o) => ({
  feed: o.feed,
  boundary: o.boundary,
  price: 1_000_000n,
  expo: -4,
  publishTime: firstBarEnd(o.boundary),
});

const refusedBy = (code: string, message: string) =>
  new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: "Transaction simulation failed: Error processing Instruction 3: custom program error",
    logs: [
      `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
      `Program log: AnchorError thrown in programs/duel/src/lib.rs:455. Error Code: ${code}. Error Number: 6015. Error Message: ${message}.`,
      `Program ${PROGRAM_ID.toBase58()} failed: custom program error`,
    ],
  });

const ctx = (chain: StubChain, over: Partial<JobOptions> = {}): JobOptions => ({
  conn: chain.conn(),
  payer,
  oracle,
  quoteSymbol: hk,
  quoteAt: goodQuote,
  ...over,
});

/** A job as listJobs would hand it over. */
const jobOf = (d: DuelView, kind: CrankJob["kind"], readyAt: number): CrankJob => ({ duel: d, kind, readyAt, why: "minute-close" });

describe("settler pass", () => {
  /* The old pass dropped a price that was not final yet and left it for the
   * next ping, a minute later. Now the job waits the few seconds and goes. */
  it("waits out a not-yet and sends once, no earlier than the price", async function () {
    this.timeout(10_000);
    const chain = new StubChain();
    const d = duel({ acceptedTs: nowSecs() - 600 });
    await chain.put(d);

    const readyAt = Math.ceil(Date.now() / 1000) + 2;
    let early = 0;
    const quote: typeof quoteAt = async (o) => {
      if (Date.now() < readyAt * 1000) {
        early++;
        throw new NotYet("the bar is still forming", readyAt);
      }
      return goodQuote(o);
    };

    const out = await crankJob(ctx(chain, { quoteAt: quote }), jobOf(d, "start", nowSecs() - 1), Date.now() + 9_000);
    expect(out.state, out.detail).to.equal("sent");
    expect(chain.forwarded).to.have.length(1);
    expect(out.signature).to.equal(chain.forwarded[0].signature);
    expect(chain.forwarded[0].at).to.be.at.least(readyAt * 1000);
    // One early attempt (both sides asked together), and no hammering after it.
    expect(early).to.be.within(1, 2);
    // Sent with preflight on, and confirmed by polling.
    expect(chain.sendCalls[0].skipPreflight).to.equal(false);
    expect(chain.statusCalls).to.be.greaterThan(0);
  });

  it("asks again at the next minute close when a late bar still has no price", async () => {
    const d = duel({ acceptedTs: nowSecs() - 600 });
    const before = nowSecs();
    const err = await signedQuotes({
      duel: d,
      boundary: d.acceptedTs + START_DELAY_SECS,
      which: "start",
      oracle,
      quoteSymbol: hk,
      quoteAt: async () => null,
    }).catch((e: unknown) => e);
    const after = nowSecs();
    expect(err).to.be.instanceOf(NotYet);
    const next = (now: number) => firstBarEnd(now - BAR_SETTLE_SECS) + BAR_SETTLE_SECS;
    expect([next(before), next(after)]).to.include((err as NotYet).readyAt);
  });

  it("lets seven fights through while an eighth hangs", async function () {
    this.timeout(10_000);
    const chain = new StubChain();
    const duels = Array.from({ length: 8 }, () => duel({ acceptedTs: nowSecs() - 600 }));
    await chain.put(...duels);
    const hung = duels[3].creatorFeed;
    const quote: typeof quoteAt = (o) => (o.feed === hung ? new Promise(() => {}) : goodQuote(o));

    const t0 = Date.now();
    const deadlineMs = t0 + 6_000;
    const results = await crankOnce({
      ...ctx(chain, { quoteAt: quote, attemptTimeoutMs: 1_500 }),
      limit: 8,
      concurrency: 4,
      deadlineMs,
    });
    const took = Date.now() - t0;

    expect(results).to.have.length(8);
    const stuck = results.filter((r) => r.duel === duels[3].address.toBase58());
    expect(stuck[0].state).to.equal("failed");
    expect(stuck[0].detail).to.match(/timed out/);
    const rest = results.filter((r) => r !== stuck[0]);
    expect(rest.map((r) => r.state)).to.deep.equal(Array(7).fill("sent"));
    expect(chain.forwarded).to.have.length(7);
    /* Not merely before the deadline: before the hung attempt was even given
     * up on. A pass that ran jobs one at a time would pass every other check
     * here, with the four behind the hung one sent after its timeout. */
    for (const s of chain.forwarded) expect(s.at - t0).to.be.below(1_000);
    // The pass answered when the hung attempt was abandoned, not at the deadline.
    expect(took).to.be.below(3_500);
  });

  it("still lists starts and refunds when the live list fails", async () => {
    const chain = new StubChain();
    const now = nowSecs();
    const start = duel({ acceptedTs: now - 600 });
    const settle = duel({ status: STATUS_LIVE, acceptedTs: now - 900, endTs: now - 300 });
    const voided = duel({ status: STATUS_VOID });
    await chain.put(start, settle, voided);
    chain.failList.add(STATUS_LIVE);

    const listing = await listJobs(chain.conn(), now, { lookup: hk });
    expect(listing.due.map((j) => [j.duel.address.toBase58(), j.kind])).to.have.deep.members([
      [start.address.toBase58(), "start"],
      [voided.address.toBase58(), "refund"],
    ]);
    expect(listing.errors).to.have.length(1);
    expect(listing.errors[0]).to.match(/settle list/);

    chain.failList.add(STATUS_ACCEPTED).add(STATUS_VOID);
    const err = await listJobs(chain.conn(), now, { lookup: hk }).catch((e: Error) => e);
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.match(/Could not list any duels/);
  });

  it("does not call a settle due before its price, and waits for it within the lookahead", async () => {
    const chain = new StubChain();
    const now = nowSecs();
    const bell = duel({ status: STATUS_LIVE, acceptedTs: now - 900, endTs: now - 5 });
    await chain.put(bell);
    const at = firstBarEnd(bell.endTs) + BAR_SETTLE_SECS;
    expect((await listJobs(chain.conn(), at - 1, { lookup: hk })).due).to.have.length(0);
    const ahead = await listJobs(chain.conn(), at - 30, { lookup: hk, lookaheadSecs: 40 });
    expect(ahead.due.map((j) => j.readyAt)).to.deep.equal([at]);
  });

  /* 4yf7: TSLA priced by Pyth, accepted on a Saturday. Pyth's regular US feed
   * does not print until Monday's open, so the fight is parked: no Hermes
   * call, no quote, no slot, all weekend. */
  it("parks a 4yf7-like fight with no call to Hermes or the oracle", async () => {
    const chain = new StubChain();
    const d = duel({
      creatorFeed: byTicker("TSLA")!.feed,
      creatorSource: SOURCE_PYTH,
      opponentFeed: byTicker("NVDA")!.feed,
      acceptedTs: ny(12, 22, 14, 0) - START_DELAY_SECS,
    });
    await chain.put(d);
    const hermes = {
      getPriceUpdatesAtTimestamp: () => {
        throw new Error("Hermes must not be asked about a parked fight");
      },
    } as unknown as HermesClient;
    const quote: typeof quoteAt = () => {
      throw new Error("the oracle must not be asked about a parked fight");
    };
    const sunday = ny(13, 12, 0);

    const listing = await listJobs(chain.conn(), sunday, { lookup: quoteSymbolFor, lookaheadSecs: 40 });
    expect(listing.due).to.have.length(0);
    expect(listing.parked).to.deep.equal([{ duel: d.address.toBase58(), kind: "start", shut: ["TSLA"] }]);

    const results = await crankOnce({
      ...ctx(chain, { hermes, quoteAt: quote, quoteSymbol: quoteSymbolFor }),
      now: sunday,
      lookaheadSecs: 40,
    });
    expect(results).to.deep.equal([]);
    expect(chain.infoCalls).to.equal(0);
    expect(chain.sendCalls).to.have.length(0);
  });

  /* A nudge or a person settled it a moment ago, and this RPC node has not
   * caught up. Preflight runs the program, the program says NotLive, and the
   * crank calls it done having paid nothing. */
  it("takes a preflight NotLive as done, with nothing sent", async () => {
    const chain = new StubChain();
    const now = nowSecs();
    const d = duel({ status: STATUS_LIVE, acceptedTs: now - 900, endTs: now - 600 });
    await chain.put(d);
    chain.refuse = () => refusedBy("NotLive", "This duel is not live");

    const out = await crankJob(ctx(chain), jobOf(d, "settle", now - 500), Date.now() + 10_000);
    expect(out.state, out.detail).to.equal("done");
    expect(chain.sendCalls).to.have.length(1);
    expect(chain.sendCalls[0].skipPreflight).to.equal(false);
    expect(chain.forwarded).to.have.length(0);
    expect(chain.statusCalls).to.equal(0);
  });

  it("calls a job done without a quote when its status has already moved", async () => {
    const chain = new StubChain();
    const listed = duel({ acceptedTs: nowSecs() - 600 });
    await chain.put({ ...listed, status: STATUS_LIVE });
    const quote: typeof quoteAt = () => {
      throw new Error("no quote is needed for a fight already started");
    };
    const out = await crankJob(ctx(chain, { quoteAt: quote }), jobOf(listed, "start", nowSecs() - 1), Date.now() + 5_000);
    expect(out.state).to.equal("done");
    expect(chain.sendCalls).to.have.length(0);
  });

  it("reports a price that will not exist before the deadline as not yet, without waiting", async () => {
    const chain = new StubChain();
    const d = duel({ acceptedTs: nowSecs() - 600 });
    await chain.put(d);
    const t0 = Date.now();
    const out = await crankJob(ctx(chain), jobOf(d, "start", nowSecs() + 30), Date.now() + 10_000);
    expect(out.state).to.equal("not-yet");
    expect(Date.now() - t0).to.be.below(500);
    expect(chain.infoCalls).to.equal(0);
  });

  it("takes the newest fights first and still reaches the oldest", () => {
    const d = duel({});
    const jobs = Array.from({ length: 12 }, (_, i) => jobOf(d, "start", i + 1));
    expect(chooseJobs(jobs, 8).map((j) => j.readyAt)).to.deep.equal([12, 11, 10, 9, 8, 7, 2, 1]);
    expect(chooseJobs(jobs.slice(0, 5), 8).map((j) => j.readyAt)).to.deep.equal([5, 4, 3, 2, 1]);
  });

  describe("sending in order", () => {
    const tx = (lamports: number) => {
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key(), lamports })],
      }).compileToV0Message();
      const v = new VersionedTransaction(message);
      v.sign([payer]);
      return v;
    };
    const quiet = <T>(work: () => Promise<T>) => {
      const warn = console.warn;
      console.warn = () => {};
      return work().finally(() => (console.warn = warn));
    };

    /* The closes return the price posts' rent. A fight transaction that is
     * refused must not strand it. */
    it("sends the closes even when the fight transaction is refused", async () => {
      const chain = new StubChain();
      chain.refuse = (call) => (call === 2 ? refusedBy("NotAccepted", "This duel is not waiting for its start prices") : null);
      const err = await quiet(() =>
        sendInOrder(chain.conn(), [tx(1), tx(2)], {
          preflight: true,
          cleanup: [tx(3)],
          deadlineMs: Date.now() + 5_000,
          lastValidBlockHeight: 1_000_000,
        }).catch((e: unknown) => e),
      );
      expect(err).to.be.instanceOf(SendFailed);
      expect((err as SendFailed).stage).to.equal("preflight");
      expect((err as SendFailed).index).to.equal(1);
      expect(chain.sendCalls).to.have.length(3);
      expect(chain.forwarded).to.have.length(2);
      // The expiry came from the blockhash the transactions were built with.
      expect(chain.blockhashCalls).to.equal(0);
    });

    it("sends no closes when nothing was posted", async () => {
      const chain = new StubChain();
      chain.refuse = (call) => (call === 1 ? refusedBy("NotAccepted", "This duel is not waiting for its start prices") : null);
      await quiet(() =>
        sendInOrder(chain.conn(), [tx(1), tx(2)], { preflight: true, cleanup: [tx(3)], lastValidBlockHeight: 1 }).catch(
          () => null,
        ),
      );
      expect(chain.sendCalls).to.have.length(1);
    });
  });
});
