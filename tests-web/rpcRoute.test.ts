/* The RPC relay when the paid node refuses.
 *
 * Written the afternoon a provider carried every cheap call and refused
 * getProgramAccounts alone, so the node read as healthy while the site could
 * not list a single fight. The relay must treat a refusal as ours to handle,
 * not as an answer to hand the browser, and it must keep passing the chain's
 * own errors through untouched or web3.js stops being able to read them.
 *
 * No network: fetch is stubbed and the two upstreams are told apart by URL. */

import { expect } from "chai";
import { NextRequest } from "next/server";

type Post = (req: NextRequest) => Promise<Response>;

const PROGRAM = "Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D";
const PAID = "https://paid.example/?api-key=SECRET";
const PUBLIC = "https://api.devnet.solana.com";

const rpc = (POST: Post, method: string, id = 1) =>
  POST(
    new NextRequest("https://stonkwars.test/api/rpc", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: [PROGRAM, { encoding: "base64" }] }),
      headers: { "content-type": "application/json", host: "stonkwars.test" },
    }),
  );

/** Which upstreams were called, in order. */
let called: string[] = [];

function stubFetch(reply: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    called.push(url);
    const { status, body } = reply(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("the RPC relay when the paid node refuses", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { rpc: env.RPC_URL, cluster: env.NEXT_PUBLIC_CLUSTER };
  const realFetch = globalThis.fetch;
  let POST: Post;

  before(async () => {
    env.RPC_URL = PAID;
    env.NEXT_PUBLIC_CLUSTER = "devnet";
    POST = (await import("../src/app/api/rpc/route")).POST as Post;
  });
  after(() => {
    env.RPC_URL = saved.rpc;
    env.NEXT_PUBLIC_CLUSTER = saved.cluster;
    globalThis.fetch = realFetch;
  });
  beforeEach(() => {
    called = [];
  });

  it("carries the paid node's answer when it answers", async () => {
    stubFetch(() => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result: ["one"] } }));
    const res = await rpc(POST, "getSlot");
    expect(res.status).to.equal(200);
    expect(called).to.have.length(1);
    expect(called[0]).to.equal(PAID);
  });

  it("goes to the public node when the paid one refuses, and never shows the browser the refusal", async () => {
    stubFetch((url) =>
      url === PAID
        ? { status: 401, body: { jsonrpc: "2.0", error: { code: -32401, message: "Unauthorized" } } }
        : { status: 200, body: { jsonrpc: "2.0", id: 1, result: ["a", "b"] } },
    );
    const res = await rpc(POST, "getProgramAccounts");
    expect(res.status).to.equal(200, "a refusal upstream is not the browser's problem");
    expect((await res.json()).result).to.deep.equal(["a", "b"]);
    expect(called).to.deep.equal([PAID, PUBLIC]);
  });

  it("remembers the refused method, so the next call skips the paid node entirely", async () => {
    stubFetch((url) =>
      url === PAID
        ? { status: 401, body: { error: "Unauthorized" } }
        : { status: 200, body: { jsonrpc: "2.0", id: 2, result: [] } },
    );
    await rpc(POST, "getProgramAccounts");
    called = [];
    const res = await rpc(POST, "getProgramAccounts", 2);
    expect(res.status).to.equal(200);
    expect(called).to.deep.equal([PUBLIC], "no wasted round trip to a node that already said no");
  });

  it("keeps sending other methods to the paid node", async () => {
    stubFetch((url) =>
      url === PAID
        ? { status: 200, body: { jsonrpc: "2.0", id: 3, result: 123 } }
        : { status: 200, body: { jsonrpc: "2.0", id: 3, result: 999 } },
    );
    const res = await rpc(POST, "getBalance", 3);
    expect((await res.json()).result).to.equal(123);
    expect(called).to.deep.equal([PAID], "one refused method does not condemn the rest");
  });

  it("passes a real chain error through untouched, because web3.js reads those", async () => {
    stubFetch(() => ({
      status: 200,
      body: { jsonrpc: "2.0", id: 4, error: { code: -32602, message: "Invalid param" } },
    }));
    const res = await rpc(POST, "getAccountInfo", 4);
    expect(res.status).to.equal(200);
    expect((await res.json()).error.code).to.equal(-32602);
    expect(called).to.deep.equal([PAID], "an answer from the chain is not a refusal");
  });

  it("falls back when the paid node breaks rather than refusing", async () => {
    stubFetch((url) => {
      if (url === PAID) throw new Error("ECONNRESET");
      return { status: 200, body: { jsonrpc: "2.0", id: 5, result: "ok" } };
    });
    const res = await rpc(POST, "getVersion", 5);
    expect(res.status).to.equal(200);
    expect((await res.json()).result).to.equal("ok");
  });
});
