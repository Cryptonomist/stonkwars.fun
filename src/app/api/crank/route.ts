import { NextResponse, type NextRequest } from "next/server";
import { Connection, Keypair } from "@solana/web3.js";

import { crankOnce } from "@/lib/crank";
import { authorise } from "@/lib/crankAuth.server";
import { hermes } from "@/lib/hermes.server";
import { oracleKeypair } from "@/lib/oracleKey.server";
import { quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The settler, serverless: an external cron (cron-job.org, a GitHub Action,
 * anything) GETs this once a minute with `Authorization: Bearer $CRON_SECRET`.
 *
 * The secret gates who can make THIS SERVER spend its key's SOL on fees, not
 * who can settle a fight: every crank here is permissionless on chain, and the
 * fight page offers the same thing to any visitor. A few jobs per call keeps a
 * call inside the function's time limit; the next ping picks up the rest, and
 * crankOnce shuffles so "the rest" is not always the same unlucky jobs. */
const JOBS_PER_CALL = 5;

export async function GET(req: NextRequest) {
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
  const key = process.env.CRANK_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "CRANK_SECRET_KEY is not set" }, { status: 503 });

  try {
    const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key) as number[]));
    const results = await crankOnce({
      conn,
      payer,
      hermes: process.env.PYTH_API_KEY ? hermes() : undefined,
      oracle: oracleKeypair(),
      quoteSymbol: quoteSymbolFor,
      limit: JOBS_PER_CALL,
    });
    return NextResponse.json({ at: Math.floor(Date.now() / 1000), results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "crank failed" }, { status: 500 });
  }
}
