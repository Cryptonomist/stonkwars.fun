/* The nudge gate's promises: one visitor cannot hammer it, a crowd watching
 * one fight gets one run between them, answers are reused for as long as they
 * stay true, one instance attempts at most 30 cranks a minute, and nothing
 * secret leaves in an answer.
 *
 * Every clock here is a number the test moves; nothing waits in real time. */

import { expect } from "chai";

import { clientIp, NudgeGate, Recent, redact, REUSE_MS, sameSite } from "../src/lib/nudgeGate.server";
import type { NudgeState } from "../src/lib/nudgeSchedule";

type A = { state: NudgeState; n?: number };

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms: number) => (c.t += ms) };
  return c;
}

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

describe("nudge gate", () => {
  describe("per-IP bucket", () => {
    it("lets a burst of 10 through at once and refuses the 11th", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      for (let i = 0; i < 10; i++) expect(gate.admit("1.2.3.4").ok, `request ${i + 1}`).to.equal(true);
      const refused = gate.admit("1.2.3.4");
      expect(refused.ok).to.equal(false);
      expect(refused.ok ? 0 : refused.retryAfterSecs).to.equal(3);
    });

    it("refills at 20 a minute, one every three seconds", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      for (let i = 0; i < 10; i++) gate.admit("ip");
      c.advance(2_999);
      expect(gate.admit("ip").ok).to.equal(false);
      c.advance(1);
      expect(gate.admit("ip").ok).to.equal(true);
      expect(gate.admit("ip").ok).to.equal(false);
    });

    it("lets through the burst plus 20 over a minute of asking every second, and no more", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      let allowed = 0;
      for (let s = 0; s < 60; s++) {
        if (gate.admit("ip").ok) allowed++;
        c.advance(1_000);
      }
      // The burst, plus a token every three seconds; the last may land just as the minute ends.
      expect(allowed).to.be.within(10 + 20 - 1, 10 + 20);
    });

    it("keeps each IP's bucket its own", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      for (let i = 0; i < 10; i++) gate.admit("a");
      expect(gate.admit("a").ok).to.equal(false);
      expect(gate.admit("b").ok).to.equal(true);
    });

    it("forgets old buckets beyond its key limit instead of growing without end", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now, maxKeys: 100 });
      for (let i = 0; i < 1_000; i++) gate.admit(`ip-${i}`);
      const size = (gate as unknown as { buckets: Map<string, unknown> }).buckets.size;
      expect(size).to.be.at.most(100);
    });
  });

  describe("one run per duel", () => {
    it("turns 50 concurrent calls into one run, and gives all 50 its answer", async () => {
      const c = clock();
      const gate = new NudgeGate<A>({ now: c.now });
      let runs = 0;
      let release!: () => void;
      const gateOpen = new Promise<void>((r) => (release = r));
      const work = async (): Promise<A> => {
        runs++;
        await gateOpen;
        return { state: "sent", n: runs };
      };
      const calls = Array.from({ length: 50 }, () => gate.run("duel", work));
      release();
      const answers = await Promise.all(calls);
      expect(runs).to.equal(1);
      expect(answers.every((a) => a.state === "sent" && a.n === 1)).to.equal(true);
    });

    it("runs different duels separately", async () => {
      const gate = new NudgeGate<A>();
      let runs = 0;
      const work = async (): Promise<A> => ({ state: "not-yet", n: ++runs });
      await Promise.all([gate.run("a", work), gate.run("b", work)]);
      expect(runs).to.equal(2);
    });

    it("reuses a not-yet or nothing-due answer for 3 seconds, then asks again", async () => {
      for (const state of ["not-yet", "nothing-due"] as const) {
        const c = clock();
        const gate = new NudgeGate<A>({ now: c.now });
        let runs = 0;
        const work = async (): Promise<A> => ({ state, n: ++runs });
        await gate.run("duel", work);
        c.advance(2_999);
        expect((await gate.run("duel", work)).n, state).to.equal(1);
        c.advance(1);
        expect((await gate.run("duel", work)).n, state).to.equal(2);
      }
    });

    it("makes no new attempt for 20 seconds after a send", async () => {
      const c = clock();
      const gate = new NudgeGate<A>({ now: c.now });
      let runs = 0;
      const work = async (): Promise<A> => ({ state: runs++ === 0 ? "sent" : "done", n: runs });
      expect((await gate.run("duel", work)).state).to.equal("sent");
      for (const ms of [1_000, 5_000, 10_000, 3_999]) {
        c.advance(ms);
        expect((await gate.run("duel", work)).state).to.equal("sent");
      }
      expect(runs).to.equal(1);
      c.advance(1);
      expect((await gate.run("duel", work)).state).to.equal("done");
      expect(runs).to.equal(2);
    });

    it("keeps a failure for as long as it tells the page to wait, and a stranger's address for a minute", async () => {
      expect(REUSE_MS.failed).to.equal(10_000);
      expect(REUSE_MS["not-found"]).to.equal(60_000);
      const c = clock();
      const gate = new NudgeGate<A>({ now: c.now });
      let runs = 0;
      const work = async (): Promise<A> => ({ state: "not-found", n: ++runs });
      await gate.run("nobody", work);
      c.advance(59_999);
      await gate.run("nobody", work);
      expect(runs).to.equal(1);
      c.advance(1);
      await gate.run("nobody", work);
      expect(runs).to.equal(2);
    });

    it("remembers nothing from a run that throws, and lets the next caller start afresh", async () => {
      const gate = new NudgeGate<A>();
      let runs = 0;
      const boom = async (): Promise<A> => {
        runs++;
        throw new Error("rpc down");
      };
      const both = await Promise.allSettled([gate.run("duel", boom), gate.run("duel", boom)]);
      expect(both.map((r) => r.status)).to.deep.equal(["rejected", "rejected"]);
      expect(runs).to.equal(1);
      const ok = await gate.run("duel", async () => ({ state: "done" }));
      expect(ok.state).to.equal("done");
    });
  });

  describe("per-instance send budget", () => {
    it("allows 30 crank attempts in a minute and refuses the 31st", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      for (let i = 0; i < 30; i++) {
        expect(gate.takeSend(), `send ${i + 1}`).to.equal(true);
        c.advance(100);
      }
      expect(gate.takeSend()).to.equal(false);
    });

    it("gives back an attempt that sent nothing", () => {
      const gate = new NudgeGate({ now: () => 0 });
      for (let i = 0; i < 30; i++) gate.takeSend();
      expect(gate.takeSend()).to.equal(false);
      gate.returnSend();
      expect(gate.takeSend()).to.equal(true);
    });

    it("slides: an attempt a minute old no longer counts", () => {
      const c = clock();
      const gate = new NudgeGate({ now: c.now });
      gate.takeSend();
      c.advance(30_000);
      for (let i = 0; i < 29; i++) gate.takeSend();
      expect(gate.takeSend()).to.equal(false);
      c.advance(30_000);
      expect(gate.takeSend()).to.equal(true);
      expect(gate.takeSend()).to.equal(false);
    });
  });

  describe("recent reads", () => {
    it("shares a read in flight and keeps it for its TTL", async () => {
      const c = clock();
      const recent = new Recent<number>(2_000, c.now);
      let loads = 0;
      const load = async () => ++loads;
      const [a, b] = await Promise.all([recent.get("k", load), recent.get("k", load)]);
      expect([a, b, loads]).to.deep.equal([1, 1, 1]);
      c.advance(1_999);
      expect(await recent.get("k", load)).to.equal(1);
      c.advance(1);
      expect(await recent.get("k", load)).to.equal(2);
    });

    it("does not remember a failed read", async () => {
      const recent = new Recent<number>(2_000, () => 0);
      await recent.get("k", () => Promise.reject(new Error("429"))).catch(() => undefined);
      await new Promise((r) => setImmediate(r));
      expect(await recent.get("k", async () => 7)).to.equal(7);
    });
  });

  describe("requests", () => {
    it("accepts this site's pages and same-origin requests, and refuses other sites", () => {
      expect(sameSite(null, "stonkwars.fun")).to.equal(true);
      expect(sameSite("https://stonkwars.fun", "stonkwars.fun")).to.equal(true);
      expect(sameSite("https://evil.example", "stonkwars.fun")).to.equal(false);
      expect(sameSite("not a url", "stonkwars.fun")).to.equal(false);
    });

    it("reads the platform's client address, and shares one bucket among the unidentified", () => {
      expect(clientIp(headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).to.equal("9.9.9.9");
      expect(clientIp(headers({ "x-forwarded-for": " 1.1.1.1 , 10.0.0.1" }))).to.equal("1.1.1.1");
      expect(clientIp(headers({}))).to.equal("unknown");
    });

    it("cuts every secret and key-shaped query string out of an answer, and keeps it short", () => {
      const rpc = "https://devnet.helius-rpc.com/?api-key=abcdef123456";
      const text = `request to ${rpc} failed; also https://hermes.example/v2?access_token=zzz999 and PYTHKEY-0123456789`;
      const out = redact(text, [rpc, "PYTHKEY-0123456789", undefined, ""]);
      expect(out).to.not.include("abcdef123456");
      expect(out).to.not.include("zzz999");
      expect(out).to.not.include("PYTHKEY-0123456789");
      expect(redact("x".repeat(1_000), []).length).to.equal(300);
    });
  });
});
