/* How long confirmation waits, and what it says when it stops.
 *
 * A server pass cannot wait out a blockhash, so it passes a deadline. Reaching
 * the deadline must still look through history before giving up, exactly as an
 * expiry does, because a transaction nobody saw confirm may well have landed.
 * The browser passes nothing and keeps waiting for the blockhash. Every
 * Connection here is a stub; nothing is sent anywhere. */

import { expect } from "chai";
import type { Connection } from "@solana/web3.js";

import { confirmSignature, NotSeen, TransactionFailed } from "../src/lib/confirm";

type Status = { err: unknown; confirmationStatus?: string } | null;

/** A chain that reports `status` for the signature until told otherwise, at a
 *  fixed height, and `history` when asked through history. */
function stubChain(opts: { status?: () => Status; height?: () => number; history?: Status }) {
  const asked = { statuses: 0, history: 0 };
  const conn = {
    getSignatureStatuses: async () => {
      asked.statuses++;
      return { context: { slot: 1 }, value: [opts.status?.() ?? null] };
    },
    getBlockHeight: async () => opts.height?.() ?? 100,
    getSignatureStatus: async () => {
      asked.history++;
      return { context: { slot: 1 }, value: opts.history ?? null };
    },
  } as unknown as Connection;
  return { conn, asked };
}

const latest = { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1_000 };

describe("confirmSignature", () => {
  it("returns as soon as the signature is confirmed", async () => {
    const { conn } = stubChain({ status: () => ({ err: null, confirmationStatus: "confirmed" }) });
    expect(await confirmSignature(conn, "sig", latest, { deadlineMs: Date.now() + 5_000 })).to.equal("sig");
  });

  it("throws TransactionFailed for a transaction the chain rejected", async () => {
    const { conn } = stubChain({ status: () => ({ err: { InstructionError: [0, "Custom"] } }) });
    let caught: unknown;
    await confirmSignature(conn, "sig", latest).catch((e) => (caught = e));
    expect(caught).to.be.instanceOf(TransactionFailed);
  });

  it("stops at the deadline, looks through history once, then throws NotSeen", async function () {
    // This chain never confirms and its blockhash never expires: only the
    // deadline can end the wait.
    this.timeout(5_000);
    const { conn, asked } = stubChain({});
    const t0 = performance.now();
    let caught: unknown;
    await confirmSignature(conn, "sig", latest, { deadlineMs: Date.now() + 900 }).catch((e) => (caught = e));
    const ms = performance.now() - t0;
    expect(caught).to.be.instanceOf(NotSeen);
    expect((caught as NotSeen).signature).to.equal("sig");
    expect((caught as Error).message).to.match(/deadline/);
    expect(asked.history).to.equal(1);
    /* It polled while it waited, and stopped near the deadline. The deadline
     * is a wall-clock timestamp, which the machine may step, so the bound
     * allows for that rather than for a whole extra poll. */
    expect(asked.statuses).to.be.greaterThan(1);
    expect(ms).to.be.within(500, 2_500);
  });

  it("reports a transaction that landed by the deadline's history check as landed", async () => {
    const { conn, asked } = stubChain({ history: { err: null, confirmationStatus: "finalized" } });
    expect(await confirmSignature(conn, "sig", latest, { deadlineMs: Date.now() - 1 })).to.equal("sig");
    expect(asked.history).to.equal(1);
  });

  it("without a deadline, waits for the blockhash to expire as before", async function () {
    this.timeout(3_000);
    let height = 999;
    const { conn, asked } = stubChain({ height: () => height++ });
    let caught: unknown;
    await confirmSignature(conn, "sig", latest).catch((e) => (caught = e));
    expect(caught).to.be.instanceOf(NotSeen);
    expect((caught as Error).message).to.match(/blockhash expired/);
    expect(asked.history).to.equal(1);
  });
});
