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
 * enough to be one of ours. None of that is a wall (an Origin header is
 * whatever the caller says it is), but it keeps the endpoint from being a
 * free node somebody else builds on, and the method list means a stranger
 * cannot bill us for the expensive calls we never make.
 *
 * Subscriptions are deliberately absent: a serverless function cannot hold a
 * websocket. Nothing in the app needs one; see lib/confirm.ts. */

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
  // The fight receipt lists every transaction that touched a duel account.
  "getSignaturesForAddress",
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

/* WHEN THE PAID NODE REFUSES, THE PUBLIC ONE STILL ANSWERS.
 *
 * A paid endpoint is one account, one plan and one bill, and any of the three
 * can say no in the middle of a busy morning. On 21 September 2026 one said no
 * to `getProgramAccounts` alone: every cheap call passed, so the node looked
 * healthy, while every list of fights came back empty. The crank read no fights
 * due and answered 200, the cron recorded success, the board showed nothing,
 * and a linking error blamed X. A site that cannot list its own fights is down,
 * however well its health check reads.
 *
 * So a refusal from upstream is not passed to the browser on a test cluster.
 * The call goes to the public endpoint instead, which is slower and rate
 * limited and always there. The method is remembered for ten minutes, so the
 * one the plan will not carry stops costing a wasted round trip every time
 * while the rest keep the paid node.
 *
 * Only a refusal (401, 403, 429) or a node that breaks or never answers falls
 * back. A real JSON-RPC error inside a 200 is the chain's own answer and is
 * passed through untouched, as it always was. */
const FALLBACK = "https://api.devnet.solana.com";
const REFUSED_FOR_MS = 10 * 60_000;
const refusedAt = new Map<string, number>();
const isTestCluster = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") !== "mainnet-beta";

/** True when upstream refused this method recently, so skip straight past it. */
function recentlyRefused(methods: string[]): boolean {
  const now = Date.now();
  return methods.some((m) => {
    const at = refusedAt.get(m);
    if (at === undefined) return false;
    if (now - at >= REFUSED_FOR_MS) {
      refusedAt.delete(m);
      return false;
    }
    return true;
  });
}

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

  const methods = calls.map((c) => String(c.method));
  const forward = (url: string) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  /* Pass the node's own answer through untouched, errors included: web3.js
   * reads those, and a rewritten one would only confuse it. Neither upstream
   * URL ever appears in it. */
  const answer = (res: Response) =>
    new NextResponse(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });

  const canFallBack = isTestCluster && upstream !== FALLBACK;
  if (canFallBack && recentlyRefused(methods)) {
    try {
      return answer(await forward(FALLBACK));
    } catch {
      return bad(502, "The RPC node did not answer");
    }
  }

  let res: Response;
  try {
    res = await forward(upstream);
  } catch {
    if (!canFallBack) return bad(502, "The RPC node did not answer");
    try {
      return answer(await forward(FALLBACK));
    } catch {
      return bad(502, "The RPC node did not answer");
    }
  }

  /* A refusal is about us, not about the chain, so do not hand it on. */
  if (canFallBack && (res.status === 401 || res.status === 403 || res.status === 429)) {
    for (const m of methods) refusedAt.set(m, Date.now());
    try {
      return answer(await forward(FALLBACK));
    } catch {
      return answer(res);
    }
  }
  return answer(res);
}
