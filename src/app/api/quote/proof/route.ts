import { NextResponse, type NextRequest } from "next/server";

import { COMPOSITE_V2_RULE } from "@/lib/composite";
import { clientIp } from "@/lib/nudgeGate.server";
import { answerAt, sourceAt, TooOld, type Answer } from "@/lib/oracle";
import { answerReuseMs, Busy, QuoteGate } from "@/lib/quoteGate.server";
import { byFeed, quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** Nine venues and the exchange, each given five seconds. */
export const maxDuration = 60;

/* THE COMPOSITE'S PROOF FOR A STOCK AT A BOUNDARY, SIGNED BY NOBODY.
 *
 *   GET ?feed=<64 hex>&boundary=<unix seconds>
 *     -> { rule, feed, ticker, boundary, source, price, expo, publishTime,
 *          tier, wait, retryAt, parkedUntil, proof, sha256 }
 *
 * The same computation /api/quote signs from, for anyone checking a fight's
 * price or the rule itself, with no fight needed and nothing signed. Every
 * request in the proof is a public, unauthenticated venue URL (or Hyperliquid's
 * POST body) that anyone can make again; the sha256 is of the proof's
 * canonical JSON (composite.ts canonicalJson), so two people who recompute it
 * compare one line.
 *
 * WHAT A CALLER CAN MAKE THIS SERVER FETCH. Nothing it names. The feed must be
 * a roster stock pinned in src/data/venues247.json, and the boundary one the
 * composite prices (shut exchange, at or after COMPOSITE_FROM, already past);
 * every URL is built from the pins and the minute, never from the query. The
 * rest is lib/quoteGate.server.ts: a bucket per IP, one computation per
 * (feed, boundary) with the answer kept, and a cap on prices worked out at
 * once. */

const gate = new QuoteGate<Answer>({ reuseMs: (a) => answerReuseMs(a, Date.now()) });

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
  const boundaryParam = params.get("boundary") ?? "";
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(feedParam) || !/^\d{1,11}$/.test(boundaryParam)) {
    return NextResponse.json({ error: "Pass ?feed=<64 hex characters>&boundary=<unix seconds>" }, { status: 400, headers: noStore });
  }
  const feed = feedParam.replace(/^0x/, "").toLowerCase();
  const boundary = Number(boundaryParam);

  const stock = byFeed(feed);
  const market = quoteSymbolFor(feed);
  if (!stock || !market?.composite) {
    return NextResponse.json({ error: "No stock priced by the composite has that feed." }, { status: 404, headers: noStore });
  }
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
