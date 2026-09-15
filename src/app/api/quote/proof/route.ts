import { NextResponse, type NextRequest } from "next/server";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";

import { COMPOSITE_V2_RULE } from "@/lib/composite";
import { decodeDuel, PROGRAM_ID } from "@/lib/duel";
import { clientIp, Recent } from "@/lib/nudgeGate.server";
import { answerAt, sourceAt, TooOld, type Answer } from "@/lib/oracle";
import { answerReuseMs, Busy, PROOF_BURST, PROOF_PER_IP_PER_MINUTE, proofTarget, QuoteGate } from "@/lib/quoteGate.server";
import { byFeed, quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** Nine venues and the exchange, each given five seconds. */
export const maxDuration = 60;

/* THE COMPOSITE'S PROOF FOR ONE SIDE OF A FIGHT, SIGNED BY NOBODY.
 *
 *   GET ?duel=<address>&which=start|settle&feed=<64 hex>
 *     -> { rule, feed, ticker, boundary, source, price, expo, publishTime,
 *          tier, wait, retryAt, parkedUntil, proof, sha256 }
 *
 * The same computation /api/quote signs from, for anyone checking a fight's
 * price, with nothing signed. Every request in the proof is a public,
 * unauthenticated venue URL (or Hyperliquid's POST body) that anyone can make
 * again; the sha256 is of the proof's canonical JSON (composite.ts
 * canonicalJson), so two people who recompute it compare one line.
 *
 * WHAT A CALLER CAN MAKE THIS SERVER FETCH. Only a real fight's own boundary.
 * This used to take any feed and any past boundary, and a new minute costs up
 * to nine venue requests and a download from the exchange's data source: two
 * strangers walking minutes could spend Hyperliquid's per-IP budget, and every
 * real fight waiting on Hyperliquid would wait on them. Now the duel must be
 * this program's, the feed one of its sides the oracle signs, and the boundary
 * its start or its settle (quoteGate.server.ts, proofTarget), priced by the
 * composite; every URL is built from the pins and the minute, never from the
 * query. The rest is lib/quoteGate.server.ts: a smaller bucket per IP than the
 * quote route's, one computation per (feed, boundary) with the answer kept,
 * and a cap on prices worked out at once. */

const gate = new QuoteGate<Answer>({
  reuseMs: (a) => answerReuseMs(a, Date.now()),
  perMinute: PROOF_PER_IP_PER_MINUTE,
  burst: PROOF_BURST,
});
const accounts = new Recent<AccountInfo<Buffer> | null>(5_000);

const noStore = { "cache-control": "no-store" };

export async function GET(req: NextRequest) {
  const admission = gate.admit(clientIp(req.headers));
  if (!admission.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { ...noStore, "retry-after": String(admission.retryAfterSecs) } },
    );
  }

  const params = req.nextUrl.searchParams;
  const feedParam = params.get("feed") ?? "";
  const which = params.get("which");
  let address: PublicKey | null = null;
  try {
    const duel = params.get("duel");
    if (duel) address = new PublicKey(duel);
  } catch {
    address = null;
  }
  if (!address || (which !== "start" && which !== "settle") || !/^(0x)?[0-9a-fA-F]{64}$/.test(feedParam)) {
    return NextResponse.json({ error: "Pass ?duel=<address>&which=start|settle&feed=<64 hex characters>" }, { status: 400, headers: noStore });
  }
  const feed = feedParam.replace(/^0x/, "").toLowerCase();

  const stock = byFeed(feed);
  const market = quoteSymbolFor(feed);
  if (!stock || !market?.composite) {
    return NextResponse.json({ error: "No stock priced by the composite has that feed." }, { status: 404, headers: noStore });
  }

  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  let account: AccountInfo<Buffer> | null;
  try {
    account = await accounts.get(address.toBase58(), () => conn.getAccountInfo(address));
  } catch {
    return NextResponse.json({ error: "Could not read the fight." }, { status: 502, headers: noStore });
  }
  if (!account || !account.owner.equals(PROGRAM_ID)) {
    return NextResponse.json({ error: "No fight at that address." }, { status: 404, headers: noStore });
  }
  let target: ReturnType<typeof proofTarget>;
  try {
    target = proofTarget(decodeDuel(address, account.data), which, feed);
  } catch {
    return NextResponse.json({ error: "No fight at that address." }, { status: 404, headers: noStore });
  }
  if ("refused" in target) return NextResponse.json({ error: target.refused }, { status: 422, headers: noStore });
  const { boundary } = target;

  const now = Math.floor(Date.now() / 1000);
  if (boundary > now) {
    return NextResponse.json({ error: "That boundary has not happened yet." }, { status: 425, headers: noStore });
  }
  const source = sourceAt(boundary, market);
  if (source !== "composite") {
    return NextResponse.json(
      { error: `${stock.ticker} at ${boundary} is priced by the ${source}, not the composite.`, source },
      { status: 422, headers: noStore },
    );
  }

  let answer: Answer;
  try {
    answer = await gate.run(`${feed}:${boundary}`, () => answerAt({ feed, ...market, boundary }));
  } catch (e) {
    if (e instanceof Busy) {
      return NextResponse.json({ error: e.message }, { status: 503, headers: { ...noStore, "retry-after": String(e.retryAfterSecs) } });
    }
    if (e instanceof TooOld) return NextResponse.json({ error: e.message }, { status: 410, headers: noStore });
    return NextResponse.json({ error: e instanceof Error ? e.message : "proof failed" }, { status: 502, headers: noStore });
  }

  const body = {
    rule: answer.proof?.rule ?? COMPOSITE_V2_RULE,
    feed,
    ticker: stock.ticker,
    boundary,
    source: answer.source,
    price: answer.quote ? answer.quote.price.toString() : null,
    expo: answer.quote?.expo ?? null,
    publishTime: answer.quote?.publishTime ?? null,
    tier: answer.tier,
    wait: answer.wait,
    retryAt: answer.retryAt,
    parkedUntil: answer.parkedUntil,
    proof: answer.proof,
    sha256: answer.sha256,
  };
  // A priced answer is history; anything else is still changing.
  if (answer.quote) return NextResponse.json(body, { headers: { "cache-control": "public, max-age=3600, immutable" } });
  return NextResponse.json(body, { status: answer.proof ? 200 : 425, headers: noStore });
}
