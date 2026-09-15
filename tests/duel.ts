/* The duel program, against the real binary, in LiteSVM.
 *
 * Pyth is faked the only way that matters: price update accounts are written
 * straight into the SVM, owned by the receiver's address, byte for byte in the
 * PriceUpdateV2 layout. The program checks the owner, the discriminator, the
 * verification level, the feed and the boundary, so every one of those is
 * something a test here can get wrong on purpose.
 *
 * Signed quotes are not faked at all: they are signed with a real Ed25519 key
 * and checked by the real Ed25519 program in the same transaction.
 *
 * Stocks: NVDA and TSLA are Token-2022 mints (as real tokenized stocks are),
 * AAPL is a classic SPL mint, so the mixed-program path is covered too. AMD
 * and PLTR are priced by the oracle's signed quotes. */

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getProgramDerivedAddress,
  lamports,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  signBytes,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { Address, Instruction, InstructionWithSigners, KeyPairSigner } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

type Stock = {
  symbol: string;
  mint: Address;
  program: Address;
  feed: Uint8Array;
  decimals: number;
  source: number;
};

type QuoteTerms = {
  feed: Uint8Array;
  boundary: number;
  price: bigint;
  expo: number;
  publishTime: number;
};

type SignedQuote = { key: Address; msg: Uint8Array; sig: Uint8Array };

