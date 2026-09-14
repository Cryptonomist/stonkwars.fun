import "server-only";

/* THE SPARRING WALLET'S TAKE, on the server.
 *
 * One function, takeForSpar: given a challenge addressed to the sparring
 * wallet, it checks everything the site would check for any taker, tops the
 * wallet up from the test faucet if it is short, and sends the ordinary
 * accept_duel from the sparring key. It refuses anything off devnet.
 *
 * THE SAME RULES AS EVERY OTHER TAKER. sparRefusal (lib/spar.ts) for who and
 * how long; mixedHoursAt(t1, t2, now, d, "taker") when the challenge is read,
 * and again with Date.now() once the blockhash is in hand, exactly as the
 * Solana Action route does, because the reads in between take time of their
 * own. The program re-checks the rest.
 *
 * ONE TRANSACTION. The sparring key pays the fee and signs the accept. When it
 * holds too few shares of its corner's test stock, or too little SOL for fees
 * and the winner's token account, the faucet key (mint authority over the test
 * mints, and nothing else) signs a mint and a small transfer into the same
 * transaction, so a top-up never lands without the take or the other way
 * round. Nothing here settles anything: the settler starts and ends the round
 * like any other. */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction } from "@solana/spl-token";

import { ataFor, buildAcceptDuel, decodeDuel, PROGRAM_ID, type DuelView } from "./duel";
import { liveQuotes } from "./marketPrices.server";
import { quoteValue } from "./pricemath";
import { sparRefusal, SPAR_MAX_USD, SPAR_WALLET } from "./spar";
import { byTicker, mixedHoursAt, STAKEABLE, tickerForMint, tokensFor } from "./stocks";

/** SOL the sparring wallet keeps for fees and the token accounts a take opens. */
const SOL_FLOOR = 0.05 * LAMPORTS_PER_SOL;

export type SparResult = { duel: string; ok: true; signature: string } | { duel: string; ok: false; skipped: string };

function keyFrom(raw: string | undefined, name: string): Keypair | null {
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    throw new Error(`${name} is not a 64-number JSON array.`);
  }
}

/** The sparring and faucet keys, or why this deployment cannot spar. Never
 *  echoes a key: only which variable is missing or malformed. */
export function sparKeys(): { spar: Keypair; faucet: Keypair } | { error: string } {
  if (process.env.NEXT_PUBLIC_CLUSTER !== "devnet") return { error: "Sparring runs on devnet only." };
  if (!SPAR_WALLET) return { error: "NEXT_PUBLIC_SPAR_WALLET is not set." };
  try {
    const spar = keyFrom(process.env.SPAR_SECRET_KEY, "SPAR_SECRET_KEY");
    const faucet = keyFrom(process.env.FAUCET_SECRET_KEY, "FAUCET_SECRET_KEY");
    if (!spar) return { error: "SPAR_SECRET_KEY is not set." };
    if (!faucet) return { error: "FAUCET_SECRET_KEY is not set." };
    if (spar.publicKey.toBase58() !== SPAR_WALLET) return { error: "SPAR_SECRET_KEY does not match NEXT_PUBLIC_SPAR_WALLET." };
    return { spar, faucet };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "A key is malformed." };
  }
}

export function sparConnection(): Connection {
  return new Connection(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
}

export async function readDuel(conn: Connection, address: string): Promise<DuelView | null> {
  const key = new PublicKey(address);
  const info = await conn.getAccountInfo(key, "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return decodeDuel(key, info.data);
}

const neverCreated = (e: unknown) => /could not find account/i.test(String((e as Error)?.message ?? e));

export async function takeForSpar(conn: Connection, d: DuelView, keys: { spar: Keypair; faucet: Keypair }): Promise<SparResult> {
  const duel = d.address.toBase58();
  const skip = (why: string): SparResult => ({ duel, ok: false, skipped: why });
  const spar = keys.spar.publicKey;

  const now = Math.floor(Date.now() / 1000);
  const refusal = sparRefusal(d, now, spar.toBase58());
  if (refusal) return skip(refusal);

  const t1 = tickerForMint(d.creatorMint);
  const t2 = tickerForMint(d.opponentMint);
  if (!t1 || !t2) return skip("not a listed pair");
  const mixed = mixedHoursAt(t1, t2, now, d, "taker");
  if (mixed) return skip(mixed);

  /* The sparring wallet's corner must be a test mint the faucet can mint. */
  const stock = byTicker(t2);
  const token = tokensFor(t2)[0];
  if (!stock || !STAKEABLE.includes(stock) || !token || token.mint !== d.opponentMint.toBase58()) {
    return skip("its corner is not a faucet test stock");
  }

  const quotes = await liveQuotes([stock]).catch(() => ({}) as Record<string, never>);
  const price = quoteValue(quotes[t2]);
  if (!price) return skip("no live price to value the stake");
  const worth = (Number(d.opponentAmount) / 10 ** token.decimals) * price;
  if (worth > SPAR_MAX_USD) return skip(`stakes over $${SPAR_MAX_USD} are not taken`);

  const mint = d.opponentMint;
  const program = d.opponentTokenProgram;
  const ata = ataFor(spar, mint, program);
  let held: bigint;
  try {
    held = BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch (e) {
    if (!neverCreated(e)) return skip("could not read its balance");
    held = BigInt(0);
  }
  const lamports = await conn.getBalance(spar, "confirmed");

  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })];
  let faucetSigns = false;
  if (lamports < SOL_FLOOR) {
    ixs.push(SystemProgram.transfer({ fromPubkey: keys.faucet.publicKey, toPubkey: spar, lamports: SOL_FLOOR - lamports }));
    faucetSigns = true;
  }
  if (held < d.opponentAmount) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(spar, ata, spar, mint, program),
      createMintToInstruction(mint, ata, keys.faucet.publicKey, d.opponentAmount - held, [], program),
    );
    faucetSigns = true;
  }
  ixs.push(buildAcceptDuel(d, spar));

  const latest = await conn.getLatestBlockhash("confirmed");
  /* The reads above took time, and the accept can land until this blockhash
   * expires, so the hours are asked again from now, as the Action route does. */
  const late = mixedHoursAt(t1, t2, Math.floor(Date.now() / 1000), d, "taker");
  if (late) return skip(late);

  const tx = new Transaction({ feePayer: spar, ...latest }).add(...ixs);
  tx.sign(...(faucetSigns ? [keys.spar, keys.faucet] : [keys.spar]));
  try {
    const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const confirmed = await conn.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmed.value.err) return skip("the program refused the take");
    return { duel, ok: true, signature };
  } catch (e) {
    /* Somebody else's take can land first, or the challenge can be called off
     * in between. Only the first line of the error, never a key or an env. */
    return skip(e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "send failed");
  }
}
