/* The receipt reads a fight's steps from the events the program wrote into
 * each transaction's logs. The fixtures are real log lines: an event encoded
 * with the same coder the page decodes with, behind Anchor's "Program data: "
 * prefix and the event's discriminator from the vendored IDL. */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import idl from "../src/idl/duel.json";
import { coder, OUTCOME_CREATOR } from "../src/lib/duel";
import {
  classifyTx,
  etStamp,
  feeTotal,
  rowsFromAccount,
  rowsFromEvents,
  settledAfterBell,
  SETTLER_WALLETS,
  solFromLamports,
  waitWords,
  type ReceiptRow,
  type TxLike,
} from "../src/lib/receipt";

const DUEL = PublicKey.unique();
const OTHER_DUEL = PublicKey.unique();
const CREATOR = PublicKey.unique();
const OPPONENT = PublicKey.unique();
const SETTLER = PublicKey.unique();

function eventLine(name: string, fields: Record<string, unknown>): string {
  const event = (idl as { events: { name: string; discriminator: number[] }[] }).events.find((e) => e.name === name);
  if (!event) throw new Error(`no event ${name}`);
  const body = coder.types.encode(name, fields);
  return `Program data: ${Buffer.concat([Buffer.from(event.discriminator), body]).toString("base64")}`;
}

function tx(logs: string[], payer: PublicKey, signature: string, blockTime = 1_789_000_000, err: unknown = null): TxLike {
  return {
    blockTime,
    meta: { err, logMessages: ["Program Duel1111 invoke [1]", "Program log: Instruction: SettleDuel", ...logs] },
    transaction: { signatures: [signature], message: { staticAccountKeys: [payer, DUEL] } },
  };
}

const settled = (duel: PublicKey) =>
  eventLine("DuelSettled", {
    duel,
    outcome: OUTCOME_CREATOR,
    winner: CREATOR,
    creator_return_bps: new BN(42),
    opponent_return_bps: new BN(-10),
  });