describe("duel - LiteSVM", () => {
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "target/idl/duel.json"), "utf8"),
  );
  const coder = new anchor.BorshCoder(idl);
  const codec = getAddressCodec();

  const programAddress = address(idl.address);
  const SYSTEM = address("11111111111111111111111111111111");
  const DEFAULT_PUBKEY = SYSTEM; // 32 zero bytes
  const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const PYTH_RECEIVER = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
  const ED25519 = address("Ed25519SigVerify111111111111111111111111111");
  const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
  const PRICE_UPDATE_DISC = [34, 241, 35, 99, 157, 126, 244, 205];
  const PYTH = 0;
  const SIGNED = 1;

  const START_DELAY = 2;
  const MIN_DUEL = 60;
  const MAX_START_WAIT = 5 * 86_400;
  const STALL = 7 * 86_400;

  const STATUS_OPEN = 0;
  const STATUS_ACCEPTED = 1;
  const STATUS_LIVE = 2;
  const STATUS_SETTLED = 3;
  const STATUS_VOID = 4;
  const STATUS_REFUNDED = 5;
  const OUTCOME_CREATOR = 1;
  const OUTCOME_OPPONENT = 2;
  const OUTCOME_TIE = 3;
  const OUTCOME_VOID = 4;

  const W = AccountRole.WRITABLE;
  const R = AccountRole.READONLY;
  const WS = AccountRole.WRITABLE_SIGNER;
  const RS = AccountRole.READONLY_SIGNER;

  const NOW = 1_800_000_000;
  const SOL = 1_000_000_000n;

  let svm: LiteSVM;
  let admin: KeyPairSigner;
  let cranker: KeyPairSigner;
  let oracle: KeyPairSigner;
  let configPda: Address;
  let NVDA: Stock;
  let TSLA: Stock;
  let AAPL: Stock;
  let OFF: Stock;
  let AMD: Stock;
  let PLTR: Stock;
  /** Another issuer's NVDA: its own mint, NVDA's feed. */
  let NVDA_B: Stock;
  let seedCounter = 1n;

  // ── encoding ──────────────────────────────────────────────────────────────

  const enc = (s: string) => new TextEncoder().encode(s);

  function encodeMint(decimals: number, authority: Address): Uint8Array {
    const data = new Uint8Array(82);
    const view = new DataView(data.buffer);
    view.setUint32(0, 1, true);
    data.set(codec.encode(authority), 4);
    view.setBigUint64(36, 0n, true);
    data[44] = decimals;
    data[45] = 1;
    view.setUint32(46, 0, true);
    return data;
  }

  /** A Token-2022 mint carrying a TransferHook extension pointing at `hook`. */
  function encodeHookMint(decimals: number, authority: Address, hook: Address): Uint8Array {
    const data = new Uint8Array(166 + 4 + 64);
    data.set(encodeMint(decimals, authority), 0);
    data[165] = 1;
    const view = new DataView(data.buffer);
    view.setUint16(166, 14, true);
    view.setUint16(168, 64, true);
    data.set(codec.encode(authority), 170);
    data.set(codec.encode(hook), 202);
    return data;
  }

  function encodeTokenAccount(mint: Address, owner: Address, amount: bigint): Uint8Array {
    const data = new Uint8Array(165);
    const view = new DataView(data.buffer);
    data.set(codec.encode(mint), 0);
    data.set(codec.encode(owner), 32);
    view.setBigUint64(64, amount, true);
    data[108] = 1;
    return data;
  }

  function priceData(o: {
    feed: Uint8Array;
    price: bigint;
    expo?: number;
    publishTime: number;
    prev: number;
    partial?: boolean;
  }): Uint8Array {
    const d = new Uint8Array(134);
    const v = new DataView(d.buffer);
    d.set(PRICE_UPDATE_DISC, 0);
    let at = 8 + 32;
    if (o.partial) {
      d[at] = 0;
      d[at + 1] = 5;
      at += 2;
    } else {
      d[at] = 1;
      at += 1;
    }
    d.set(o.feed, at);
    at += 32;
    v.setBigInt64(at, o.price, true);
    at += 8;
    v.setBigUint64(at, 100_000n, true);
    at += 8;
    v.setInt32(at, o.expo ?? -8, true);
    at += 4;
    v.setBigInt64(at, BigInt(o.publishTime), true);
    at += 8;
    v.setBigInt64(at, BigInt(o.prev), true);
    at += 8;
    v.setBigInt64(at, o.price, true);
    at += 8;
    v.setBigUint64(at, 100_000n, true);
    at += 8;
    v.setBigUint64(at, 1n, true);
    return d;
  }

  /** The 78-byte message the oracle signs; see programs/duel/src/quote.rs. */
  function quoteMsg(q: QuoteTerms): Uint8Array {
    const m = new Uint8Array(78);
    const v = new DataView(m.buffer);
    m.set(enc("STONKWARS:PRICE:v1"), 0);
    m.set(q.feed, 18);
    v.setBigInt64(50, BigInt(q.boundary), true);
    v.setBigInt64(58, q.price, true);
    v.setInt32(66, q.expo, true);
    v.setBigInt64(70, BigInt(q.publishTime), true);
    return m;
  }

  async function signedQuote(signer: KeyPairSigner, q: QuoteTerms): Promise<SignedQuote> {
    const msg = quoteMsg(q);
    return { key: signer.address, msg, sig: await signBytes(signer.keyPair.privateKey, msg) };
  }

  /** An Ed25519 program instruction verifying `quotes`. Each entry's key,
   * signature and message sit in this instruction's data, and `index` names
   * the instruction the Ed25519 program should read them from (0xffff: this
   * one). */
  function ed25519Ix(quotes: SignedQuote[], index = 0xffff) {
    const head = 2 + 14 * quotes.length;
    const size = quotes.reduce((n, q) => n + 32 + 64 + q.msg.length, head);
    const data = new Uint8Array(size);
    const v = new DataView(data.buffer);
    data[0] = quotes.length;
    let at = head;
    quotes.forEach((q, i) => {
      const keyAt = at;
      const sigAt = keyAt + 32;
      const msgAt = sigAt + 64;
      const fields = [sigAt, index, keyAt, index, msgAt, q.msg.length, index];
      fields.forEach((f, j) => v.setUint16(2 + i * 14 + j * 2, f, true));
      data.set(codec.encode(q.key), keyAt);
      data.set(q.sig, sigAt);
      data.set(q.msg, msgAt);
      at = msgAt + q.msg.length;
    });
    return { programAddress: ED25519, accounts: [], data };
  }

  // ── svm plumbing ──────────────────────────────────────────────────────────

  function put(addr: Address, data: Uint8Array, owner: Address, lamportsAmount = 3_000_000n) {
    svm.setAccount({
      address: addr,
      lamports: lamports(lamportsAmount),
      data,
      programAddress: owner,
      executable: false,
      space: BigInt(data.length),
    } as any);
  }

  function exists(addr: Address): boolean {
    const acc = svm.getAccount(addr) as any;
    return !!acc && !("exists" in acc && !acc.exists);
  }

  function tokenAmount(addr: Address): bigint {
    const acc = svm.getAccount(addr) as any;
    if (!acc || ("exists" in acc && !acc.exists)) throw new Error(`Missing token account ${addr}`);
    const data = Uint8Array.from(acc.data);
    return new DataView(data.buffer).getBigUint64(64, true);
  }

  function lamportsOf(addr: Address): bigint {
    return BigInt(svm.getBalance(addr) ?? 0n);
  }

  function setClock(ts: number) {
    const clock = svm.getClock();
    clock.unixTimestamp = BigInt(ts);
    svm.setClock(clock);
  }

  function nowTs(): number {
    return Number(svm.getClock().unixTimestamp);
  }

  async function pda(seeds: Uint8Array[]): Promise<Address> {
    const [a] = await getProgramDerivedAddress({ programAddress, seeds });
    return a;
  }

  const assetPda = (mint: Address) => pda([enc("asset"), codec.encode(mint) as Uint8Array]);

  async function duelPda(creator: Address, seed: bigint): Promise<Address> {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, seed, true);
    return pda([enc("duel"), codec.encode(creator) as Uint8Array, b]);
  }

  async function ata(owner: Address, mint: Address, program: Address): Promise<Address> {
    const [a] = await getProgramDerivedAddress({
      programAddress: ATA_PROGRAM,
      seeds: [codec.encode(owner), codec.encode(program), codec.encode(mint)],
    });
    return a;
  }

  const acct = (a: Address, role: AccountRole, signer?: KeyPairSigner) =>
    signer ? { address: a, role, signer } : { address: a, role };

  function ix(name: string, args: Record<string, unknown>, accounts: any[]) {
    return { programAddress, accounts, data: coder.instruction.encode(name, args) };
  }

  /** One instruction, or several in order (an Ed25519 check, then ours). */
  async function buildTx(instructions: any, feePayer: KeyPairSigner) {
    const list = (Array.isArray(instructions) ? instructions : [instructions]) as (Instruction &
      InstructionWithSigners)[];
    const msg = appendTransactionMessageInstructions(
      list,
      setTransactionMessageFeePayerSigner(feePayer, createTransactionMessage({ version: 0 })),
    );
    const withLifetime = svm.setTransactionMessageLifetimeUsingLatestBlockhash(msg);
    return signTransactionMessageWithSigners(withLifetime, { abortSignal: undefined });
  }

  async function send(instructions: any, feePayer: KeyPairSigner) {
    const res = svm.sendTransaction(await buildTx(instructions, feePayer));
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(res.meta().prettyLogs());
    }
    svm.expireBlockhash();
    return res;
  }

  async function expectFailure(instruction: any, feePayer: KeyPairSigner, includes: string) {
    const res = svm.simulateTransaction(await buildTx(instruction, feePayer));
    expect(res, `expected failure containing "${includes}"`).to.be.instanceOf(
      FailedTransactionMetadata,
    );
    const logs = (res as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logs, logs).to.include(includes);
  }

  function decode(name: string, addr: Address): any {
    const acc = svm.getAccount(addr) as any;
    if (!acc || ("exists" in acc && !acc.exists)) throw new Error(`Missing ${name} at ${addr}`);
    return coder.accounts.decode(name, Buffer.from(acc.data));
  }

  const b58 = (v: any): string => (typeof v === "string" ? v : v.toBase58());

  // ── fixtures ──────────────────────────────────────────────────────────────

  function feedOf(n: number): Uint8Array {
    return new Uint8Array(32).fill(n);
  }

  async function newStock(
    symbol: string,
    program: Address,
    decimals: number,
    feedByte: number,
    source = PYTH,
  ): Promise<Stock> {
    const mint = (await generateKeyPairSigner()).address;
    put(mint, encodeMint(decimals, admin.address), program, 1_461_600n);
    return { symbol, mint, program, feed: feedOf(feedByte), decimals, source };
  }

  function setOracleIx(key: Address, signer = admin) {
    return ix("set_oracle", { oracle: new PublicKey(key) }, [
      acct(configPda, W),
      acct(signer.address, RS, signer),
    ]);
  }

  function registerIx(stock: Stock, signer = admin) {
    return (async () =>
      ix(
        "register_asset",
        { feed_id: Array.from(stock.feed), symbol: stock.symbol, source: stock.source },
        [
          acct(configPda, R),
          acct(await assetPda(stock.mint), W),
          acct(stock.mint, R),
          acct(signer.address, WS, signer),
          acct(stock.program, R),
          acct(SYSTEM, R),
        ],
      ))();
  }

  /** A funded wallet holding each listed stock in its ATA. */
  async function player(holdings: [Stock, bigint][] = []): Promise<KeyPairSigner> {
    const p = await generateKeyPairSigner();
    svm.airdrop(p.address, lamports(100n * SOL));
    for (const [stock, amount] of holdings) {
      put(
        await ata(p.address, stock.mint, stock.program),
        encodeTokenAccount(stock.mint, p.address, amount),
        stock.program,
        2_039_280n,
      );
    }
    return p;
  }

  async function putPrice(o: {
    feed: Uint8Array;
    price: bigint;
    publishTime: number;
    prev?: number;
    expo?: number;
    partial?: boolean;
    owner?: Address;
  }): Promise<Address> {
    const addr = (await generateKeyPairSigner()).address;
    put(
      addr,
      priceData({ ...o, prev: o.prev ?? o.publishTime - 1 }),
      o.owner ?? PYTH_RECEIVER,
    );
    return addr;
  }

  type DuelTerms = {
    creator: KeyPairSigner;
    c: Stock;
    x: Stock;
    cAmount?: bigint;
    xAmount?: bigint;
    duration?: number;
    endTs?: number;
    expiresTs?: number;
    invitee?: Address;
    taunt?: string;
    source?: Address;
    seed?: bigint;
  };

  async function createIx(t: DuelTerms) {
    const seed = t.seed ?? seedCounter++;
    const duel = await duelPda(t.creator.address, seed);
    const escrow = await ata(duel, t.c.mint, t.c.program);
    const source = t.source ?? (await ata(t.creator.address, t.c.mint, t.c.program));
    const winnings = await ata(t.creator.address, t.x.mint, t.x.program);
    const endTs = t.endTs ?? 0;
    const duration = t.duration ?? (endTs ? 0 : 3_600);
    const instruction = ix(
      "create_duel",
      {
        seed: new BN(seed.toString()),
        creator_amount: new BN((t.cAmount ?? 14_000_000n).toString()),
        opponent_amount: new BN((t.xAmount ?? 7_200_000n).toString()),
        duration_secs: new BN(duration),
        end_ts: new BN(endTs),
        expires_ts: new BN(t.expiresTs ?? nowTs() + 3_600),
        invitee: new PublicKey(t.invitee ?? DEFAULT_PUBKEY),
        taunt: t.taunt ?? "",
      },
      [
        acct(t.creator.address, WS, t.creator),
        acct(configPda, R),
        acct(await assetPda(t.c.mint), R),
        acct(await assetPda(t.x.mint), R),
        acct(t.c.mint, R),
        acct(t.x.mint, R),
        acct(duel, W),
        acct(escrow, W),
        acct(source, W),
        acct(winnings, W),
        acct(t.c.program, R),
        acct(t.x.program, R),
        acct(ATA_PROGRAM, R),
        acct(SYSTEM, R),
      ],
    );
    return { instruction, duel, escrow, seed };
  }

  async function createDuel(t: DuelTerms) {
    const made = await createIx(t);
    await send(made.instruction, t.creator);
    return made;
  }

  async function acceptIx(duel: Address, opponent: KeyPairSigner, c: Stock, x: Stock) {
    return ix("accept_duel", {}, [
      acct(opponent.address, WS, opponent),
      acct(configPda, R),
      acct(duel, W),
      acct(c.mint, R),
      acct(x.mint, R),
      acct(await ata(duel, x.mint, x.program), W),
      acct(await ata(opponent.address, x.mint, x.program), W),
      acct(await ata(opponent.address, c.mint, c.program), W),
      acct(c.program, R),
      acct(x.program, R),
      acct(ATA_PROGRAM, R),
      acct(SYSTEM, R),
    ]);
  }

  async function cancelIx(duel: Address, caller: KeyPairSigner) {
    const d = decode("Duel", duel);
    const creator = address(b58(d.creator));
    const mint = address(b58(d.creator_mint));
    const program = address(b58(d.creator_token_program));
    return ix("cancel_duel", {}, [
      acct(caller.address, WS, caller),
      acct(duel, W),
      acct(creator, W),
      acct(mint, R),
      acct(await ata(duel, mint, program), W),
      acct(await ata(creator, mint, program), W),
      acct(program, R),
      acct(ATA_PROGRAM, R),
      acct(SYSTEM, R),
    ]);
  }

  /** A side priced by a signed quote passes no price account: `null`, which
   * Anchor reads as None when the program id stands in the slot. */
  const priceSlot = (a: Address | null) => acct(a ?? programAddress, R);

  function startIx(duel: Address, cPrice: Address | null, xPrice: Address | null) {
    return ix("start_duel", {}, [
      acct(duel, W),
      priceSlot(cPrice),
      priceSlot(xPrice),
      acct(INSTRUCTIONS_SYSVAR, R),
    ]);
  }

  async function payoutAccounts(duel: Address, full: boolean) {
    const d = decode("Duel", duel);
    const creator = address(b58(d.creator));
    const opponent = address(b58(d.opponent));
    const cMint = address(b58(d.creator_mint));
    const xMint = address(b58(d.opponent_mint));
    const cProg = address(b58(d.creator_token_program));
    const xProg = address(b58(d.opponent_token_program));
    const head = [
      acct(duel, W),
      acct(creator, W),
      acct(opponent, W),
      acct(cMint, R),
      acct(xMint, R),
      acct(await ata(duel, cMint, cProg), W),
      acct(await ata(duel, xMint, xProg), W),
      acct(await ata(creator, cMint, cProg), W),
    ];
    const cross = full
      ? [acct(await ata(creator, xMint, xProg), W), acct(await ata(opponent, cMint, cProg), W)]
      : [];
    return { head, cross, tailAta: acct(await ata(opponent, xMint, xProg), W), cProg, xProg };
  }

  async function settleIx(
    duel: Address,
    cPrice: Address | null,
    xPrice: Address | null,
    payer = cranker,
    /** The optional fee accounts, after the named ones. */
    extra: any[] = [],
  ) {
    const a = await payoutAccounts(duel, true);
    return ix("settle_duel", {}, [
      acct(payer.address, WS, payer),
      ...a.head,
      ...a.cross,
      a.tailAta,
      priceSlot(cPrice),
      priceSlot(xPrice),
      acct(INSTRUCTIONS_SYSVAR, R),
      acct(a.cProg, R),
      acct(a.xProg, R),
      acct(ATA_PROGRAM, R),
      acct(SYSTEM, R),
      ...extra,
    ]);
  }

  async function refundIx(duel: Address, payer = cranker) {
    const a = await payoutAccounts(duel, false);
    return ix("refund_duel", {}, [
      acct(payer.address, WS, payer),
      ...a.head,
      a.tailAta,
      acct(a.cProg, R),
      acct(a.xProg, R),
      acct(ATA_PROGRAM, R),
      acct(SYSTEM, R),
    ]);
  }

  /** Create and accept; returns the duel and the accept timestamp. */
  async function acceptedDuel(t: Partial<DuelTerms> = {}) {
    const c = t.c ?? NVDA;
    const x = t.x ?? TSLA;
    const creator = t.creator ?? (await player([[c, 1_000_000_000n], [x, 1_000_000_000n]]));
    const opponent = await player([[c, 1_000_000_000n], [x, 1_000_000_000n]]);
    const { duel } = await createDuel({ ...t, creator, c, x });
    await send(await acceptIx(duel, opponent, c, x), opponent);
    return { duel, creator, opponent, c, x, acceptedTs: nowTs() };
  }

  /** Accept, then post first-after-boundary start prices. */
  async function liveDuel(
    cStart: bigint,
    xStart: bigint,
    t: Partial<DuelTerms> = {},
  ) {
    const d = await acceptedDuel(t);
    const boundary = d.acceptedTs + START_DELAY;
    const cp = await putPrice({ feed: d.c.feed, price: cStart, publishTime: boundary, prev: boundary - 1 });
    const xp = await putPrice({ feed: d.x.feed, price: xStart, publishTime: boundary, prev: boundary - 1 });
    await send(startIx(d.duel, cp, xp), cranker);
    const state = decode("Duel", d.duel);
    return { ...d, endTs: Number(state.end_ts) };
  }

  // ── setup ─────────────────────────────────────────────────────────────────

  before(async () => {
    svm = new LiteSVM()
      .withSysvars()
      .withBuiltins()
      .withPrecompiles()
      .withDefaultPrograms()
      .withTransactionHistory(0n)
      .withLogBytesLimit(256n * 1024n);
    svm.addProgramFromFile(programAddress, "target/deploy/duel.so");
    setClock(NOW);

    admin = await generateKeyPairSigner();
    cranker = await generateKeyPairSigner();
    oracle = await generateKeyPairSigner();
    svm.airdrop(admin.address, lamports(100n * SOL));
    svm.airdrop(cranker.address, lamports(100n * SOL));

    configPda = await pda([enc("config")]);
    await send(
      ix("init_config", {}, [acct(configPda, W), acct(admin.address, WS, admin), acct(SYSTEM, R)]),
      admin,
    );

    NVDA = await newStock("NVDAx", TOKEN_2022, 8, 1);
    TSLA = await newStock("TSLAx", TOKEN_2022, 8, 2);
    AAPL = await newStock("AAPLx", TOKEN, 6, 3);
    OFF = await newStock("OFFx", TOKEN_2022, 8, 4);
    AMD = await newStock("AMDx", TOKEN_2022, 8, 5, SIGNED);
    PLTR = await newStock("PLTRx", TOKEN_2022, 8, 6, SIGNED);
    NVDA_B = await newStock("NVDAb", TOKEN_2022, 8, 1);
    for (const s of [NVDA, TSLA, AAPL, OFF, AMD, PLTR, NVDA_B]) await send(await registerIx(s), admin);

    await send(
      ix("set_asset", { feed_id: Array.from(OFF.feed), enabled: false, source: PYTH }, [
        acct(configPda, R),
        acct(await assetPda(OFF.mint), W),
        acct(admin.address, RS, admin),
      ]),
      admin,
    );
  });

  beforeEach(() => setClock(NOW));

  // ── assets ────────────────────────────────────────────────────────────────

  it("register_asset records the stock, its feed and its token program", async () => {
    const a = decode("Asset", await assetPda(NVDA.mint));
    expect(b58(a.mint)).to.equal(NVDA.mint);
    expect(b58(a.token_program)).to.equal(TOKEN_2022);
    expect(Buffer.from(a.feed_id).equals(Buffer.from(NVDA.feed))).to.be.true;
    expect(a.symbol).to.equal("NVDAx");
    expect(a.decimals).to.equal(8);
    expect(a.enabled).to.be.true;
    expect(a.source).to.equal(PYTH);
    expect(decode("Asset", await assetPda(AMD.mint)).source).to.equal(SIGNED);

    const classic = decode("Asset", await assetPda(AAPL.mint));
    expect(b58(classic.token_program)).to.equal(TOKEN);
    expect(decode("Asset", await assetPda(OFF.mint)).enabled).to.be.false;
  });

  it("register_asset refuses a mint with a live transfer hook, and anyone but the admin", async () => {
    const hooked = (await generateKeyPairSigner()).address;
    const hookProgram = (await generateKeyPairSigner()).address;
    put(hooked, encodeHookMint(8, admin.address, hookProgram), TOKEN_2022, 2_000_000n);
    const stock: Stock = {
      symbol: "HOOKx",
      mint: hooked,
      program: TOKEN_2022,
      feed: feedOf(9),
      decimals: 8,
      source: PYTH,
    };
    await expectFailure(await registerIx(stock), admin, "That mint cannot be held in escrow");

    const stranger = await player();
    const fresh = await newStock("FRESHx", TOKEN_2022, 8, 10);
    await expectFailure(await registerIx(fresh, stranger), stranger, "ConstraintHasOne");
  });

  // ── create / cancel ───────────────────────────────────────────────────────

  it("create_duel escrows the creator's stake and opens their winnings account", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    const { duel, escrow } = await createDuel({
      creator: alice,
      c: NVDA,
      x: TSLA,
      duration: 900,
      taunt: "TSLA is cooked. NVDA by the bell.",
    });

    const d = decode("Duel", duel);
    expect(d.status).to.equal(STATUS_OPEN);
    expect(b58(d.creator)).to.equal(alice.address);
    expect(b58(d.opponent)).to.equal(DEFAULT_PUBKEY);
    expect(b58(d.creator_mint)).to.equal(NVDA.mint);
    expect(b58(d.opponent_mint)).to.equal(TSLA.mint);
    expect(b58(d.creator_token_program)).to.equal(TOKEN_2022);
    expect(Buffer.from(d.creator_feed).equals(Buffer.from(NVDA.feed))).to.be.true;
    expect(Buffer.from(d.opponent_feed).equals(Buffer.from(TSLA.feed))).to.be.true;
    expect(d.creator_amount.toString()).to.equal("14000000");
    expect(d.opponent_amount.toString()).to.equal("7200000");
    expect(Number(d.duration_secs)).to.equal(900);
    expect(Number(d.end_ts)).to.equal(0);
    expect(d.taunt).to.equal("TSLA is cooked. NVDA by the bell.");

    expect(tokenAmount(escrow)).to.equal(14_000_000n);
    expect(tokenAmount(await ata(alice.address, NVDA.mint, TOKEN_2022))).to.equal(86_000_000n);
    expect(tokenAmount(await ata(alice.address, TSLA.mint, TOKEN_2022))).to.equal(0n);

    // creator, opponent and status sit where the app's memcmp filters look.
    const raw = Uint8Array.from((svm.getAccount(duel) as any).data);
    expect(codec.decode(raw.slice(8, 40))).to.equal(alice.address);
    expect(raw[72]).to.equal(STATUS_OPEN);
  });

  it("create_duel refuses terms it cannot run", async () => {
    const alice = await player([[NVDA, 100_000_000n], [OFF, 100_000_000n]]);
    const now = nowTs();

    /* The same stock on both sides. Staked from her ATA, her source account
     * and her winnings account are one account, and Anchor refuses the
     * duplicate before any constraint of ours runs. Staked from any other
     * account, the two differ and the program's own check is what stops it. */
    await expectFailure(
      (await createIx({ creator: alice, c: NVDA, x: NVDA })).instruction,
      alice,
      "ConstraintDuplicateMutableAccount",
    );
    const loose = (await generateKeyPairSigner()).address;
    put(loose, encodeTokenAccount(NVDA.mint, alice.address, 50_000_000n), TOKEN_2022, 2_039_280n);
    await expectFailure(
      (await createIx({ creator: alice, c: NVDA, x: NVDA, source: loose })).instruction,
      alice,
      "A duel needs two different stocks",
    );

    const cases: [Partial<DuelTerms>, string][] = [
      [{ cAmount: 0n }, "Both stakes must be more than zero"],
      [{ xAmount: 0n }, "Both stakes must be more than zero"],
      [{ duration: 600, endTs: now + 7_200 }, "Give a duration or an end time, not both"],
      [{ duration: MIN_DUEL - 1 }, "That duel length is out of range"],
      [{ duration: 32 * 86_400 }, "That duel length is out of range"],
      [{ endTs: now + 30 }, "That duel length is out of range"],
      [{ endTs: now + 3_600, expiresTs: now + 3_600 - MIN_DUEL + 1 }, "The challenge must close before the duel could end"],
      [{ expiresTs: now }, "The challenge must close before the duel could end"],
      [{ expiresTs: now + 31 * 86_400 }, "The challenge must close before the duel could end"],
      [{ taunt: "x".repeat(81) }, "The taunt is too long"],
      [{ x: OFF }, "That stock is not enabled for duels"],
    ];
    for (const [terms, message] of cases) {
      const { instruction } = await createIx({ creator: alice, c: NVDA, x: TSLA, ...terms });
      await expectFailure(instruction, alice, message);
    }

    // Neither end rule set.
    const { instruction } = await createIx({ creator: alice, c: NVDA, x: TSLA, duration: 0, endTs: 0 });
    await expectFailure(instruction, alice, "Give a duration or an end time, not both");
  });

  it("the creator can cancel an open duel and gets back the stake and all the rent", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    const before = lamportsOf(alice.address);
    const { duel, escrow } = await createDuel({ creator: alice, c: NVDA, x: TSLA });
    expect(tokenAmount(await ata(alice.address, NVDA.mint, TOKEN_2022))).to.equal(86_000_000n);

    await send(await cancelIx(duel, alice), alice);

    expect(exists(duel)).to.be.false;
    expect(exists(escrow)).to.be.false;
    expect(tokenAmount(await ata(alice.address, NVDA.mint, TOKEN_2022))).to.equal(100_000_000n);
    // Everything but the transaction fees and the winnings ATA she keeps.
    const winningsRent = lamportsOf(await ata(alice.address, TSLA.mint, TOKEN_2022));
    const spent = before - lamportsOf(alice.address) - winningsRent;
    expect(spent < 100_000n, `spent ${spent}`).to.be.true;
  });

  it("a stranger can cancel only an expired challenge, and the stake still goes to the creator", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    const mallory = await player();
    const expires = nowTs() + 600;
    const { duel } = await createDuel({ creator: alice, c: NVDA, x: TSLA, expiresTs: expires });

    await expectFailure(
      await cancelIx(duel, mallory),
      mallory,
      "Only the creator can cancel before the challenge expires",
    );

    setClock(expires);
    await send(await cancelIx(duel, mallory), mallory);
    expect(exists(duel)).to.be.false;
    expect(tokenAmount(await ata(alice.address, NVDA.mint, TOKEN_2022))).to.equal(100_000_000n);
  });

  // ── accept ────────────────────────────────────────────────────────────────

  it("accept_duel escrows the opponent's stake on the creator's terms", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    const bob = await player([[TSLA, 50_000_000n]]);
    const { duel } = await createDuel({ creator: alice, c: NVDA, x: TSLA });

    setClock(NOW + 120);
    await send(await acceptIx(duel, bob, NVDA, TSLA), bob);

    const d = decode("Duel", duel);
    expect(d.status).to.equal(STATUS_ACCEPTED);
    expect(b58(d.opponent)).to.equal(bob.address);
    expect(Number(d.accepted_ts)).to.equal(NOW + 120);
    expect(tokenAmount(await ata(duel, TSLA.mint, TOKEN_2022))).to.equal(7_200_000n);
    expect(tokenAmount(await ata(bob.address, TSLA.mint, TOKEN_2022))).to.equal(42_800_000n);
    // Bob's account for receiving NVDA exists before anything is won.
    expect(tokenAmount(await ata(bob.address, NVDA.mint, TOKEN_2022))).to.equal(0n);
  });

  it("accept_duel refuses the creator, a non-invitee, an expired challenge and a second taker", async () => {
    const alice = await player([[NVDA, 100_000_000n], [TSLA, 100_000_000n]]);
    const bob = await player([[TSLA, 50_000_000n]]);
    const carol = await player([[TSLA, 50_000_000n]]);

    const open = await createDuel({ creator: alice, c: NVDA, x: TSLA, expiresTs: nowTs() + 600 });
    await expectFailure(await acceptIx(open.duel, alice, NVDA, TSLA), alice, "You cannot accept your own duel");

    const invite = await createDuel({ creator: alice, c: NVDA, x: TSLA, invitee: bob.address });
    await expectFailure(await acceptIx(invite.duel, carol, NVDA, TSLA), carol, "This challenge is for someone else");
    await send(await acceptIx(invite.duel, bob, NVDA, TSLA), bob);
    await expectFailure(await acceptIx(invite.duel, bob, NVDA, TSLA), bob, "This duel is not open");

    setClock(nowTs() + 600);
    await expectFailure(await acceptIx(open.duel, carol, NVDA, TSLA), carol, "This challenge has expired");
  });

  // ── start ─────────────────────────────────────────────────────────────────

  it("start_duel takes only the first fully verified price at or after the accept", async () => {
    const d = await acceptedDuel({ duration: 3_600 });
    const boundary = d.acceptedTs + START_DELAY;
    const good = (feed: Uint8Array, price: bigint) =>
      putPrice({ feed, price, publishTime: boundary + 1, prev: boundary - 1 });
    const tslaGood = await good(TSLA.feed, 340_00000000n);

    const cases: [Promise<Address>, string][] = [
      [putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary + 1, prev: boundary - 1, owner: SYSTEM }), "Not an account owned by the Pyth receiver"],
      [putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary + 1, prev: boundary - 1, partial: true }), "The price update is only partially verified"],
      [putPrice({ feed: TSLA.feed, price: 180_00000000n, publishTime: boundary + 1, prev: boundary - 1 }), "The price update is for a different feed"],
      [putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary - 1, prev: boundary - 2 }), "That price was published before the boundary"],
      [putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary + 1, prev: boundary }), "That is not the first price at or after the boundary"],
      [putPrice({ feed: NVDA.feed, price: 0n, publishTime: boundary + 1, prev: boundary - 1 }), "The price is not positive"],
    ];
    for (const [price, message] of cases) {
      await expectFailure(startIx(d.duel, await price, tslaGood), cranker, message);
    }

    // The creator's price first at boundary+1, the opponent's at boundary+3:
    // the duel starts at the later one and runs its hour from there.
    const nvdaGood = await good(NVDA.feed, 180_00000000n);
    const tslaLater = await putPrice({ feed: TSLA.feed, price: 340_00000000n, publishTime: boundary + 3, prev: boundary - 2 });
    await send(startIx(d.duel, nvdaGood, tslaLater), cranker);

    const s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_LIVE);
    expect(Number(s.start_ts)).to.equal(boundary + 3);
    expect(Number(s.end_ts)).to.equal(boundary + 3 + 3_600);
    expect(s.creator_start.price.toString()).to.equal("18000000000");
    expect(s.creator_start.expo).to.equal(-8);
    expect(Number(s.creator_start.publish_time)).to.equal(boundary + 1);
    expect(s.opponent_start.price.toString()).to.equal("34000000000");

    await expectFailure(startIx(d.duel, nvdaGood, tslaLater), cranker, "This duel is not waiting for its start prices");
  });

  it("a duel whose first price comes more than five days after the accept is void, and refunds both", async () => {
    const d = await acceptedDuel({ duration: 3_600 });
    const late = d.acceptedTs + START_DELAY + MAX_START_WAIT + 1;
    const cp = await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: late, prev: d.acceptedTs - 100 });
    const xp = await putPrice({ feed: TSLA.feed, price: 340_00000000n, publishTime: late, prev: d.acceptedTs - 100 });
    await send(startIx(d.duel, cp, xp), cranker);

    const s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_VOID);
    expect(s.outcome).to.equal(OUTCOME_VOID);

    await send(await refundIx(d.duel), cranker);
    expect(decode("Duel", d.duel).status).to.equal(STATUS_REFUNDED);
    expect(tokenAmount(await ata(d.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(exists(await ata(d.duel, NVDA.mint, TOKEN_2022))).to.be.false;
    expect(exists(await ata(d.duel, TSLA.mint, TOKEN_2022))).to.be.false;
  });

  it("a fixed-end duel whose first price lands inside its last minute is void", async () => {
    const end = NOW + 3_600;
    const d = await acceptedDuel({ endTs: end, expiresTs: end - MIN_DUEL });
    // The market printed nothing between the accept and 30 seconds before the end.
    const cp = await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: end - 30, prev: d.acceptedTs - 5 });
    const xp = await putPrice({ feed: TSLA.feed, price: 340_00000000n, publishTime: end - 30, prev: d.acceptedTs - 5 });
    await send(startIx(d.duel, cp, xp), cranker);
    expect(decode("Duel", d.duel).status).to.equal(STATUS_VOID);
    expect(Number(decode("Duel", d.duel).end_ts)).to.equal(end);
  });

  // ── settle ────────────────────────────────────────────────────────────────

  it("settle_duel pays the creator both stakes when their stock moves more", async () => {
    const d = await liveDuel(180_00000000n, 340_00000000n);
    const creatorLamports = lamportsOf(d.creator.address);
    const opponentLamports = lamportsOf(d.opponent.address);

    setClock(d.endTs + 5);
    // NVDA +3%, TSLA +1%.
    const cp = await putPrice({ feed: NVDA.feed, price: 185_40000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    const xp = await putPrice({ feed: TSLA.feed, price: 343_40000000n, publishTime: d.endTs + 1, prev: d.endTs - 1 });
    await send(await settleIx(d.duel, cp, xp), cranker);

    const s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_SETTLED);
    expect(s.outcome).to.equal(OUTCOME_CREATOR);
    expect(b58(s.winner)).to.equal(d.creator.address);
    expect(s.creator_end.price.toString()).to.equal("18540000000");
    expect(s.opponent_end.price.toString()).to.equal("34340000000");

    // The creator holds their NVDA back plus the opponent's TSLA.
    expect(tokenAmount(await ata(d.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);
    expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(992_800_000n);
    expect(tokenAmount(await ata(d.opponent.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);

    // Both escrows are gone, and each player got their own escrow's rent back.
    expect(exists(await ata(d.duel, NVDA.mint, TOKEN_2022))).to.be.false;
    expect(exists(await ata(d.duel, TSLA.mint, TOKEN_2022))).to.be.false;
    expect(lamportsOf(d.creator.address) > creatorLamports).to.be.true;
    expect(lamportsOf(d.opponent.address) > opponentLamports).to.be.true;

    // A second settlement has no escrow left to pay from.
    await expectFailure(await settleIx(d.duel, cp, xp), cranker, "AccountNotInitialized");
    expect(tokenAmount(await ata(d.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);
  });

  it("settle_duel pays the opponent when their stock moves more in percent, not in dollars", async () => {
    // Creator backs TSLA: $340 -> $346.80, +2%, +$6.80.
    // Opponent backs NVDA: $180 -> $185.40, +3%, +$5.40.
    const d = await liveDuel(340_00000000n, 180_00000000n, { c: TSLA, x: NVDA });
    const cp = await putPrice({ feed: TSLA.feed, price: 346_80000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    const xp = await putPrice({ feed: NVDA.feed, price: 185_40000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    await send(await settleIx(d.duel, cp, xp), cranker);

    const s = decode("Duel", d.duel);
    expect(s.outcome).to.equal(OUTCOME_OPPONENT);
    expect(b58(s.winner)).to.equal(d.opponent.address);
    expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_014_000_000n);
    expect(tokenAmount(await ata(d.creator.address, TSLA.mint, TOKEN_2022))).to.equal(986_000_000n);
  });

  it("an exact tie refunds each side its own stake", async () => {
    const d = await liveDuel(180_00000000n, 340_00000000n);
    // +2% each.
    const cp = await putPrice({ feed: NVDA.feed, price: 183_60000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    const xp = await putPrice({ feed: TSLA.feed, price: 346_80000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    await send(await settleIx(d.duel, cp, xp), cranker);

    const s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_REFUNDED);
    expect(s.outcome).to.equal(OUTCOME_TIE);
    expect(b58(s.winner)).to.equal(DEFAULT_PUBKEY);
    expect(tokenAmount(await ata(d.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
  });

  it("settle_duel refuses a price from before the bell, one that is not the first after it, and an unstarted duel", async () => {
    const d = await liveDuel(180_00000000n, 340_00000000n);
    const xp = await putPrice({ feed: TSLA.feed, price: 350_00000000n, publishTime: d.endTs, prev: d.endTs - 1 });

    const early = await putPrice({ feed: NVDA.feed, price: 190_00000000n, publishTime: d.endTs - 1, prev: d.endTs - 2 });
    await expectFailure(await settleIx(d.duel, early, xp), cranker, "That price was published before the boundary");

    // A settler shopping for a better NVDA print later in the same second.
    const shopped = await putPrice({ feed: NVDA.feed, price: 190_00000000n, publishTime: d.endTs, prev: d.endTs });
    await expectFailure(await settleIx(d.duel, shopped, xp), cranker, "That is not the first price at or after the boundary");

    const start = await putPrice({ feed: NVDA.feed, price: 1n, publishTime: d.endTs, prev: d.endTs - 1 });
    const a = await acceptedDuel();
    await expectFailure(await settleIx(a.duel, start, xp), cranker, "This duel is not live");

    expect(decode("Duel", d.duel).status).to.equal(STATUS_LIVE);
  });

  it("a live duel nobody can settle refunds after a week past its end, not a second before", async () => {
    const d = await liveDuel(180_00000000n, 340_00000000n);
    setClock(d.endTs + STALL - 1);
    await expectFailure(await refundIx(d.duel), cranker, "This duel cannot be refunded yet");
    setClock(d.endTs + STALL);
    await send(await refundIx(d.duel), cranker);
    const s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_REFUNDED);
    expect(s.outcome).to.equal(OUTCOME_VOID);
    expect(tokenAmount(await ata(d.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
  });

  it("an accepted duel whose start never posts refunds after a week, and not before", async () => {
    const d = await acceptedDuel();
    setClock(d.acceptedTs + STALL - 1);
    await expectFailure(await refundIx(d.duel), cranker, "This duel cannot be refunded yet");
    setClock(d.acceptedTs + STALL);
    await send(await refundIx(d.duel), cranker);
    expect(decode("Duel", d.duel).status).to.equal(STATUS_REFUNDED);
  });

  it("an open duel cannot be pulled through refund_duel, however old", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    const { duel, escrow } = await createDuel({ creator: alice, c: NVDA, x: TSLA });
    setClock(NOW + STALL * 2);
    // An open duel has no opponent and no opponent escrow, so this fails on its
    // accounts before it reaches the status check. The only way out for an
    // open duel is cancel_duel, which pays the creator.
    const res = svm.simulateTransaction(await buildTx(await refundIx(duel), cranker));
    expect(res).to.be.instanceOf(FailedTransactionMetadata);
    expect(tokenAmount(escrow)).to.equal(14_000_000n);
  });

  it("a duel across both token programs, and two price exponents, settles", async () => {
    // AAPL is a classic SPL mint with 6 decimals, priced at expo -6; NVDA is
    // Token-2022 at expo -8. AAPL falls 1%, NVDA falls 2%: AAPL lost less.
    const e = await acceptedDuel({ c: AAPL, x: NVDA, cAmount: 108_000n, xAmount: 13_800_000n });
    const boundary = e.acceptedTs + START_DELAY;
    await send(
      startIx(
        e.duel,
        await putPrice({ feed: AAPL.feed, price: 230_000000n, expo: -6, publishTime: boundary, prev: boundary - 1 }),
        await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary, prev: boundary - 1 }),
      ),
      cranker,
    );
    const end = Number(decode("Duel", e.duel).end_ts);
    await send(
      await settleIx(
        e.duel,
        await putPrice({ feed: AAPL.feed, price: 227_700000n, expo: -6, publishTime: end, prev: end - 1 }),
        await putPrice({ feed: NVDA.feed, price: 176_40000000n, publishTime: end, prev: end - 1 }),
      ),
      cranker,
    );
    const s = decode("Duel", e.duel);
    expect(s.outcome).to.equal(OUTCOME_CREATOR);
    expect(tokenAmount(await ata(e.creator.address, AAPL.mint, TOKEN))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(e.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_013_800_000n);
  });

  it("settlement creates the payout account a winner never had", async () => {
    // The creator stakes from a token account that is not their ATA, so they
    // have no NVDA ATA when the duel ends. The settler pays for it.
    const alice = await player();
    const loose = (await generateKeyPairSigner()).address;
    put(loose, encodeTokenAccount(NVDA.mint, alice.address, 50_000_000n), TOKEN_2022, 2_039_280n);
    const aliceNvda = await ata(alice.address, NVDA.mint, TOKEN_2022);
    expect(exists(aliceNvda)).to.be.false;

    const bob = await player([[TSLA, 50_000_000n]]);
    const { duel } = await createDuel({ creator: alice, c: NVDA, x: TSLA, source: loose });
    await send(await acceptIx(duel, bob, NVDA, TSLA), bob);
    const boundary = nowTs() + START_DELAY;
    await send(
      startIx(
        duel,
        await putPrice({ feed: NVDA.feed, price: 100_00000000n, publishTime: boundary, prev: boundary - 1 }),
        await putPrice({ feed: TSLA.feed, price: 100_00000000n, publishTime: boundary, prev: boundary - 1 }),
      ),
      cranker,
    );
    const end = Number(decode("Duel", duel).end_ts);
    await send(
      await settleIx(
        duel,
        await putPrice({ feed: NVDA.feed, price: 101_00000000n, publishTime: end, prev: end - 1 }),
        await putPrice({ feed: TSLA.feed, price: 100_00000000n, publishTime: end, prev: end - 1 }),
      ),
      cranker,
    );
    expect(tokenAmount(aliceNvda)).to.equal(14_000_000n);
    expect(tokenAmount(await ata(alice.address, TSLA.mint, TOKEN_2022))).to.equal(7_200_000n);
    expect(tokenAmount(loose)).to.equal(36_000_000n);
  });

  // ── signed prices ─────────────────────────────────────────────────────────

  it("a signed stock cannot be duelled until the admin names an oracle, and only the admin can", async () => {
    const alice = await player([[AMD, 100_000_000n]]);
    await expectFailure(
      (await createIx({ creator: alice, c: AMD, x: NVDA })).instruction,
      alice,
      "No oracle is configured for signed prices",
    );

    const stranger = await player();
    await expectFailure(setOracleIx(stranger.address, stranger), stranger, "ConstraintHasOne");
    await send(setOracleIx(oracle.address), admin);
    expect(b58(decode("Config", configPda).oracle)).to.equal(oracle.address);

    const { duel } = await createDuel({ creator: alice, c: AMD, x: NVDA });
    const d = decode("Duel", duel);
    expect(d.creator_source).to.equal(SIGNED);
    expect(d.opponent_source).to.equal(PYTH);
    expect(b58(d.oracle)).to.equal(oracle.address);

    // A duel with no signed side trusts no oracle, and records none.
    const bob = await player([[NVDA, 100_000_000n]]);
    const pythOnly = await createDuel({ creator: bob, c: NVDA, x: TSLA });
    expect(b58(decode("Duel", pythOnly.duel).oracle)).to.equal(DEFAULT_PUBKEY);
  });

  it("a Pyth stock against a signed stock starts and settles, on the oracle's quotes for its side", async () => {
    const d = await acceptedDuel({ c: AMD, x: NVDA, duration: 3_600 });
    const boundary = d.acceptedTs + START_DELAY;
    const amdStart = await signedQuote(oracle, {
      feed: AMD.feed,
      boundary,
      price: 150_00n,
      expo: -2,
      publishTime: boundary + 58,
    });
    const nvdaStart = await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary, prev: boundary - 1 });
    await send([ed25519Ix([amdStart]), startIx(d.duel, null, nvdaStart)], cranker);

    let s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_LIVE);
    expect(s.creator_start.price.toString()).to.equal("15000");
    expect(s.creator_start.expo).to.equal(-2);
    expect(Number(s.creator_start.publish_time)).to.equal(boundary + 58);
    // The duel starts at the later of its two start prices.
    expect(Number(s.start_ts)).to.equal(boundary + 58);
    const end = Number(s.end_ts);
    expect(end).to.equal(boundary + 58 + 3_600);

    // AMD +4%, NVDA +3%: the creator's AMD wins.
    setClock(end + 90);
    const amdEnd = await signedQuote(oracle, { feed: AMD.feed, boundary: end, price: 156_00n, expo: -2, publishTime: end + 30 });
    const nvdaEnd = await putPrice({ feed: NVDA.feed, price: 185_40000000n, publishTime: end, prev: end - 1 });
    await send([ed25519Ix([amdEnd]), await settleIx(d.duel, null, nvdaEnd)], cranker);

    s = decode("Duel", d.duel);
    expect(s.status).to.equal(STATUS_SETTLED);
    expect(s.outcome).to.equal(OUTCOME_CREATOR);
    expect(s.creator_end.price.toString()).to.equal("15600");
    expect(tokenAmount(await ata(d.creator.address, AMD.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    expect(tokenAmount(await ata(d.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_007_200_000n);
  });

  it("two signed sides can share one Ed25519 instruction, in either order", async () => {
    const d = await acceptedDuel({ c: AMD, x: PLTR, duration: 3_600 });
    const boundary = d.acceptedTs + START_DELAY;
    const at = (feed: Uint8Array, b: number, price: bigint) =>
      signedQuote(oracle, { feed, boundary: b, price, expo: -2, publishTime: b + 10 });
    await send(
      [ed25519Ix([await at(AMD.feed, boundary, 150_00n), await at(PLTR.feed, boundary, 30_00n)]), startIx(d.duel, null, null)],
      cranker,
    );
    const end = Number(decode("Duel", d.duel).end_ts);

    // AMD -1%, PLTR -2%: AMD lost less.
    setClock(end + 60);
    await send(
      [ed25519Ix([await at(PLTR.feed, end, 29_40n), await at(AMD.feed, end, 148_50n)]), await settleIx(d.duel, null, null)],
      cranker,
    );
    expect(decode("Duel", d.duel).outcome).to.equal(OUTCOME_CREATOR);
    expect(tokenAmount(await ata(d.creator.address, PLTR.mint, TOKEN_2022))).to.equal(1_007_200_000n);
  });

  it("start_duel refuses a quote from another key, for another moment or stock, or read from elsewhere", async () => {
    const d = await acceptedDuel({ c: AMD, x: NVDA, duration: 3_600 });
    const boundary = d.acceptedTs + START_DELAY;
    const nvda = await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary, prev: boundary - 1 });
    const good: QuoteTerms = { feed: AMD.feed, boundary, price: 150_00n, expo: -2, publishTime: boundary + 40 };
    const stranger = await generateKeyPairSigner();
    const none = "No valid signed quote for this stock at this boundary";

    const cases: [any, string][] = [
      [ed25519Ix([await signedQuote(stranger, good)]), none],
      [ed25519Ix([await signedQuote(oracle, { ...good, boundary: boundary + 1 })]), none],
      [ed25519Ix([await signedQuote(oracle, { ...good, feed: PLTR.feed })]), none],
      /* A valid signature whose entry says "read me from instruction 0". The
       * Ed25519 program is instruction 0 here, so it verifies; the program
       * still refuses to read it, because in general such an entry points at
       * bytes somewhere other than where they appear to be. */
      [ed25519Ix([await signedQuote(oracle, good)], 0), none],
      [ed25519Ix([await signedQuote(oracle, { ...good, publishTime: boundary - 1 })]), "That price was published before the boundary"],
      [ed25519Ix([await signedQuote(oracle, { ...good, price: 0n })]), "The price is not positive"],
    ];
    for (const [check, message] of cases) {
      await expectFailure([check, startIx(d.duel, null, nvda)], cranker, message);
    }

    // No quote at all; and a Pyth side with no price account.
    await expectFailure(startIx(d.duel, null, nvda), cranker, none);
    await expectFailure(
      [ed25519Ix([await signedQuote(oracle, good)]), startIx(d.duel, null, null)],
      cranker,
      "Not an account owned by the Pyth receiver",
    );

    // A quote altered after signing fails the whole transaction in the
    // Ed25519 program, before the duel program could read it.
    const forged = await signedQuote(oracle, good);
    forged.msg = quoteMsg({ ...good, price: 999_99n });
    const res = svm.simulateTransaction(await buildTx([ed25519Ix([forged]), startIx(d.duel, null, nvda)], cranker));
    expect(res).to.be.instanceOf(FailedTransactionMetadata);
    const logs = (res as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logs).to.not.include("Program log: Instruction: StartDuel");

    expect(decode("Duel", d.duel).status).to.equal(STATUS_ACCEPTED);
    await send([ed25519Ix([await signedQuote(oracle, good)]), startIx(d.duel, null, nvda)], cranker);
    expect(decode("Duel", d.duel).status).to.equal(STATUS_LIVE);
  });

  it("a new oracle key prices only duels created after it was named", async () => {
    const alice = await player([[AMD, 100_000_000n]]);
    const bob = await player([[NVDA, 100_000_000n]]);
    const { duel } = await createDuel({ creator: alice, c: AMD, x: NVDA });
    await send(await acceptIx(duel, bob, AMD, NVDA), bob);
    const boundary = nowTs() + START_DELAY;
    const nvda = await putPrice({ feed: NVDA.feed, price: 180_00000000n, publishTime: boundary, prev: boundary - 1 });
    const q: QuoteTerms = { feed: AMD.feed, boundary, price: 150_00n, expo: -2, publishTime: boundary + 5 };

    const next = await generateKeyPairSigner();
    await send(setOracleIx(next.address), admin);
    try {
      await expectFailure(
        [ed25519Ix([await signedQuote(next, q)]), startIx(duel, null, nvda)],
        cranker,
        "No valid signed quote for this stock at this boundary",
      );
      await send([ed25519Ix([await signedQuote(oracle, q)]), startIx(duel, null, nvda)], cranker);
      expect(decode("Duel", duel).status).to.equal(STATUS_LIVE);
    } finally {
      await send(setOracleIx(oracle.address), admin);
    }
  });

  it("two issuers' tokens of one stock cannot be duelled against each other", async () => {
    const alice = await player([[NVDA, 100_000_000n]]);
    await expectFailure(
      (await createIx({ creator: alice, c: NVDA, x: NVDA_B })).instruction,
      alice,
      "A duel needs two different stocks",
    );
  });

  it("register_asset and set_asset refuse an unknown price source", async () => {
    const odd = { ...(await newStock("ODDx", TOKEN_2022, 8, 11)), source: 2 };
    await expectFailure(await registerIx(odd), admin, "Unknown price source");
    await expectFailure(
      ix("set_asset", { feed_id: Array.from(NVDA.feed), enabled: true, source: 7 }, [
        acct(configPda, R),
        acct(await assetPda(NVDA.mint), W),
        acct(admin.address, RS, admin),
      ]),
      admin,
      "Unknown price source",
    );
  });

  // ── admin ─────────────────────────────────────────────────────────────────

  it("pause stops new duels and new accepts, never a settlement", async () => {
    const live = await liveDuel(180_00000000n, 340_00000000n);
    const alice = await player([[NVDA, 100_000_000n]]);
    const bob = await player([[TSLA, 100_000_000n]]);
    const open = await createDuel({ creator: alice, c: NVDA, x: TSLA });

    const pause = (paused: boolean) =>
      ix("set_paused", { paused }, [acct(configPda, W), acct(admin.address, RS, admin)]);
    await send(pause(true), admin);
    try {
      await expectFailure((await createIx({ creator: alice, c: NVDA, x: TSLA })).instruction, alice, "New duels are paused");
      await expectFailure(await acceptIx(open.duel, bob, NVDA, TSLA), bob, "New duels are paused");

      const cp = await putPrice({ feed: NVDA.feed, price: 181_00000000n, publishTime: live.endTs, prev: live.endTs - 1 });
      const xp = await putPrice({ feed: TSLA.feed, price: 340_00000000n, publishTime: live.endTs, prev: live.endTs - 1 });
      await send(await settleIx(live.duel, cp, xp), cranker);
      expect(decode("Duel", live.duel).status).to.equal(STATUS_SETTLED);

      await send(await cancelIx(open.duel, alice), alice);
      expect(exists(open.duel)).to.be.false;
    } finally {
      await send(pause(false), admin);
    }

    const stranger = await player();
    await expectFailure(
      ix("set_paused", { paused: true }, [acct(configPda, W), acct(stranger.address, RS, stranger)]),
      stranger,
      "ConstraintHasOne",
    );
  });

  /* A HANDLE NEEDS BOTH SIGNATURES.
   *
   * The wallet's says who is claiming; the oracle's is the server vouching
   * that X's own sign-in named that handle. Either alone is worthless, which
   * is most of what these check. */
  describe("link_handle", () => {
    const profilePda = (wallet: Address) => pda([enc("profile"), codec.encode(wallet) as Uint8Array]);

    async function claimPda(xId: bigint): Promise<Address> {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, xId, true);
      return pda([enc("xclaim"), b]);
    }

    async function linkIx(
      wallet: KeyPairSigner,
      xId: bigint,
      handle: string,
      voucher: KeyPairSigner = oracle,
    ) {
      return ix("link_handle", { x_id: new BN(xId.toString()), handle }, [
        acct(wallet.address, WS, wallet),
        acct(voucher.address, RS, voucher),
        acct(configPda, R),
        acct(await profilePda(wallet.address), W),
        acct(await claimPda(xId), W),
        acct(SYSTEM, R),
      ]);
    }

    const unlinkIx = async (wallet: KeyPairSigner, xId: bigint) =>
      ix("unlink_handle", {}, [
        acct(wallet.address, WS, wallet),
        acct(await profilePda(wallet.address), W),
        acct(await claimPda(xId), W),
      ]);

    it("writes the handle when the wallet and the oracle both sign", async () => {
      const alice = await player();
      await send(await linkIx(alice, 7777n, "stonkwars"), alice);

      const p = decode("Profile", await profilePda(alice.address));
      expect(b58(p.wallet)).to.equal(alice.address);
      expect(p.handle).to.equal("stonkwars");
      expect(Number(p.x_id)).to.equal(7777);
      expect(Number(p.linked_ts)).to.equal(nowTs());

      // The X account points back, which is what makes it displayable.
      expect(b58(decode("XClaim", await claimPda(7777n)).wallet)).to.equal(alice.address);
    });

    it("refuses a handle the oracle did not vouch for", async () => {
      const bob = await player();
      const impostor = await generateKeyPairSigner();
      svm.airdrop(impostor.address, lamports(SOL));
      await expectFailure(await linkIx(bob, 8888n, "elonmusk", impostor), bob, "NoOracle");
    });

    it("refuses to write a handle onto a wallet that did not sign", async () => {
      /* The oracle vouches for the X account, never for the wallet: aimed at
       * somebody else's profile, the seeds no longer match the signer. */
      const carol = await player();
      const dave = await player();
      const stolen = ix("link_handle", { x_id: new BN(9999), handle: "carol" }, [
        acct(carol.address, WS, carol),
        acct(oracle.address, RS, oracle),
        acct(configPda, R),
        acct(await profilePda(dave.address), W),
        acct(await claimPda(9999n), W),
        acct(SYSTEM, R),
      ]);
      await expectFailure(stolen, carol, "ConstraintSeeds");
    });

    it("refuses anything X itself would not issue as a handle", async () => {
      const e = await player();
      for (const bad of ["", "sixteen_chars_xx", "has space", "kebab-case", "semi;colon"]) {
        await expectFailure(await linkIx(e, 1234n, bad), e, "BadHandle");
      }
      await expectFailure(await linkIx(e, 0n, "zeroid"), e, "BadHandle");
      // Fifteen is the limit; digits and underscores are fine inside it.
      await send(await linkIx(e, 1234n, "a_b9_fifteen_15"), e);
      expect(decode("Profile", await profilePda(e.address)).handle).to.equal("a_b9_fifteen_15");
    });

    it("lets somebody change handle, keeping one profile", async () => {
      const f = await player();
      await send(await linkIx(f, 4242n, "before"), f);
      await send(await linkIx(f, 4242n, "after"), f);
      expect(decode("Profile", await profilePda(f.address)).handle).to.equal("after");
    });

    it("moves an X account to a new wallet, leaving the old profile pointing nowhere", async () => {
      const oldWallet = await player();
      const newWallet = await player();
      await send(await linkIx(oldWallet, 5150n, "mover"), oldWallet);
      await send(await linkIx(newWallet, 5150n, "mover"), newWallet);

      // Both profiles exist; only the new one agrees with the claim, and a
      // reader shows a handle only on agreement.
      expect(b58(decode("XClaim", await claimPda(5150n)).wallet)).to.equal(newWallet.address);
      expect(decode("Profile", await profilePda(oldWallet.address)).x_id.toString()).to.equal("5150");
    });

    it("unlinks for the rent back, and only the wallet decides", async () => {
      const g = await player();
      await send(await linkIx(g, 6060n, "quitter"), g);

      const stranger = await player();
      await expectFailure(
        ix("unlink_handle", {}, [
          acct(stranger.address, WS, stranger),
          acct(await profilePda(g.address), W),
          acct(await claimPda(6060n), W),
        ]),
        stranger,
        "ConstraintSeeds",
      );

      const before = svm.getBalance(g.address)!;
      await send(await unlinkIx(g, 6060n), g);
      expect(exists(await profilePda(g.address))).to.be.false;
      expect(exists(await claimPda(6060n))).to.be.false;
      expect(svm.getBalance(g.address)!).to.be.greaterThan(before);
    });

    it("will not let a left-behind profile close somebody else's claim", async () => {
      const first = await player();
      const second = await player();
      await send(await linkIx(first, 3131n, "shared"), first);
      await send(await linkIx(second, 3131n, "shared"), second);

      // The claim belongs to the second wallet now.
      await expectFailure(await unlinkIx(first, 3131n), first, "NotYourClaim");
      await send(await unlinkIx(second, 3131n), second);
    });
  });

  /* THE PLATFORM FEE.
   *
   * A share of the loser's stake to the treasury at settlement, capped by the
   * program, a raise reaching only duels created a week later, and never in the
   * way of a payout: any gap in what a settler passes and the winner is paid in
   * full. Runs last among the settlements, and leaves the fee at zero. */
  describe("platform fee", () => {
    const WEEK = 7 * 86_400;
    let feePda: Address;
    let treasury: KeyPairSigner;

    const setFeeIx = (bps: number, to: Address, signer = admin) =>
      ix("set_fee", { fee_bps: bps, treasury: new PublicKey(to) }, [
        acct(configPda, R),
        acct(signer.address, WS, signer),
        acct(feePda, W),
        acct(SYSTEM, R),
      ]);

    const treasuryAta = (stock: Stock) => ata(treasury.address, stock.mint, stock.program);
    const feeAccounts = async () => [
      acct(feePda, R),
      acct(await treasuryAta(TSLA), W),
      acct(await treasuryAta(NVDA), W),
    ];

    /** NVDA +3% against TSLA +1%: the creator (NVDA) wins, the TSLA stake is the loser's. */
    async function settleCreatorWin(d: { duel: Address; endTs: number }, extra: any[]) {
      const cp = await putPrice({ feed: NVDA.feed, price: 185_40000000n, publishTime: d.endTs, prev: d.endTs - 1 });
      const xp = await putPrice({ feed: TSLA.feed, price: 343_40000000n, publishTime: d.endTs, prev: d.endTs - 1 });
      await send(await settleIx(d.duel, cp, xp, cranker, extra), cranker);
    }

    before(async () => {
      feePda = await pda([enc("fee")]);
      treasury = await generateKeyPairSigner();
      for (const s of [TSLA, NVDA]) {
        put(await treasuryAta(s), encodeTokenAccount(s.mint, treasury.address, 0n), s.program, 2_039_280n);
      }
    });

    after(async () => {
      setClock(NOW + 3 * WEEK);
      await send(setFeeIx(0, treasury.address), admin);
    });

    it("set_fee is the admin's alone, capped, and needs a treasury", async () => {
      const stranger = await player();
      await expectFailure(setFeeIx(100, treasury.address, stranger), stranger, "ConstraintHasOne");
      await expectFailure(setFeeIx(501, treasury.address), admin, "That fee is above the program's cap");
      await expectFailure(setFeeIx(100, DEFAULT_PUBKEY), admin, "The fee needs a treasury");
      expect(exists(feePda)).to.be.false;
    });

    it("a raise waits a week: a duel created during the notice pays nothing, one created after pays on the loser's stake", async () => {
      await send(setFeeIx(250, treasury.address), admin);
      const f = decode("FeeConfig", feePda);
      expect(f.fee_bps).to.equal(250);
      expect(f.prior_bps).to.equal(0);
      expect(Number(f.from_ts)).to.equal(NOW + WEEK);
      expect(b58(f.treasury)).to.equal(treasury.address);

      const during = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(during, await feeAccounts());
      expect(tokenAmount(await ata(during.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);
      expect(tokenAmount(await treasuryAta(TSLA))).to.equal(0n);

      setClock(NOW + WEEK);
      const after = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(after, await feeAccounts());
      // 2.5% of the 7_200_000 TSLA the opponent staked.
      expect(tokenAmount(await treasuryAta(TSLA))).to.equal(180_000n);
      expect(tokenAmount(await ata(after.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_020_000n);
      expect(tokenAmount(await ata(after.creator.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
      expect(tokenAmount(await ata(after.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(992_800_000n);
      expect(tokenAmount(await treasuryAta(NVDA))).to.equal(0n);
      expect(exists(await ata(after.duel, TSLA.mint, TOKEN_2022))).to.be.false;
    });

    it("pays the winner in full when the fee accounts are missing, wrong, or frozen, and never charges a tie", async () => {
      setClock(NOW + WEEK);
      const before = tokenAmount(await treasuryAta(TSLA));

      const none = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(none, []);
      expect(tokenAmount(await ata(none.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);

      // A token account for the right mint that the treasury does not own.
      const stranger = await player([[TSLA, 0n]]);
      const wrong = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(wrong, [acct(feePda, R), acct(await ata(stranger.address, TSLA.mint, TOKEN_2022), W)]);
      expect(tokenAmount(await ata(wrong.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);
      expect(tokenAmount(await ata(stranger.address, TSLA.mint, TOKEN_2022))).to.equal(0n);

      // Something that is not the fee config, in the fee config's place.
      const fake = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(fake, [acct(configPda, R), acct(await treasuryAta(TSLA), W)]);
      expect(tokenAmount(await ata(fake.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);

      // A frozen treasury account would fail the transfer, so it is skipped.
      const frozenAddr = (await generateKeyPairSigner()).address;
      const frozenData = encodeTokenAccount(TSLA.mint, treasury.address, 0n);
      frozenData[108] = 2;
      put(frozenAddr, frozenData, TOKEN_2022, 2_039_280n);
      const frozen = await liveDuel(180_00000000n, 340_00000000n);
      await settleCreatorWin(frozen, [acct(feePda, R), acct(frozenAddr, W)]);
      expect(tokenAmount(await ata(frozen.creator.address, TSLA.mint, TOKEN_2022))).to.equal(1_007_200_000n);

      // +2% each: a tie refunds both stakes whole.
      const tie = await liveDuel(180_00000000n, 340_00000000n);
      const cp = await putPrice({ feed: NVDA.feed, price: 183_60000000n, publishTime: tie.endTs, prev: tie.endTs - 1 });
      const xp = await putPrice({ feed: TSLA.feed, price: 346_80000000n, publishTime: tie.endTs, prev: tie.endTs - 1 });
      await send(await settleIx(tie.duel, cp, xp, cranker, await feeAccounts()), cranker);
      expect(decode("Duel", tie.duel).outcome).to.equal(OUTCOME_TIE);
      expect(tokenAmount(await ata(tie.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_000_000_000n);

      expect(tokenAmount(await treasuryAta(TSLA))).to.equal(before);
    });

    it("a cut reaches a duel already live, and an opponent's win takes the fee from the creator's stake", async () => {
      setClock(NOW + WEEK);
      // Creator backs TSLA (+2%), opponent backs NVDA (+3%): the opponent wins.
      const d = await liveDuel(340_00000000n, 180_00000000n, { c: TSLA, x: NVDA });
      await send(setFeeIx(100, treasury.address), admin);
      const before = tokenAmount(await treasuryAta(TSLA));

      const cp = await putPrice({ feed: TSLA.feed, price: 346_80000000n, publishTime: d.endTs, prev: d.endTs - 1 });
      const xp = await putPrice({ feed: NVDA.feed, price: 185_40000000n, publishTime: d.endTs, prev: d.endTs - 1 });
      await send(await settleIx(d.duel, cp, xp, cranker, await feeAccounts()), cranker);

      expect(decode("Duel", d.duel).outcome).to.equal(OUTCOME_OPPONENT);
      // 1% of the creator's 14_000_000 TSLA, not the 2.5% it was created under.
      expect(tokenAmount(await treasuryAta(TSLA)) - before).to.equal(140_000n);
      expect(tokenAmount(await ata(d.opponent.address, TSLA.mint, TOKEN_2022))).to.equal(1_013_860_000n);
      expect(tokenAmount(await ata(d.opponent.address, NVDA.mint, TOKEN_2022))).to.equal(1_000_000_000n);
    });
  });

  it("close_duel returns the rent only once a duel is finished, and only to its creator", async () => {
    const d = await liveDuel(180_00000000n, 340_00000000n);
    const close = (who: KeyPairSigner) =>
      ix("close_duel", {}, [acct(who.address, WS, who), acct(d.duel, W)]);

    await expectFailure(close(d.creator), d.creator, "This duel is not finished");

    const cp = await putPrice({ feed: NVDA.feed, price: 170_00000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    const xp = await putPrice({ feed: TSLA.feed, price: 340_00000000n, publishTime: d.endTs, prev: d.endTs - 1 });
    await send(await settleIx(d.duel, cp, xp), cranker);
    expect(decode("Duel", d.duel).outcome).to.equal(OUTCOME_OPPONENT);

    await expectFailure(close(d.opponent), d.opponent, "ConstraintHasOne");
    await send(close(d.creator), d.creator);
    expect(exists(d.duel)).to.be.false;
  });
});
