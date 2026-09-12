import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Connection, Keypair } from "@solana/web3.js";

import { crankOnce } from "@/lib/crank";
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

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

/* Why a ping was turned away, phrased so it names the fix.
 *
 * A bare 401 cost hours here. The settler is configured in a web form on
 * another site, and the only place its answer is visible is that site's
 * execution history, which shows the response body. So the body has to carry
 * the diagnosis; there is nowhere else to look.
 *
 * Nothing sent is ever echoed back. A misconfigured header often IS the secret
 * with the scheme missing, so quoting even a few characters of it would publish
 * the thing this check exists to protect. Lengths and classifications only. */
export function authorise(header: string | null, secret: string | undefined): { ok: true } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why });

  if (!secret) return no("CRON_SECRET is not set on this deployment, so nothing can authenticate it. Set it in the environment.");
  if (header === null) {
    return no(
      "No Authorization header arrived. Either it is not configured, or it was dropped in transit: " +
        "a redirect strips it, so check the URL is exactly https, with no trailing slash, on the production host.",
    );
  }
  const m = /^(\S+)[ \t]+(\S.*)$/.exec(header.trim());
  if (!m) {
    return no(
      "The Authorization header carries no scheme, just one run of characters. " +
        "The value must read: Bearer <secret>, with a single space after Bearer.",
    );
  }
  const [, scheme, rest] = m;
  if (!/^bearer$/i.test(scheme)) return no(`The scheme is not Bearer. What arrived was ${scheme.length} characters long.`);

  /* Strict about the secret, forgiving about what surrounds it. A trailing
   * newline on a pasted value is not an intruder, it is a web form. */
  const sent = rest.trim();
  if (same(sent, secret.trim())) return { ok: true };
  return no(
    `The token after Bearer does not match CRON_SECRET. It is ${sent.length} characters; ` +
      `${secret.trim().length} were expected. Re-copy the secret and take the whole of it.`,
  );
}

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
