/* The quote routes' manners (lib/quoteGate.server.ts): a stranger asking the
 * public quote and proof routes for a crowd of boundaries gets a bounded
 * amount of this server's work, and a crowd asking for one boundary gets one
 * computation between them. The clock is injected, so nothing here waits for
 * a limit to pass. */

import { expect } from "chai";

import { SOURCE_PYTH, SOURCE_SIGNED, START_DELAY_SECS } from "../src/lib/duel";
import {
  answerReuseMs,
  Busy,
  FINAL_REUSE_MS,
  PROOF_BURST,
  PROOF_PER_IP_PER_MINUTE,
  proofTarget,
  QuoteGate,
  WAIT_REUSE_MS,
} from "../src/lib/quoteGate.server";

type A = { quote: string | null; parkedUntil: number | null };

describe("quote gate", () => {
  let t = 1_000_000;
  const now = () => t;
  const gate = (over: Partial<ConstructorParameters<typeof QuoteGate<A>>[0]> = {}) =>
    new QuoteGate<A>({ now, reuseMs: (a) => answerReuseMs(a, t), ...over });

  it("lets an IP burst to 10, then refills at 30 a minute", () => {
    const g = gate();
    for (let i = 0; i < 10; i++) expect(g.admit("1.2.3.4").ok).to.equal(true);
    expect(g.admit("1.2.3.4")).to.deep.equal({ ok: false, retryAfterSecs: 2 });
    expect(g.admit("5.6.7.8").ok).to.equal(true);
    t += 2_000;
    expect(g.admit("1.2.3.4").ok).to.equal(true);
  });

  it("computes a (feed, boundary) once for everyone asking at the same time, and keeps a final answer", async () => {
    const g = gate();
    let runs = 0;
    let release!: () => void;
    const work = () =>
      new Promise<A>((resolve) => {
        runs++;
        release = () => resolve({ quote: "3598800", parkedUntil: null });
      });
    const asks = [g.run("f:1", work), g.run("f:1", work), g.run("f:1", work)];
    await Promise.resolve();
    release();
    const answers = await Promise.all(asks);
    expect(runs).to.equal(1);
    expect(new Set(answers).size).to.equal(1);

    t += FINAL_REUSE_MS - 1;
    await g.run("f:1", work);
    expect(runs).to.equal(1);
    t += 1;
    const again = g.run("f:1", work);
    release();
    await again;
    expect(runs).to.equal(2);
  });

  it("keeps a wait for seconds, and an exchange fallback until the exchange can price it", async () => {
    expect(answerReuseMs({ quote: null, parkedUntil: null }, t)).to.equal(WAIT_REUSE_MS);
    expect(answerReuseMs({ quote: "1", parkedUntil: null }, t)).to.equal(FINAL_REUSE_MS);
    expect(answerReuseMs({ quote: null, parkedUntil: t / 1000 + 600 }, t)).to.equal(600_000);
    expect(answerReuseMs({ quote: null, parkedUntil: t / 1000 + 86_400 }, t)).to.equal(FINAL_REUSE_MS);
    expect(answerReuseMs({ quote: null, parkedUntil: t / 1000 - 5 }, t)).to.equal(WAIT_REUSE_MS);

    const g = gate();
    let runs = 0;
    const waiting = async () => {
      runs++;
      return { quote: null, parkedUntil: null };
    };
    await g.run("f:2", waiting);
    await g.run("f:2", waiting);
    t += WAIT_REUSE_MS;
    await g.run("f:2", waiting);
    expect(runs).to.equal(2);
  });

  it("works out at most 2 prices at once, queues 8, and turns the rest away before they fetch anything", async () => {
    const g = gate();
    let running = 0;
    let most = 0;
    let started = 0;
    const releases: (() => void)[] = [];
    const work = () =>
      new Promise<A>((resolve) => {
        started++;
        running++;
        most = Math.max(most, running);
        releases.push(() => {
          running--;
          resolve({ quote: "1", parkedUntil: null });
        });
      });
    const asks = Array.from({ length: 10 }, (_, i) => g.run(`f:${100 + i}`, work));
    let refused: unknown;
    try {
      await g.run("f:999", work);
    } catch (e) {
      refused = e;
    }
    expect(refused).to.be.instanceOf(Busy);
    await Promise.resolve();
    expect(started).to.equal(2);

    // Each finished computation hands its slot to the next in line.
    while (releases.length) {
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(asks);
    expect(started).to.equal(10);
    expect(most).to.equal(2);
  });

  it("forgets a computation that threw, so the next caller starts afresh", async () => {
    const g = gate();
    let runs = 0;
    const failing = async (): Promise<A> => {
      runs++;
      throw new Error("venue down");
    };
    for (let i = 0; i < 2; i++) {
      try {
        await g.run("f:3", failing);
      } catch {
        // expected
      }
    }
    expect(runs).to.equal(2);
  });

  /* The proof route recomputes only a real fight's own boundaries, for a side
   * the oracle signs, and on a smaller budget than the quote route. */
  it("lets the proof route ask only for a signed side of a fight at its start or settle", () => {
    const d = {
      acceptedTs: 1_789_900_000,
      endTs: 1_789_943_202,
      creatorFeed: "aa".repeat(32),
      opponentFeed: "bb".repeat(32),
      creatorSource: SOURCE_SIGNED,
      opponentSource: SOURCE_PYTH,
    };
    expect(proofTarget(d, "start", `0x${"AA".repeat(32)}`)).to.deep.equal({ boundary: d.acceptedTs + START_DELAY_SECS });
    expect(proofTarget(d, "settle", "aa".repeat(32))).to.deep.equal({ boundary: d.endTs });
    expect(proofTarget(d, "start", "bb".repeat(32))).to.deep.equal({ refused: "That side of this fight is priced by Pyth, not the oracle." });
    expect(proofTarget(d, "start", "cc".repeat(32))).to.deep.equal({ refused: "That feed is not a side of this fight." });
    expect(proofTarget({ ...d, endTs: 0 }, "settle", "aa".repeat(32))).to.deep.equal({ refused: "This fight has no settle boundary yet." });

    const g = gate({ perMinute: PROOF_PER_IP_PER_MINUTE, burst: PROOF_BURST });
    for (let i = 0; i < PROOF_BURST; i++) expect(g.admit("9.9.9.9").ok).to.equal(true);
    expect(g.admit("9.9.9.9").ok).to.equal(false);
    expect([PROOF_PER_IP_PER_MINUTE, PROOF_BURST]).to.deep.equal([12, 4]);
  });
});