describe("receipt", () => {
  it("decodes a settle event, its signer and its time", () => {
    const e = classifyTx(tx([settled(DUEL)], SETTLER, "sig-settle"), DUEL.toBase58());
    expect(e).to.not.equal(null);
    expect(e!.kind).to.equal("DuelSettled");
    expect(e!.feePayer).to.equal(SETTLER.toBase58());
    expect(e!.signature).to.equal("sig-settle");
    expect(e!.blockTime).to.equal(1_789_000_000);
    expect(e!.data.duel).to.equal(DUEL.toBase58());
    expect(e!.data.winner).to.equal(CREATOR.toBase58());
    expect(e!.data.outcome).to.equal(OUTCOME_CREATOR);
    expect(e!.data.opponent_return_bps).to.equal(-10);
  });

  it("ignores another fight's event in a transaction that settled several", () => {
    const both = tx([settled(OTHER_DUEL), settled(DUEL)], SETTLER, "sig-batch");
    expect(classifyTx(both, DUEL.toBase58())!.data.duel).to.equal(DUEL.toBase58());
    expect(classifyTx(tx([settled(OTHER_DUEL)], SETTLER, "sig-other"), DUEL.toBase58())).to.equal(null);
  });

  it("finds nothing in a failed transaction, plain logs, or data that is not an event", () => {
    expect(classifyTx(tx([settled(DUEL)], SETTLER, "sig-failed", 1, { InstructionError: [0, "Custom"] }))).to.equal(null);
    expect(classifyTx(tx(["Program log: hello"], SETTLER, "sig-plain"))).to.equal(null);
    expect(classifyTx(tx(["Program data: !!!not base64!!!", "Program data: AAAA"], SETTLER, "sig-junk"))).to.equal(null);
  });

  it("lists the steps in order, naming the fighters and marking a spectator's settle", () => {
    const d = { creator: CREATOR, opponent: OPPONENT };
    const created = classifyTx(
      tx(
        [
          eventLine("DuelCreated", {
            duel: DUEL,
            creator: CREATOR,
            creator_mint: PublicKey.unique(),
            opponent_mint: PublicKey.unique(),
            creator_amount: new BN(10_000_000),
            opponent_amount: new BN(11_000_000),
            duration_secs: new BN(360),
            end_ts: new BN(0),
            expires_ts: new BN(1_789_086_400),
            invitee: PublicKey.default,
          }),
        ],
        CREATOR,
        "sig-create",
        1_789_000_000,
      ),
    )!;
    const accepted = classifyTx(
      tx([eventLine("DuelAccepted", { duel: DUEL, opponent: OPPONENT, accepted_ts: new BN(1_789_000_100) })], OPPONENT, "sig-accept", 1_789_000_100),
    )!;
    const started = classifyTx(
      tx(
        [
          eventLine("DuelStarted", {
            duel: DUEL,
            start_ts: new BN(1_789_000_160),
            end_ts: new BN(1_789_000_520),
            creator_price: new BN(18_234_000_000),
            creator_expo: -8,
            opponent_price: new BN(22_910_000_000),
            opponent_expo: -8,
          }),
        ],
        SETTLER,
        "sig-start",
        1_789_000_165,
      ),
    )!;
    const settle = classifyTx(tx([settled(DUEL)], SETTLER, "sig-settle", 1_789_000_600))!;

    const rows = rowsFromEvents([settle, accepted, started, created], d);
    expect(rows.map((r) => r.label)).to.deep.equal(["Called", "Taken", "Start prices posted", "Settled"]);
    expect(rows.map((r) => r.signer)).to.deep.equal([
      CREATOR.toBase58(),
      OPPONENT.toBase58(),
      SETTLER.toBase58(),
      SETTLER.toBase58(),
    ]);
    expect(rows[3].spectator).to.equal(true);
    expect(rows[2].spectator).to.equal(false);

    // A fighter who settles it themselves is no spectator.
    const own = classifyTx(tx([settled(DUEL)], OPPONENT, "sig-own", 1_789_000_600))!;
    expect(rowsFromEvents([own], d)[0].spectator).to.equal(false);

    // The settler's own fee wallets are the settler, not a spectator.
    for (const key of SETTLER_WALLETS) {
      const bySettler = classifyTx(tx([settled(DUEL)], new PublicKey(key), `sig-settler-${key}`, 1_789_000_700))!;
      const row = rowsFromEvents([bySettler], d)[0];
      expect([row.settler, row.spectator], key).to.deep.equal([true, false]);
    }
    expect(rows[3].settler).to.equal(false);
  });

  it("falls back to the account's own timestamps, with no signer it cannot prove", () => {
    const rows = rowsFromAccount({
      creator: CREATOR,
      opponent: OPPONENT,
      createdTs: 100,
      acceptedTs: 200,
      startTs: 260,
      endTs: 620,
      creatorEnd: { price: BigInt(5), expo: -8, publishTime: 621 },
    });
    expect(rows.map((r) => [r.label, r.at, r.signer, r.signature])).to.deep.equal([
      ["Called", 100, CREATOR.toBase58(), null],
      ["Taken", 200, OPPONENT.toBase58(), null],
      ["Start prices posted", 260, null, null],
      ["Bell", 620, null, null],
    ]);
  });

  it("carries each transaction's fee and slot, and says when a fee was shared with other fights", () => {
    const base = tx([settled(DUEL)], SETTLER, "sig-settle", 1_789_000_600);
    const one: TxLike = { ...base, slot: 412_345_678, meta: { ...base.meta!, fee: 5_000 } };
    const e = classifyTx(one, DUEL.toBase58())!;
    expect(e.fee).to.equal(5_000);
    expect(e.slot).to.equal(412_345_678);
    expect(e.sharedWith).to.equal(0);

    const both = tx([settled(OTHER_DUEL), settled(DUEL)], SETTLER, "sig-batch");
    const batch: TxLike = { ...both, slot: 7, meta: { ...both.meta!, fee: 10_000 } };
    expect(classifyTx(batch, DUEL.toBase58())!.sharedWith).to.equal(1);

    // A node that leaves the fee out gives no fee, never a guessed one.
    const bare = classifyTx(tx([settled(DUEL)], SETTLER, "sig-bare"), DUEL.toBase58())!;
    expect(bare.fee).to.equal(null);
    expect(bare.slot).to.equal(null);

    const rows = rowsFromEvents([e], { creator: CREATOR, opponent: OPPONENT });
    expect([rows[0].fee, rows[0].slot, rows[0].sharedWith]).to.deep.equal([5_000, 412_345_678, 0]);
  });

  it("totals only the fees the node reported, once per transaction, and times the settle from the bell", () => {
    const row = (step: ReceiptRow["step"], signature: string | null, fee: number | null, at = 0): ReceiptRow => ({
      step,
      label: step,
      at,
      signer: null,
      signature,
      spectator: false,
      settler: false,
      fee,
      slot: null,
      sharedWith: 0,
    });
    const rows = [row("called", "a", 5_000), row("taken", "b", 5_000), row("started", "c", 10_000), row("settled", "d", 5_000, 1_000_064)];
    expect(feeTotal(rows)).to.deep.equal({ lamports: 25_000, counted: 4, steps: 4, shared: false });
    expect(solFromLamports(25_000)).to.equal("0.000025");

    const gap = [row("called", "a", 5_000), row("taken", "b", null)];
    expect(feeTotal(gap)).to.deep.equal({ lamports: 5_000, counted: 1, steps: 2, shared: false });
    expect(feeTotal(rowsFromAccount({ creator: CREATOR, opponent: OPPONENT, createdTs: 1, acceptedTs: 0, startTs: 0, endTs: 0, creatorEnd: { price: BigInt(0), expo: 0, publishTime: 0 } }))).to.equal(null);

    expect(settledAfterBell(rows, 1_000_000)).to.equal(64);
    expect(settledAfterBell(rows.slice(0, 3), 1_000_000)).to.equal(null);
    expect(waitWords(64)).to.equal("1 min 4 s");
    expect(waitWords(21)).to.equal("21 s");
  });

  it("stamps a price's moment to the second on New York's clock", () => {
    // Saturday 12 September 2026, 4:21:00 PM EDT is 20:21:00 UTC.
    expect(etStamp(Date.UTC(2026, 8, 12, 20, 21, 0) / 1000)).to.equal("Sat, Sep 12, 4:21:00 PM ET");
    expect(etStamp(Date.UTC(2026, 8, 14, 13, 30, 5) / 1000)).to.equal("Mon, Sep 14, 9:30:05 AM ET");
  });
});
