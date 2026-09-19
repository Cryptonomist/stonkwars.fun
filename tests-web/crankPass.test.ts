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
  PERP_FAST_RETRY_WINDOW_SECS,
  PERP_SLOW_RETRY_SECS,
  retryAt,
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
  STATUS_SETTLED,
  STATUS_VOID,
  TOKEN_PROGRAM_ID,
  type DuelView,
  type PricePoint,
} from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { BAR_SETTLE_SECS, fetchPoolBars, firstBarEnd, type quoteAt } from "../src/lib/oracle";
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
  /** A signature the chain has not confirmed (yet): no status, no history. */
  pending: (signature: string) => boolean = () => false;
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
        return {
          context: { slot: 1 },
          value: sigs.map((s) => (self.pending(s) ? null : { confirmationStatus: "confirmed", err: null })),
        };
      },
      async getBlockHeight() {
        return 1;
      },
      async getSignatureStatus(s: string) {
        return { context: { slot: 1 }, value: self.pending(s) ? null : { confirmationStatus: "confirmed", err: null } };
      },
    } as unknown as Connection;
  }
}

/* ─── Prices that are not there either ────────────────────────────────────── */

/** Every stub stock trades on an exchange whose sessions are not modelled
 *  (market.ts models New York, Hong Kong and London): always its own bars, so
 *  the clock is the plain minute close whatever day and hour the suite runs. */
const hk: QuoteSymbol = (feed) => ({ symbol: `T${feed.slice(0, 4)}`, currency: "USD", market: "SOMEWHERE" });

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

/** Anchor's refusal while loading accounts, before the handler runs: what a
 *  second settle or refund really gets, since the first closed the escrows. */
