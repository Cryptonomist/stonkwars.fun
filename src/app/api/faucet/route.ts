import { NextResponse, type NextRequest } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import devnet from "@/data/stocks.devnet.json";
import { hermes } from "@/lib/hermes.server";
import { byTicker } from "@/lib/stocks";

export const dynamic = "force-dynamic";

/* DEVNET ONLY. Tops a wallet up to about $250 of every test stock, and to
 * 0.05 SOL, so someone with an empty wallet can fight within a minute.
 *
 * "Top up to", not "add": a second press gives nothing until the wallet has
 * spent some, which is the rate limit that survives a serverless restart. The
 * in-memory cooldown on top only stops hammering. The faucet key is mint
 * authority over TEST mints on devnet and nothing else. */

const TARGET_USD = 250;
const SOL_FLOOR = 0.05 * LAMPORTS_PER_SOL;
const STOCKS_PER_TX = 4;
const COOLDOWN_MS = 30_000;
const recent = new Map<string, number>();

export async function POST(req: NextRequest) {
  if ((process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") !== "devnet") {
    return NextResponse.json({ error: "The faucet only runs on devnet." }, { status: 403 });
  }
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "The faucet is not configured on this server." }, { status: 503 });

  let owner: PublicKey;
  try {
    const body = (await req.json()) as { wallet?: string };
    owner = new PublicKey(body.wallet ?? "");
  } catch {
    return NextResponse.json({ error: "Send { wallet } as a Solana address." }, { status: 400 });
  }

  const last = recent.get(owner.toBase58()) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Easy. Try again in a few seconds." }, { status: 429 });
  }
  recent.set(owner.toBase58(), Date.now());

  const faucet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const tokenProgram = new PublicKey(devnet.tokenProgram);
  const mints = devnet.mints as Record<string, string>;

  // Live prices size the drip; without them, one share of each.
  const prices: Record<string, number> = {};
  try {
    const feeds = Object.keys(mints).map((t) => byTicker(t)?.feed).filter(Boolean) as string[];
    const res = await hermes().getLatestPriceUpdates(feeds, { parsed: true, ignoreInvalidPriceIds: true });
    for (const p of res.parsed ?? []) {
      const t = Object.keys(mints).find((k) => byTicker(k)?.feed === p.id.replace(/^0x/, ""));
      if (t) prices[t] = Number(p.price.price) * 10 ** p.price.expo;
    }
  } catch {
    /* Fall through to one share each. */
  }

  const perStock: TransactionInstruction[][] = [];
  let minted = 0;
  for (const [ticker, mintStr] of Object.entries(mints)) {
    const mint = new PublicKey(mintStr);
    const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
    const shares = prices[ticker] ? TARGET_USD / prices[ticker] : 1;
    const target = BigInt(Math.floor(shares * 10 ** devnet.decimals));
    const have = await connection
      .getTokenAccountBalance(ata)
      .then((b) => BigInt(b.value.amount))
      .catch(() => BigInt(0));
    if (have * BigInt(2) >= target) continue;
    perStock.push([
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, owner, mint, tokenProgram),
      createMintToInstruction(mint, ata, faucet.publicKey, target - have, [], tokenProgram),
    ]);
    minted++;
  }

  const lamports = await connection.getBalance(owner);
  const topUp = lamports < SOL_FLOOR ? SOL_FLOOR - lamports : 0;

  try {
    for (let i = 0; i < perStock.length || (i === 0 && topUp > 0); i += STOCKS_PER_TX) {
      const tx = new Transaction();
      if (i === 0 && topUp > 0) {
        tx.add(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: owner, lamports: topUp }));
      }
      for (const ixs of perStock.slice(i, i + STOCKS_PER_TX)) tx.add(...ixs);
      if (tx.instructions.length) await sendAndConfirmTransaction(connection, tx, [faucet], { commitment: "confirmed" });
    }
  } catch (e) {
    recent.delete(owner.toBase58());
    const error = e instanceof Error ? e.message.split("\n")[0] : "Faucet transaction failed";
    return NextResponse.json({ error }, { status: 502 });
  }

  const parts: string[] = [];
  if (minted) parts.push(`Topped up ${minted} test stocks to about $${TARGET_USD} each`);
  if (topUp) parts.push(`sent ${(topUp / LAMPORTS_PER_SOL).toFixed(3)} devnet SOL`);
  return NextResponse.json({
    ok: true,
    message: parts.length ? `${parts.join(" and ")}.` : "You are already stocked. Go pick a fight.",
  });
}
