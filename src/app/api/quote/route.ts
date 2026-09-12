import { NextResponse, type NextRequest } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

import { boundaryOf } from "@/lib/crankTx";
import { decodeDuel, PROGRAM_ID, SOURCE_SIGNED } from "@/lib/duel";
import { quoteAt, quoteMessage, signedQuoteInstruction } from "@/lib/oracle";
import { oracleKeypair } from "@/lib/oracleKey.server";
import { quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/** Reads an exchange or a pool before it can sign anything. */
export const maxDuration = 60;

/* The oracle's signed quotes for one fight's signed sides at one of its
 * boundaries, for anyone who wants to post them: the fight page's "settle it
 * yourself" button, or a settler that is not ours.
 *
 * Handing these out is safe because a quote is the answer to a question about
 * the past, taken from completed minute bars. There is one answer per stock
 * per boundary, so there is nothing to shop for, and nothing is signed before
 * its minute has closed. Asking is limited to real fights and their own
 * boundaries, which keeps this from being a general-purpose signing service. */

export async function GET(req: NextRequest) {
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
  if (!oracle) return NextResponse.json({ error: "This server holds no oracle key." }, { status: 503 });

  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const account = await conn.getAccountInfo(address);
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
      const q = await quoteAt({ feed, ...market, boundary });
      if (!q) {
        return NextResponse.json(
          { error: `The price at the ${which} is not final for ${market.symbol} yet. Try again shortly.` },
          { status: 425 },
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
      });
    }
    return NextResponse.json(
      { oracle: oracle.publicKey.toBase58(), boundary, quotes },
      { headers: { "cache-control": "public, max-age=3600, immutable" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "quote failed" }, { status: 502 });
  }
}
