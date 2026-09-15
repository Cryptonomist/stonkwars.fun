/* The client's half of the platform fee: the same rate the program charges
 * (programs/duel/src/fee.rs), no fee accounts at all when the rate is zero, and
 * a settle that would not fit is sent without them rather than not sent. */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import { MAX_TX_BYTES, settleWithFee } from "../src/lib/crankTx";
import { feeAccountsFor, feeConfigPda, feeOn, feeRateFor, type DuelView, type FeeView } from "../src/lib/duel";

const NOW = 1_800_000_000;
const WEEK = 7 * 86_400;
const T2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const duel = (createdTs: number) =>
  ({
    createdTs,
    creatorMint: Keypair.generate().publicKey,
    opponentMint: Keypair.generate().publicKey,
    creatorTokenProgram: T2022,
    opponentTokenProgram: T2022,
  }) as unknown as DuelView;

const fee = (over: Partial<FeeView> = {}): FeeView => ({
  treasury: Keypair.generate().publicKey,
  feeBps: 250,
  priorBps: 0,
  fromTs: NOW + WEEK,
  ...over,
});

describe("platform fee (client)", () => {
  it("charges the rate a duel was created under, as the program does", () => {
    const f = fee();
    expect(feeRateFor(null, NOW)).to.equal(0);
    expect(feeRateFor(f, NOW)).to.equal(0, "during the notice");
    expect(feeRateFor(f, NOW + WEEK)).to.equal(250);
    expect(feeRateFor(fee({ feeBps: 100, priorBps: 300, fromTs: NOW }), NOW - 1)).to.equal(100, "a cut reaches older duels");
  });

  it("rounds a fee down", () => {
    expect(feeOn(7_200_000n, 250)).to.equal(180_000n);
    expect(feeOn(39n, 250)).to.equal(0n);
  });

  it("passes no fee accounts when the rate is zero, and three when it is not", () => {
    expect(feeAccountsFor(duel(NOW), fee())).to.deep.equal([]);
    expect(feeAccountsFor(duel(NOW), null)).to.deep.equal([]);
    const keys = feeAccountsFor(duel(NOW + WEEK), fee());
    expect(keys).to.have.length(3);
    expect(keys[0].pubkey.equals(feeConfigPda())).to.equal(true);
    expect(keys[0].isWritable).to.equal(false);
    expect(keys[1].isWritable && keys[2].isWritable).to.equal(true);
  });

  it("sends a settle without the fee rather than a settle that does not fit", () => {
    const d = duel(NOW + WEEK);
    const f = fee();
    const built: number[] = [];
    const fits = settleWithFee(d, f, (keys) => (built.push(keys.length), keys.length), () => MAX_TX_BYTES);
    expect(fits).to.equal(3);

    const tooBig = settleWithFee(d, f, (keys) => keys.length, (n) => (n ? MAX_TX_BYTES + 1 : 900));
    expect(tooBig).to.equal(0);

    const throws = settleWithFee(d, f, (keys) => keys.length, (n) => {
      if (n) throw new Error("Transaction too large");
      return 900;
    });
    expect(throws).to.equal(0);

    const zero = settleWithFee(duel(NOW), f, (keys) => keys.length, () => {
      throw new Error("never measured");
    });
    expect(zero).to.equal(0);
  });
});
