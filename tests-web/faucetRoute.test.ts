/* The faucet's refusals. It hands out free SOL and test shares to anyone, which
 * makes every "no" it says part of how long it lasts through judging week:
 * a bad request, a wallet hammering it, one address minting wallet after
 * wallet, a page that is not ours asking.
 *
 * NOTHING HERE CAN MINT. The route is given a key that is not a key, so the
 * furthest any request gets is "FAUCET_SECRET_KEY is not a 64-number JSON
 * array", which is itself a refusal worth pinning: a mistyped environment
 * variable must say what is wrong, not answer with an empty 500. That refusal
 * comes after every fence, so reaching it proves a request passed them. */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";

type Post = (req: NextRequest) => Promise<Response>;

const wallet = () => Keypair.generate().publicKey.toBase58();
const post = (POST: Post, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("https://stonkwars.test/api/faucet", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", host: "stonkwars.test", ...headers },
    }),
  );
const errorOf = async (r: Response) => ((await r.json()) as { error?: string }).error ?? "";

describe("the faucet's refusals", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { key: env.FAUCET_SECRET_KEY, node: env.NODE_ENV };
  let POST: Post;

  before(async () => {
    env.FAUCET_SECRET_KEY = "this is not a key";
    POST = (await import("../src/app/api/faucet/route")).POST as Post;
  });
  after(() => {
    env.FAUCET_SECRET_KEY = saved.key;
    env.NODE_ENV = saved.node;
  });
  afterEach(() => {
    env.NODE_ENV = saved.node;
  });

  it("refuses a body that is not a wallet, and stocks that cannot be staked", async () => {
    expect((await post(POST, "not json")).status).to.equal(400);
    expect((await post(POST, { wallet: "not-an-address" })).status).to.equal(400);
    const r = await post(POST, { wallet: wallet(), tickers: ["OPENAI", "NOPE"] });
    expect(r.status).to.equal(400);
    expect(await errorOf(r)).to.match(/None of those stocks can be staked/);
  });

  it("says what is wrong with a mistyped key instead of answering with an empty 500", async () => {
    const r = await post(POST, { wallet: wallet() }, { "x-real-ip": "10.0.0.1" });
    expect(r.status).to.equal(503);
    const why = await errorOf(r);
    expect(why).to.match(/FAUCET_SECRET_KEY is not a 64-number JSON array/);
    expect(why).to.not.contain("this is not a key", "the value itself is never echoed");
  });

  it("stops one wallet hammering it", async () => {
    const w = wallet();
    const ip = { "x-real-ip": "10.0.0.2" };
    expect((await post(POST, { wallet: w }, ip)).status).to.equal(503);
    const again = await post(POST, { wallet: w }, ip);
    expect(again.status).to.equal(429);
    expect(await errorOf(again)).to.match(/few seconds/);
  });

  it("stops one address minting wallet after wallet, and leaves every other address alone", async () => {
    const ip = { "x-real-ip": "10.0.0.3" };
    for (let i = 0; i < 8; i++) {
      expect((await post(POST, { wallet: wallet() }, ip)).status, `wallet ${i + 1} of 8`).to.equal(503);
    }
    const ninth = await post(POST, { wallet: wallet() }, ip);
    expect(ninth.status).to.equal(429);
    expect(await errorOf(ninth)).to.match(/new wallets from one place/);
    expect((await post(POST, { wallet: wallet() }, { "x-real-ip": "10.0.0.4" })).status).to.equal(503);
  });

  it("in production, answers the site's own pages and nobody else", async () => {
    env.NODE_ENV = "production";
    const ip = { "x-real-ip": "10.0.0.5" };
    const none = await post(POST, { wallet: wallet() }, ip);
    expect(none.status).to.equal(403);
    expect(await errorOf(none)).to.match(/own pages only/);
    expect((await post(POST, { wallet: wallet() }, { ...ip, origin: "https://evil.example" })).status).to.equal(403);
    expect((await post(POST, { wallet: wallet() }, { ...ip, origin: "https://stonkwars.test" })).status).to.equal(503);
  });
});
