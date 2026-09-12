import { NextResponse, type NextRequest } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { buildLinkHandle, isHandle } from "@/lib/duel";
import { oracleKeypair } from "@/lib/oracleKey.server";
import { COOKIE_LINK, openHandle, xConfig } from "@/lib/xAuth.server";

export const dynamic = "force-dynamic";

/* Step three: the oracle vouches, and the wallet signs.
 *
 * This builds the transaction that writes the handle and signs it as the
 * oracle, which is the server saying "X told me this handle belongs to whoever
 * is holding this browser". It is worth nothing on its own: the program also
 * demands the wallet's signature, which only the wallet can add, and which the
 * browser adds next. So the server can never write a handle onto a wallet, and
 * a wallet can never write a handle the server did not vouch for. */
export async function POST(req: NextRequest) {
  const cfg = xConfig();
  if (!cfg) return NextResponse.json({ error: "X sign-in is not configured" }, { status: 503 });

  const oracle = oracleKeypair();
  if (!oracle) return NextResponse.json({ error: "No oracle key on this deployment" }, { status: 503 });

  const sealed = openHandle(cfg.clientSecret, req.cookies.get(COOKIE_LINK)?.value);
  if (!sealed) return NextResponse.json({ error: "Sign in with X again: that link has expired" }, { status: 401 });
  if (!isHandle(sealed.handle)) return NextResponse.json({ error: "X returned a handle this program will not take" }, { status: 400 });

  let wallet: PublicKey;
  try {
    const body = (await req.json()) as { wallet?: string };
    wallet = new PublicKey(body.wallet ?? "");
  } catch {
    return NextResponse.json({ error: "Send the wallet that will sign" }, { status: 400 });
  }

  try {
    const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const tx = new Transaction().add(
      buildLinkHandle(wallet, oracle.publicKey, BigInt(sealed.xId), sealed.handle),
    );
    tx.feePayer = wallet;
    tx.recentBlockhash = (await conn.getLatestBlockhash("finalized")).blockhash;
    tx.partialSign(oracle);
    return NextResponse.json({
      handle: sealed.handle,
      xId: sealed.xId,
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not prepare the link" }, { status: 500 });
  }
}
