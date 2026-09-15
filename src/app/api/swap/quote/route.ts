import { NextResponse, type NextRequest } from "next/server";

import { feeAccountFor, JupiterError, jupQuote } from "@/lib/jupiter.server";
import { SLIPPAGE_CHOICES, swapFeeBps, toAtomic, type PayWith, type QuoteResponse, type Side } from "@/lib/swap";
import { pairFor, summarize } from "@/lib/swapPairs";

export const dynamic = "force-dynamic";

/* A live price for a trade: GET ?side=buy|sell&ticker=TSLA&pay=USDC|SOL&amount=25&slippageBps=100
 *
 * `amount` is what the user types: USDC or SOL to spend on a buy, shares to sell
 * on a sell. The answer is Jupiter's quote (kept whole, because building the
 * transaction needs it back), a summary the panel shows, and the fee account
 * the quote assumed. Works on every cluster: on devnet it is the mainnet price,
 * shown for reference. */

const MAX_USD_LIKE = 1_000_000;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const side = p.get("side") as Side;
  const pay = p.get("pay") as PayWith;
  const ticker = (p.get("ticker") ?? "").toUpperCase();
  const slippageBps = Number(p.get("slippageBps") ?? 100);

  if (side !== "buy" && side !== "sell") return bad("side must be buy or sell");
  if (pay !== "USDC" && pay !== "SOL") return bad("pay must be USDC or SOL");
  if (!(SLIPPAGE_CHOICES as readonly number[]).includes(slippageBps)) return bad("unsupported slippage");
  const pair = pairFor(side, ticker, pay);
  if (!pair) return bad(`${ticker || "That stock"} has no token to trade on Solana`, 404);

  const amount = toAtomic(p.get("amount") ?? "", pair.input.decimals);
  if (amount === null || amount <= 0n) return bad("Enter an amount above zero");
  if (Number(amount) / 10 ** pair.input.decimals > MAX_USD_LIKE) return bad("That amount is too large to quote here");

  try {
    const bps = swapFeeBps();
    const fee = bps > 0 ? await feeAccountFor(pair.output) : { account: null, status: "off" as const };
    const feeAccount = fee.account;
    const quote = await jupQuote({
      inputMint: pair.input.mint,
      outputMint: pair.output.mint,
      amount,
      slippageBps,
      platformFeeBps: feeAccount ? bps : 0,
    });
    const summary = summarize(quote, side, ticker, pay);
    if (!summary) return bad("Jupiter answered for a different pair", 502);
    const body: QuoteResponse = { quote, summary, feeAccount, feeStatus: { bps, status: fee.status }, at: Date.now() };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof JupiterError && e.status < 500 ? 422 : 502;
    const message = e instanceof Error ? e.message : "No route right now";
    return bad(/route|liquidity/i.test(message) ? `No route for ${pair.stock.symbol} right now` : message, status);
  }
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
