import { NextResponse, type NextRequest } from "next/server";

/* The chain, reached through this site.
 *
 * A paid RPC endpoint carries its key in the URL, so it can never be handed to
 * a browser: anything NEXT_PUBLIC_ is compiled into the page for anyone to
 * read. Instead the browser talks here, and this forwards the call to RPC_URL
 * with the key attached on the server. Visitors get the paid node; the key
 * stays on Vercel.
 *
 * This is a relay, not an open RPC. It carries only the methods the app
 * actually calls, only from this site's own pages, and only bodies small
 * enough to be one of ours. None of that is a wall — an Origin header is
 * whatever the caller says it is — but it keeps the endpoint from being a
 * free node somebody else builds on, and the method list means a stranger
 * cannot bill us for the expensive calls we never make.
 *
 * Subscriptions are deliberately absent: a serverless function cannot hold a
 * websocket. Nothing in the app needs one — see lib/confirm.ts. */

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Exactly what the app asks the chain for, and nothing else. */
const ALLOWED = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getSignatureStatuses",
  "getTransaction",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getVersion",
  "getEpochInfo",
  "getRecentPrioritizationFees",
]);

const MAX_BODY = 100_000;
const MAX_BATCH = 20;

type Call = { method?: unknown; id?: unknown };

const bad = (status: number, message: string) => NextResponse.json({ error: message }, { status });

/** Same-site only: a page of ours, or a same-origin fetch with no Origin at all. */
function fromThisSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const upstream = process.env.RPC_URL;
  if (!upstream) return bad(503, "RPC_URL is not set");
  if (!fromThisSite(req)) return bad(403, "This endpoint serves this site's pages.");

  const text = await req.text();
  if (text.length > MAX_BODY) return bad(413, "Request too large");

  let body: Call | Call[];
  try {
    body = JSON.parse(text) as Call | Call[];
  } catch {
    return bad(400, "Expected JSON-RPC");
  }

  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > MAX_BATCH) return bad(400, "Expected 1 to 20 calls");
  const refused = calls.find((c) => typeof c?.method !== "string" || !ALLOWED.has(c.method as string));
  if (refused) return bad(403, `This endpoint does not carry ${String(refused.method)}`);

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    /* Pass the node's own answer through untouched, errors included: web3.js
     * reads those, and a rewritten one would only confuse it. The upstream URL
     * never appears in it. */
    return new NextResponse(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return bad(502, "The RPC node did not answer");
  }
}
