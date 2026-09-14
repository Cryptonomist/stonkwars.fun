import { NextResponse, type NextRequest } from "next/server";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";

import { boundaryOf } from "@/lib/crankTx";
import { decodeDuel, PROGRAM_ID, SOURCE_SIGNED } from "@/lib/duel";
import { clientIp, Recent } from "@/lib/nudgeGate.server";
import { answerAt, quoteMessage, signedQuoteInstruction, TooOld, type Answer } from "@/lib/oracle";
import { oracleKeypair, oracleKeyProblem } from "@/lib/oracleKey.server";
import { answerReuseMs, Busy, QuoteGate } from "@/lib/quoteGate.server";
import { quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** Reads an exchange, a pool or nine venues before it can sign anything. */
export const maxDuration = 60;

/* The oracle's signed quotes for one fight's signed sides at one of its
 * boundaries, for anyone who wants to post them: the fight page's "settle it
 * yourself" button, or a settler that is not ours.
 *
 * Handing these out is safe because a quote is the answer to a question about
 * the past, taken from completed minute bars. There is one answer per stock
 * per boundary, so there is nothing to shop for, and nothing is signed before
 * its minute has closed. Asking is limited to real fights and their own
 * boundaries, which keeps this from being a general-purpose signing service.
 *
 * A side the composite priced (lib/composite.ts) comes with its proof: every
 * venue's request, candle and close, what was kept and why, and the sha256 of
 * the proof's canonical JSON. /api/quote/proof recomputes the same proof for
 * a stock and a boundary without a fight or a signature.
 *
 * Public, so it keeps the manners of lib/quoteGate.server.ts: a bucket per IP,
 * one computation per (feed, boundary) with the answer kept, and a cap on how
 * many prices this instance works out at once. */

const gate = new QuoteGate<Answer>({ reuseMs: (a) => answerReuseMs(a, Date.now()) });
const accounts = new Recent<AccountInfo<Buffer> | null>(5_000);

export async function GET(req: NextRequest) {
  const admission = gate.admit(clientIp(req.headers));
  if (!admission.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(admission.retryAfterSecs) } },
    );
  }

  const params = req.nextUrl.searchParams;
  const which = params.get("which");
  let address: PublicKey;
  try {
    address = new PublicKey(params.get("duel") ?? "");
  } catch {
    return NextResponse.json({ error: "Pass ?duel=<address>&which=start|settle" }, { status: 400 });
  }
  if (which !== "start" && which !== "settle") {
    return NextResponse.json({ error: "which must be start or settle" }, { status: 400 });
  }

  const oracle = oracleKeypair();
  if (!oracle) {
    const why = oracleKeyProblem();
    return NextResponse.json(
      { error: "This server holds no oracle key.", ...(why ? { because: why.problem, detail: why.detail } : {}) },
      { status: 503 },
    );
  }

  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  let account: AccountInfo<Buffer> | null;
  try {
    account = await accounts.get(address.toBase58(), () => conn.getAccountInfo(address));
  } catch {
    return NextResponse.json({ error: "Could not read the fight." }, { status: 502 });
  }
  if (!account || !account.owner.equals(PROGRAM_ID)) {
    return NextResponse.json({ error: "No fight at that address." }, { status: 404 });
  }
  const d = decodeDuel(address, account.data);
  if (!d.oracle.equals(oracle.publicKey)) {
    return NextResponse.json({ error: `That fight trusts oracle ${d.oracle.toBase58()}, not this server's.` }, { status: 409 });
  }

  const boundary = boundaryOf(d, which);
  const sides = [
    d.creatorSource === SOURCE_SIGNED ? d.creatorFeed : null,
    d.opponentSource === SOURCE_SIGNED ? d.opponentFeed : null,
  ].filter((f): f is string => f !== null);

  try {
    const quotes = [];
    for (const feed of sides) {
      const market = quoteSymbolFor(feed);
      if (!market) return NextResponse.json({ error: `No market symbol for feed ${feed}` }, { status: 500 });
      const answer = await gate.run(`${feed}:${boundary}`, () => answerAt({ feed, ...market, boundary }));
      const q = answer.quote;
      if (!q) {
        const retryAt = answer.parkedUntil ?? answer.retryAt;
        return NextResponse.json(
          {
            error: `The price at the ${which} is not final for ${market.symbol} yet. Try again shortly.`,
            wait: answer.wait,
            ...(retryAt !== null ? { retryAt } : {}),
            ...(answer.proof ? { tier: answer.tier, proof: answer.proof, sha256: answer.sha256 } : {}),
          },
          { status: 425, headers: { "cache-control": "no-store" } },
        );
      }
      // The signature, read back out of the Ed25519 instruction the crank
      // would send: its offset is the first field after the count.
      const data = signedQuoteInstruction(oracle, q).data;
      const sigAt = data.readUInt16LE(2);
      quotes.push({
        feed,
        price: q.price.toString(),
        expo: q.expo,
        publishTime: q.publishTime,
        message: Buffer.from(quoteMessage(q)).toString("base64"),
        signature: Buffer.from(data.subarray(sigAt, sigAt + 64)).toString("base64"),
        source: answer.source,
        tier: answer.tier,
        proof: answer.proof,
        sha256: answer.sha256,
      });
    }
    return NextResponse.json(
      { oracle: oracle.publicKey.toBase58(), boundary, quotes },
      { headers: { "cache-control": "public, max-age=3600, immutable" } },
    );
  } catch (e) {
    if (e instanceof Busy) {
      return NextResponse.json({ error: e.message }, { status: 503, headers: { "retry-after": String(e.retryAfterSecs) } });
    }
    if (e instanceof TooOld) return NextResponse.json({ error: e.message }, { status: 410 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "quote failed" }, { status: 502 });
  }
}
