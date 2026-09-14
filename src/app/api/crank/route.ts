import { after, NextResponse, type NextRequest } from "next/server";

import { crankOnce, CRON_PYTH_YIELD_SECS, CRON_YIELD_SECS, listJobs, type JobListing } from "@/lib/crank";
import { authorise } from "@/lib/crankAuth.server";
import { crankKeypair, settlerConnection, settlerHermes, settlerOracle } from "@/lib/settler.server";
import { quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The settler, serverless: an external cron (cron-job.org, a GitHub Action,
 * anything) GETs this once a minute with `Authorization: Bearer $CRON_SECRET`.
 *
 * The secret gates who can make THIS SERVER spend its key's SOL on fees, not
 * who can settle a fight: every crank here is permissionless on chain, and the
 * fight page offers the same thing to any visitor.
 *
 * IT ANSWERS AT ONCE AND WORKS AFTERWARDS.
 *
 * cron-job.org counts a request that takes more than 30 seconds as a failure,
 * and switches a job off after enough failures in a row. A pass that waits for
 * prices about to exist and confirms what it sends can take most of a minute,
 * so the route lists what is due, answers 200 with that list, and does the
 * work in after(), which Next runs once the response is sent, inside the same
 * function's time limit. The results go to the function log as JSON.
 *
 * A LISTING FAILURE IS STILL A 200.
 *
 * The body says { ok: false, error }, which cron-job.org's history shows, but
 * an RPC having a bad minute does not count towards switching the job off.
 * Only a mistake in this deployment (the secret, the key) gets an error code,
 * because only a person can fix those.
 *
 * `?wait=1` does the pass before answering and returns its results, for tests
 * and for a person checking a deployment by hand. */

/** Jobs one call takes; the next ping picks up the rest (see chooseJobs). */
const JOBS_PER_CALL = 8;
const CONCURRENCY = 4;
/** How far ahead a price may be and still be waited for within this call. */
const LOOKAHEAD_SECS = 40;
/** When the pass must have answered, from the start of the request. */
const PASS_MS = 50_000;

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const secret = process.env.CRON_SECRET;
  const auth = authorise(req.headers.get("authorization"), secret);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "unauthorized", why: auth.why },
      /* Proof this 401 came from the application and not from Vercel's own
       * deployment protection, which refuses preview URLs before any of this
       * runs and looks identical from the outside. */
      { status: 401, headers: { "x-stonkwars-crank": "1" } },
    );
  }

  let payer;
  try {
    payer = crankKeypair();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "CRANK_SECRET_KEY is not a key" }, { status: 503 });
  }
  if (!payer) return NextResponse.json({ error: "CRANK_SECRET_KEY is not set" }, { status: 503 });

  const now = Math.floor(t0 / 1000);
  const conn = settlerConnection();
  let listing: JobListing;
  try {
    listing = await listJobs(conn, now, { lookaheadSecs: LOOKAHEAD_SECS, lookup: quoteSymbolFor });
  } catch (e) {
    return NextResponse.json({ ok: false, at: now, error: e instanceof Error ? e.message : "listing failed" });
  }

  const summary = {
    ok: true,
    at: now,
    due: listing.due.map((j) => ({ duel: j.duel.address.toBase58(), kind: j.kind, readyAt: j.readyAt, why: j.why })),
    parked: listing.parked,
    ...(listing.errors.length ? { errors: listing.errors } : {}),
  };
  if (!listing.due.length) return NextResponse.json(summary);

  const pass = () =>
    crankOnce({
      conn,
      payer,
      hermes: settlerHermes(),
      oracle: settlerOracle(),
      quoteSymbol: quoteSymbolFor,
      listing,
      now,
      limit: JOBS_PER_CALL,
      concurrency: CONCURRENCY,
      deadlineMs: t0 + PASS_MS,
      yieldSecs: CRON_YIELD_SECS,
      // A Pyth crank from a page takes far longer than a signed one; see crank.ts.
      pythYieldSecs: CRON_PYTH_YIELD_SECS,
    });

  if (req.nextUrl.searchParams.get("wait") === "1") {
    try {
      return NextResponse.json({ ...summary, results: await pass() });
    } catch (e) {
      return NextResponse.json({ ...summary, ok: false, error: e instanceof Error ? e.message : "crank failed" });
    }
  }

  after(async () => {
    try {
      const results = await pass();
      console.log(JSON.stringify({ crank: "pass", at: now, ms: Date.now() - t0, results }));
    } catch (e) {
      console.error(JSON.stringify({ crank: "pass failed", at: now, error: e instanceof Error ? e.message : String(e) }));
    }
  });
  return NextResponse.json(summary);
}
