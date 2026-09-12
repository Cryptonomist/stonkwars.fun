import fs from "fs";
import path from "path";
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

import { liveQuotes } from "@/lib/marketPrices.server";
import { quoteValue } from "@/lib/pricemath";
import { byTicker, STAKEABLE, tokensFor, type Stock } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/* Minting to a new wallet means talking to the chain and waiting for a
 * confirmation, which outlives the default ten seconds often enough to matter.
 * A visitor's first click must not be the one that fails. */
export const maxDuration = 60;

/* TEST CLUSTERS ONLY. Tops a wallet up to about $250 of the test stocks it
 * asks for (the two in the fight it is about to make or take, usually), and to
 * 0.05 SOL, so someone with an empty wallet can fight within a minute.
 *
 * "Top up to", not "add": a second press gives nothing until the wallet has
 * spent some, which is the rate limit that survives a serverless restart. The
 * in-memory cooldown on top only stops hammering. The faucet key is mint
 * authority over TEST mints and nothing else. */

const TARGET_USD = 250;
const SOL_FLOOR = 0.05 * LAMPORTS_PER_SOL;
const MAX_STOCKS = 4;
/** What a wallet gets when it does not say. */
const STARTER = ["TSLA", "NVDA", "AAPL", "QQQ"];
const COOLDOWN_MS = 10_000;
const recent = new Map<string, number>();

const CLUSTER_NAME = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";

/** The env var in a deployment; the key file from the setup script in local
 *  development, so a local validator's faucet never lands in .env.local. */
function faucetSecret(): string | null {
  if (process.env.FAUCET_SECRET_KEY && CLUSTER_NAME === "devnet") return process.env.FAUCET_SECRET_KEY;
  if (process.env.NODE_ENV === "production") return null;
  const file = path.join(process.cwd(), "keys", `faucet-${CLUSTER_NAME}.json`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export async function POST(req: NextRequest) {
  if (CLUSTER_NAME !== "devnet" && CLUSTER_NAME !== "localnet") {
    return NextResponse.json({ error: "The faucet only runs on test clusters." }, { status: 403 });
  }
  const secret = faucetSecret();
  if (!secret) return NextResponse.json({ error: "The faucet is not configured on this server." }, { status: 503 });

  let owner: PublicKey;
  let asked: string[];
  try {
    const body = (await req.json()) as { wallet?: string; tickers?: string[] };
    owner = new PublicKey(body.wallet ?? "");
    asked = Array.isArray(body.tickers) && body.tickers.length ? body.tickers.map(String) : STARTER;
  } catch {
    return NextResponse.json({ error: "Send { wallet, tickers? } with a Solana address." }, { status: 400 });
  }
  const stocks = [...new Set(asked)]
    .map((t) => byTicker(t.toUpperCase()))
    .filter((s): s is Stock => !!s && STAKEABLE.includes(s))
    .slice(0, MAX_STOCKS);
  if (!stocks.length) return NextResponse.json({ error: "None of those stocks can be staked here." }, { status: 400 });

  const last = recent.get(owner.toBase58()) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Easy. Try again in a few seconds." }, { status: 429 });
  }
  recent.set(owner.toBase58(), Date.now());

  /* A key that will not parse used to throw here, which a serverless host
   * turns into an empty 500 with nothing to read. An environment variable is
   * typed by a person, so say what is wrong with it. */
  let faucet: Keypair;
  try {
    faucet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  } catch {
    return NextResponse.json(
      { error: "FAUCET_SECRET_KEY is not a 64-number JSON array. Paste the key file's contents exactly." },
      { status: 503 },
    );
  }
  const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");

  // Live prices size the drip; without one, a single share.
  const quotes = await liveQuotes(stocks).catch(() => ({}) as Awaited<ReturnType<typeof liveQuotes>>);

  /* Everything the chain has to tell us, asked at once.
   *
   * One balance at a time was a round trip each, and with the SOL balance
   * after them the whole thing outlived the function before it had sent
   * anything. Nothing here depends on the answer before it. */
  const wanted = stocks.map((stock) => {
    const token = tokensFor(stock.ticker)[0];
    const mint = new PublicKey(token.mint);
    const program = new PublicKey(token.tokenProgram);
    const price = quoteValue(quotes[stock.ticker]);
    const shares = price ? TARGET_USD / price : 1;
    return {
      token,
      mint,
      program,
      ata: getAssociatedTokenAddressSync(mint, owner, false, program),
      target: BigInt(Math.floor(shares * 10 ** token.decimals)),
    };
  });

  const [balances, lamports] = await Promise.all([
    Promise.all(
      wanted.map((w) =>
        connection
          .getTokenAccountBalance(w.ata)
          .then((b) => BigInt(b.value.amount))
          .catch(() => BigInt(0)),
      ),
    ),
    connection.getBalance(owner),
  ]);

  const instructions: TransactionInstruction[] = [];
  const topped: string[] = [];
  wanted.forEach((w, i) => {
    const have = balances[i];
    if (have * BigInt(2) >= w.target) return;
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, w.ata, owner, w.mint, w.program),
      createMintToInstruction(w.mint, w.ata, faucet.publicKey, w.target - have, [], w.program),
    );
    topped.push(w.token.symbol);
  });

  const topUp = lamports < SOL_FLOOR ? SOL_FLOOR - lamports : 0;
  if (topUp) instructions.unshift(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: owner, lamports: topUp }));

  try {
    if (instructions.length) {
      await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [faucet], {
        commitment: "confirmed",
      });
    }
  } catch (e) {
    recent.delete(owner.toBase58());
    const error = e instanceof Error ? e.message.split("\n")[0] : "Faucet transaction failed";
    return NextResponse.json({ error }, { status: 502 });
  }

  const parts: string[] = [];
  if (topped.length) {
    const priced = topped.length && Object.keys(quotes).length > 0;
    parts.push(`Topped up ${topped.join(", ")} ${priced ? `to about $${TARGET_USD} each` : "to one share each"}`);
  }
  if (topUp) parts.push(`sent ${(topUp / LAMPORTS_PER_SOL).toFixed(3)} test SOL`);
  return NextResponse.json({
    ok: true,
    message: parts.length
      ? `${parts.join(" and ")}.`
      : `You already hold ${stocks.map((s) => tokensFor(s.ticker)[0].symbol).join(", ")}. Go pick a fight.`,
  });
}