const refusedAtAccount = (account: string) =>
  new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: "Transaction simulation failed: Error processing Instruction 3: custom program error: 0xbc4",
    logs: [
      `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
      `Program log: AnchorError caused by account: ${account}. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.`,
      `Program ${PROGRAM_ID.toBase58()} failed: custom program error: 0xbc4`,
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

  /* 4yf7: TSLA priced by Pyth v NVDA, accepted_ts 1789179709, Friday 11 Sep
   * 10:21:49 PM New York. Its start fell where Pyth prints nothing, from
   * Friday 8 PM to Sunday 8 PM, so no update will ever pass the program's
   * check for it. The old clock parked it until Monday's opening bell and then
   * asked Hermes on every pass; now it is set aside for good, with the moment
   * its stall refund opens: no Hermes call, no quote, no slot, on Sunday or on
   * Monday morning. */
  it("sets aside 4yf7, which nothing will ever price, with no call to Hermes or the oracle", async () => {
    const chain = new StubChain();
    const d = duel({
      creatorFeed: byTicker("TSLA")!.feed,
      creatorSource: SOURCE_PYTH,
      opponentFeed: byTicker("NVDA")!.feed,
      acceptedTs: 1_789_179_709,
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

    for (const now of [ny(13, 12, 0), ny(14, 9, 30, 5)]) {
      const listing = await listJobs(chain.conn(), now, { lookup: quoteSymbolFor, lookaheadSecs: 40 });
      expect(listing.due).to.have.length(0);
      expect(listing.parked).to.deep.equal([
        { duel: d.address.toBase58(), kind: "start", never: ["TSLA"], refundAt: ny(18, 22, 21, 49) },
      ]);

      const results = await crankOnce({
        ...ctx(chain, { hermes, quoteAt: quote, quoteSymbol: quoteSymbolFor }),
        now,
        lookaheadSecs: 40,
      });
      expect(results).to.deep.equal([]);
    }
    expect(chain.infoCalls).to.equal(0);
    expect(chain.sendCalls).to.have.length(0);
  });

  /* ...and then it has to END. Parked for good used to mean exactly that: the
   * stall refund opened on Friday 18 Sep at 10:21:49 PM and nobody pressed it,
   * so 4yf7 sat on the board as a fight that could never start. From refundAt
   * the settler lists it as a refund, and not a second before. */
  it("refunds 4yf7 once its stall refund opens, and not before", async () => {
    const chain = new StubChain();
    const d = duel({
      creatorFeed: byTicker("TSLA")!.feed,
      creatorSource: SOURCE_PYTH,
      opponentFeed: byTicker("NVDA")!.feed,
      acceptedTs: 1_789_179_709,
    });
    await chain.put(d);
    const opens = ny(18, 22, 21, 49);

    const before = await listJobs(chain.conn(), opens - 1, { lookup: quoteSymbolFor });
    expect(before.due).to.have.length(0);
    expect(before.parked).to.have.length(1);

    const after = await listJobs(chain.conn(), opens, { lookup: quoteSymbolFor });
    expect(after.parked).to.have.length(0);
    expect(after.due.map((j) => [j.duel.address.toBase58(), j.kind, j.why, j.since])).to.deep.equal([
      [d.address.toBase58(), "refund", "refund", opens],
    ]);

    /* Listing it is half the job. The runner once compared every refund with
     * STATUS_VOID and wrote this one off as "somebody else got there", so the
     * whole pass is run here and a transaction has to leave. */
    const results = await crankOnce({ ...ctx(chain, { quoteSymbol: quoteSymbolFor }), now: opens });
    expect(results.map((r) => [r.duel, r.kind, r.state])).to.deep.equal([[d.address.toBase58(), "refund", "sent"]]);
    expect(chain.forwarded).to.have.length(1);
  });

  /* The other half of the same model: Pyth prints on weekday nights, so a
   * TSLA fight taken at 10pm on a Tuesday is due within seconds, not parked
   * until Wednesday's bell. */
  it("calls a Pyth fight taken on a weekday night due at once", async () => {
    const chain = new StubChain();
    const boundary = ny(15, 22, 0, 10);
    const d = duel({
      creatorFeed: byTicker("TSLA")!.feed,
      creatorSource: SOURCE_PYTH,
      opponentFeed: byTicker("QQQ")!.feed,
      opponentSource: SOURCE_PYTH,
      acceptedTs: boundary - START_DELAY_SECS,
    });
    await chain.put(d);
    const listing = await listJobs(chain.conn(), boundary + 5, { lookup: quoteSymbolFor, lookaheadSecs: 40 });
    expect(listing.parked).to.deep.equal([]);
    expect(listing.due.map((j) => [j.duel.address.toBase58(), j.kind, j.readyAt, j.why])).to.deep.equal([
      [d.address.toBase58(), "start", boundary + 3, "pyth"],
    ]);
  });

  /* A nudge or a person settled it a moment ago, and this RPC node has not
   * caught up on the duel's status. The first settle closed both escrows, so
   * the program never reaches its NotLive check: Anchor refuses the second one
   * while loading creator_escrow. The crank calls that done, having paid
   * nothing, and a refund the same. The old check looked only for NotLive and
   * NotRefundable, which the real program cannot produce here. */
  for (const kind of ["settle", "refund"] as const) {
    it(`takes a ${kind} refused for a closed escrow as done, with nothing sent`, async () => {
      const chain = new StubChain();
      const now = nowSecs();
      const d = duel({ status: kind === "settle" ? STATUS_LIVE : STATUS_VOID, acceptedTs: now - 900, endTs: now - 600 });
      await chain.put(d);
      chain.refuse = () => refusedAtAccount("creator_escrow");

      const out = await crankJob(ctx(chain), jobOf(d, kind, now - 500), Date.now() + 10_000);
      expect(out.state, out.detail).to.equal("done");
      expect(out.forwarded).to.equal(false);
      expect(chain.sendCalls).to.have.length(1);
      expect(chain.sendCalls[0].skipPreflight).to.equal(false);
      expect(chain.forwarded).to.have.length(0);
      expect(chain.statusCalls).to.equal(0);
    });
  }

  it("takes any preflight refusal as done when the duel's status has moved by then", async () => {
    const chain = new StubChain();
    const now = nowSecs();
    const d = duel({ status: STATUS_LIVE, acceptedTs: now - 900, endTs: now - 600 });
    await chain.put(d);
    const settled = await encode({ ...d, status: STATUS_SETTLED });
    chain.refuse = () => {
      // Somebody's settle landed between this crank's read and its send.
      chain.accounts.set(d.address.toBase58(), settled);
      return refusedBy("SomethingElse", "A refusal this crank has no pattern for");
    };
    const out = await crankJob(ctx(chain), jobOf(d, "settle", now - 500), Date.now() + 10_000);
    expect(out.state, out.detail).to.equal("done");
    expect(chain.forwarded).to.have.length(0);
  });

  it("does not take a start refused for a missing account as done while the duel is still waiting", async () => {
    const chain = new StubChain();
    const d = duel({ acceptedTs: nowSecs() - 600 });
    await chain.put(d);
    chain.refuse = () => refusedAtAccount("creator_escrow");
    const out = await crankJob(ctx(chain), jobOf(d, "start", nowSecs() - 1), Date.now() + 10_000);
    expect(out.state, out.detail).to.equal("failed");
    expect(out.forwarded).to.equal(false);
  });

  it("says whether anything reached the RPC, so the nudge can give its budget back", async () => {
    const chain = new StubChain();
    const good = duel({ acceptedTs: nowSecs() - 600 });
    const foreign = duel({ acceptedTs: nowSecs() - 600, oracle: Keypair.generate().publicKey });
    await chain.put(good, foreign);
    const sent = await crankJob(ctx(chain), jobOf(good, "start", nowSecs() - 1), Date.now() + 10_000);
    expect([sent.state, sent.forwarded]).to.deep.equal(["sent", true]);
    // A fight that trusts another oracle key fails before any send.
    const broken = await crankJob(ctx(chain), jobOf(foreign, "start", nowSecs() - 1), Date.now() + 10_000);
    expect([broken.state, broken.forwarded]).to.deep.equal(["failed", false]);
    expect(chain.sendCalls).to.have.length(1);
  });

  /* The reviewer's probe: a quote that comes back after the attempt was given
   * up used to be sent anyway, after the answer "timed out before sending"
   * had gone back, and past the deadline. */
  it("sends nothing after it has given an attempt up", async function () {
    this.timeout(8_000);
    const chain = new StubChain();
    const d = duel({ acceptedTs: nowSecs() - 600 });
    await chain.put(d);
    const slow: typeof quoteAt = (o) => new Promise((r) => setTimeout(() => r(goodQuote(o)), 1_200));

    const out = await crankJob(ctx(chain, { quoteAt: slow, attemptTimeoutMs: 500 }), jobOf(d, "start", nowSecs() - 1), Date.now() + 6_000);
    expect(out.state).to.equal("failed");
    expect(out.detail).to.match(/before sending; nothing was sent/);
    expect(out.forwarded).to.equal(false);
    // Long past the moment the quote came back and the work tried to send.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(chain.blockhashCalls, "the abandoned work did carry on to the send").to.equal(1);
    expect(chain.sendCalls).to.have.length(0);
  });

  describe("a Pyth side", () => {
    const pythDuel = () => duel({ acceptedTs: nowSecs() - 600, creatorSource: SOURCE_PYTH });
    const noHermes = {
      getPriceUpdatesAtTimestamp: () => {
        throw new Error("Hermes must not be asked for a crank there is no time to finish");
      },
    } as unknown as HermesClient;

    /* Posts, the fight, and confirmations one after another: begun with a few
     * seconds left, the fight was sent and then abandoned unconfirmed. */
    it("is not begun without the time to finish it", async () => {
      const chain = new StubChain();
      const d = pythDuel();
      await chain.put(d);
      const t0 = Date.now();
      // Ready now, with 8 seconds left: enough for a signed crank, not a Pyth one.
      const late = await crankJob(ctx(chain, { hermes: noHermes }), jobOf(d, "start", nowSecs() - 1), Date.now() + 8_000);
      expect(late.state, late.detail).to.equal("not-yet");
      // Ready in a second, with 15 left.
      const soon = await crankJob(ctx(chain, { hermes: noHermes }), jobOf(d, "start", nowSecs() + 1), Date.now() + 15_000);
      expect(soon.state, soon.detail).to.equal("not-yet");
      expect(Date.now() - t0).to.be.below(2_500);
      expect(chain.infoCalls).to.equal(0);
      expect(chain.sendCalls).to.have.length(0);
    });

    /* A page's Pyth crank takes up to half a minute. The cron used to go in six
     * seconds past readyAt, find the fight still ACCEPTED, and post a second
     * set of prices. Now it waits longer for a Pyth side, and a job it cannot
     * reach in this pass does not take a place from one it can. */
    it("is left by the cron to a page for longer, without taking a signed fight's place", async function () {
      this.timeout(8_000);
      const chain = new StubChain();
      const pyth = pythDuel();
      const signed = duel({ acceptedTs: nowSecs() - 600 });
      await chain.put(pyth, signed);
      const readyAt = nowSecs() - 5;
      const listing = {
        due: [
          { duel: pyth, kind: "start" as const, readyAt, why: "pyth" as const, since: readyAt + 1 },
          { duel: signed, kind: "start" as const, readyAt, why: "minute-close" as const, since: readyAt },
        ],
        parked: [],
        errors: [],
      };
      const results = await crankOnce({
        ...ctx(chain, { hermes: noHermes }),
        listing,
        limit: 1,
        yieldSecs: 6,
        pythYieldSecs: 45,
        deadlineMs: Date.now() + 8_000,
      });
      const by = Object.fromEntries(results.map((r) => [r.duel, r.state]));
      expect(by[signed.address.toBase58()]).to.equal("sent");
      expect(by[pyth.address.toBase58()]).to.equal("not-yet");
      expect(chain.forwarded).to.have.length(1);
    });
  });

  it("asks a quiet pool again when the exchange can price it, not every five seconds", async () => {
    const realFetch = globalThis.fetch;
    const b = ny(13, 21, 56, 32); // Sunday night: the exchange is shut
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[b - 600, 1, 1, 1, 100, 1]] } } }), {
        status: 200,
      })) as typeof fetch;
    try {
      await fetchPoolBars("crank-quietpool", b);
    } finally {
      globalThis.fetch = realFetch;
    }
    const d = duel({ acceptedTs: b - START_DELAY_SECS });
    const quiet = { symbol: "QUIET", currency: "USD", market: "US", pool: "crank-quietpool" };
    const unread = { ...quiet, pool: "crank-unreadpool" };
    const now = b + 3_600;
    // Monday's first exchange bar, final at 4:01:20.
    expect(retryAt(d, "start", now, () => quiet, quiet)).to.equal(ny(14, 4, 1, 20));
    // Once the exchange is open, at its next minute close.
    const later = ny(14, 4, 30, 5);
    expect(retryAt(d, "start", later, () => quiet, quiet)).to.equal(firstBarEnd(later - BAR_SETTLE_SECS) + BAR_SETTLE_SECS);
    // A pool this instance has not read (a rate limit, say) keeps the short retry.
    expect(retryAt(d, "start", now, () => unread, unread)).to.equal(now + 5);
  });

  it("asks a late perp again in seconds, not at the next minute close", () => {
    const b = ny(14, 1, 44, 25); // Monday 1:44am New York: the exchange is shut, the perp is not
    const d = duel({ acceptedTs: b - START_DELAY_SECS });
    const perp = { symbol: "AMZN", currency: "USD", market: "US", perp: "xyz:AMZN" };
    const priced = firstBarEnd(b) + BAR_SETTLE_SECS;
    // Before its time, at its time.
    expect(retryAt(d, "start", priced - 30, () => perp, perp)).to.equal(priced);
    // Just late: the quiet minute's candle is waiting on the next trade.
    expect(retryAt(d, "start", priced + 1, () => perp, perp)).to.equal(priced + 6);
    // Still inside the fast window.
    const edge = priced + PERP_FAST_RETRY_WINDOW_SECS - 1;
    expect(retryAt(d, "start", edge, () => perp, perp)).to.equal(edge + 5);
    // A market that quiet can stay quiet: less often after two minutes.
    const slow = priced + PERP_FAST_RETRY_WINDOW_SECS;
    expect(retryAt(d, "start", slow, () => perp, perp)).to.equal(slow + PERP_SLOW_RETRY_SECS);
    // The same stock priced by its exchange keeps the minute-close retry.
    const open = ny(14, 10, 15, 25);
    const listed = duel({ acceptedTs: open - START_DELAY_SECS });
    const late = firstBarEnd(open) + BAR_SETTLE_SECS + 1;
    expect(retryAt(listed, "start", late, () => perp, perp)).to.equal(firstBarEnd(late - BAR_SETTLE_SECS) + BAR_SETTLE_SECS);
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

  it("takes the newest fights first and gives every other job a turn", () => {
    const d = duel({});
    const jobs = Array.from({ length: 12 }, (_, i) => jobOf(d, "start", i + 1));
    const picked = chooseJobs(jobs, 8, () => 0).map((j) => j.readyAt);
    expect(picked.slice(0, 6)).to.deep.equal([12, 11, 10, 9, 8, 7]);
    expect(picked).to.have.length(8);
    expect(chooseJobs(jobs.slice(0, 5), 8).map((j) => j.readyAt)).to.deep.equal([5, 4, 3, 2, 1]);
    // The two spare places are drawn from the rest, so over a few passes each gets one.
    const seen = new Set<number>();
    for (let pass = 0; pass < 200; pass++) chooseJobs(jobs, 8).slice(6).forEach((j) => seen.add(j.readyAt));
    expect([...seen].sort((a, b) => a - b)).to.deep.equal([1, 2, 3, 4, 5, 6]);
  });

  /* Six refunds that keep failing have readyAt = now on every pass. Ordered by
   * readyAt they were the newest every time, and a fight that missed one pass
   * ranked below them on every pass after. Ordered by when each became due,
   * the fresh fights go first. */
  it("orders by when a job became due, so refunds dated now do not push fresh fights out", async () => {
    const chain = new StubChain();
    const now = nowSecs();
    const refunds = Array.from({ length: 6 }, () => duel({ status: STATUS_VOID, startTs: now - 3_600 }));
    await chain.put(...refunds);
    const listed = await listJobs(chain.conn(), now, { lookup: hk });
    const again = await listJobs(chain.conn(), now + 60, { lookup: hk });
    expect(listed.due.map((j) => j.since)).to.deep.equal(Array(6).fill(now - 3_600));
    expect(again.due.map((j) => j.since)).to.deep.equal(Array(6).fill(now - 3_600));

    const fresh = [jobOf(duel({}), "start", now - 60), jobOf(duel({}), "start", now - 120)];
    const old = [jobOf(duel({}), "start", now - 7_200), jobOf(duel({}), "start", now - 7_300)];
    for (let pass = 0; pass < 20; pass++) {
      const chosen = chooseJobs([...again.due, ...old, ...fresh], 8);
      for (const f of fresh) expect(chosen).to.include(f);
    }
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

    const sigOf = (v: VersionedTransaction) => utils.bytes.bs58.encode(v.signatures[0]);

    /* The reviewer's probe: the fight transaction went out and was not seen by
     * the deadline, and the closes went straight out behind it. A close that
     * lands first makes the fight fail on chain with its fee paid. */
    it("holds the closes back while the fight transaction may still land", async function () {
      this.timeout(10_000);
      const chain = new StubChain();
      const [post, fight, close] = [tx(1), tx(2), tx(3)];
      chain.pending = (s) => s === sigOf(fight);
      const err = await quiet(() =>
        sendInOrder(chain.conn(), [post, fight], {
          preflight: true,
          cleanup: [close],
          deadlineMs: Date.now() + 1_000,
          lastValidBlockHeight: 1_000_000,
        }).catch((e: unknown) => e),
      );
      expect(err).to.be.instanceOf(SendFailed);
      expect((err as SendFailed).stage).to.equal("unseen");
      expect((err as SendFailed).index).to.equal(1);
      expect(chain.forwarded.map((f) => f.signature)).to.deep.equal([sigOf(post), sigOf(fight)]);
    });

    it("sends the closes once a late fight transaction has landed, and calls the list a success", async function () {
      this.timeout(10_000);
      const chain = new StubChain();
      const [post, fight, close] = [tx(1), tx(2), tx(3)];
      const landsAt = Date.now() + 1_800;
      chain.pending = (s) => s === sigOf(fight) && Date.now() < landsAt;
      const sigs = await quiet(() =>
        sendInOrder(chain.conn(), [post, fight], {
          preflight: true,
          cleanup: [close],
          deadlineMs: Date.now() + 1_000,
          lastValidBlockHeight: 1_000_000,
        }),
      );
      expect(sigs).to.deep.equal([sigOf(post), sigOf(fight), sigOf(close)]);
      expect(chain.forwarded.at(-1)!.at).to.be.at.least(landsAt);
    });

    /* A post not seen means the fight was never sent, so nothing can read the
     * accounts the closes remove: they go out, and the fight does not. */
    it("still sends the closes when a price post is the one not seen", async function () {
      this.timeout(10_000);
      const chain = new StubChain();
      const [post, fight, close] = [tx(1), tx(2), tx(3)];
      chain.pending = (s) => s === sigOf(post);
      const err = await quiet(() =>
        sendInOrder(chain.conn(), [post, fight], {
          preflight: true,
          cleanup: [close],
          deadlineMs: Date.now() + 1_000,
          lastValidBlockHeight: 1_000_000,
        }).catch((e: unknown) => e),
      );
      expect((err as SendFailed).stage).to.equal("unseen");
      expect((err as SendFailed).index).to.equal(0);
      expect(chain.forwarded.map((f) => f.signature)).to.deep.equal([sigOf(post), sigOf(close)]);
    });

    it("sends nothing once its deadline has passed", async () => {
      const chain = new StubChain();
      const err = await quiet(() =>
        sendInOrder(chain.conn(), [tx(1), tx(2)], {
          preflight: true,
          cleanup: [tx(3)],
          deadlineMs: Date.now() - 1,
          lastValidBlockHeight: 1_000_000,
        }).catch((e: unknown) => e),
      );
      expect((err as SendFailed).stage).to.equal("held");
      expect(chain.sendCalls).to.have.length(0);
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
