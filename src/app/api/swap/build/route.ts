import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { feeAccountFor, JupiterError, jupSwap } from "@/lib/jupiter.server";
import { CLUSTER } from "@/lib/stocks";
import { swapFeeBps, type JupiterQuote } from "@/lib/swap";
import { tradeFor } from "@/lib/swapPairs";

export const dynamic = "force-dynamic";

/* The unsigned swap transaction: POST { quote, user, feeAccount }.
 *
 * Mainnet only, since only mainnet has markets for these tokens. The quote comes
 * back from the browser, so it is checked again rather than trusted: its two
 * mints must be a trade this site offers (a stock's token against USDC or SOL),
 * and a fee is passed only if it is this deployment's fee, paid into the
 * treasury account this server found for itself. The wallet signs what comes
 * back; nothing here can sign or send. */

export async function POST(req: NextRequest) {
  if (CLUSTER !== "mainnet-beta") {
    return bad("Trading runs on mainnet. On devnet, fight with free test shares.", 403);
  }

  let quote: JupiterQuote;
  let user: string;
  try {
    const body = (await req.json()) as { quote?: JupiterQuote; user?: string };
    if (!body.quote || !body.user) throw new Error();
    quote = body.quote;
    user = new PublicKey(body.user).toBase58();
  } catch {
    return bad("Send { quote, user }");
  }

  const trade = tradeFor(quote.inputMint, quote.outputMint);
  if (!trade) return bad("That is not a trade this site offers");

  const feeBps = quote.platformFee?.feeBps ?? 0;
  let feeAccount: string | null = null;
  if (feeBps > 0) {
    if (feeBps !== swapFeeBps()) return bad("That quote carries a fee this site does not charge. Ask for a fresh quote.");
    feeAccount = (await feeAccountFor(trade.pair.output)).account;
    if (!feeAccount) return bad("The fee account is unavailable. Ask for a fresh quote.", 409);
  }

  try {
    const built = await jupSwap({ quote, user, feeAccount });
    return NextResponse.json(built, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof JupiterError && e.status < 500 ? 422 : 502;
    return bad(e instanceof Error ? e.message : "Could not build the swap", status);
  }
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
