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

import {
  allDuels,
  ataFor,
  buildAcceptDuel,
  buildCancelDuel,
  buildCreateDuel,
  decodeDuel,
  isInviteOnly,
  PROGRAM_ID,
  randomSeed,
  STATUS_OPEN,
  type DuelView,
} from "./duel";
import { liveQuotes } from "./marketPrices.server";
import { quoteValue } from "./pricemath";
import { planSeat, sparRefusal, SPAR_MAX_USD, SPAR_SEAT_USD, SPAR_SEATS, SPAR_WALLET } from "./spar";
import { byTicker, CLUSTER, mixedHoursAt, stakeAssetFor, STAKEABLE, tickerForMint, tokensFor } from "./stocks";

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
  // The cluster as the rest of the app reads it (unset means devnet), so the
  // browser's SPAR_WALLET and this server can never disagree about it.
  if (CLUSTER !== "devnet") return { error: "Sparring runs on devnet only." };
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

/* ─── Its own seats ───────────────────────────────────────────────────────── */

export type SeatResult =
  | { opened: string; durationSecs: number; signature: string }
  | { cancelled: string; signature: string }
  | { skipped: string };

/** Sign, send and confirm, reporting only the first line of any failure. */
async function sendSigned(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<{ signature: string } | { error: string }> {
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest }).add(...ixs);
    tx.sign(...signers);
    const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const confirmed = await conn.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmed.value.err) return { error: "the program refused it" };
    return { signature };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "send failed" };
  }
}

/** Call off one of its own seats that expired untaken: the stake and the rent come home. */
async function cancelSeat(conn: Connection, d: DuelView, keys: { spar: Keypair }): Promise<SeatResult> {
  const sent = await sendSigned(conn, [buildCancelDuel(d, keys.spar.publicKey)], [keys.spar]);
  return "signature" in sent ? { cancelled: d.address.toBase58(), signature: sent.signature } : { skipped: `cancel: ${sent.error}` };
}

/* OPEN ONE SEAT.
 *
 * The pair and round come from planSeat (lib/spar.ts), judged by the same
 * mixedHoursAt a visitor's take would be judged by. Each side stakes about
 * SPAR_SEAT_USD at live prices, in the same one-transaction shape as a take:
 * the faucet mints the sparring wallet's corner and tops up its SOL if short,
 * and the sparring key creates the challenge, open to anyone. */
async function openSeat(conn: Connection, openPairs: Set<string>, keys: { spar: Keypair; faucet: Keypair }): Promise<SeatResult> {
  const now = Math.floor(Date.now() / 1000);
  const plan = planSeat(now, openPairs, (a, b, takeAt, durationSecs, expiresTs) => {
    const sa = stakeAssetFor(a);
    const sb = stakeAssetFor(b);
    if (!sa || !sb) return false;
    return mixedHoursAt(a, b, takeAt, { durationSecs, endTs: 0, expiresTs }, "taker") === null;
  });
  if (!plan) return { skipped: "no pair is fair to open right now" };

  const stockA = byTicker(plan.a);
  const stockB = byTicker(plan.b);
  const assetA = stakeAssetFor(plan.a);
  const assetB = stakeAssetFor(plan.b);
  const tokenA = tokensFor(plan.a)[0];
  const tokenB = tokensFor(plan.b)[0];
  if (!stockA || !stockB || !assetA || !assetB || !tokenA || !tokenB) return { skipped: `${plan.a}/${plan.b} has no test token` };

  const quotes = await liveQuotes([stockA, stockB]).catch(() => ({}) as Record<string, never>);
  const priceA = quoteValue(quotes[plan.a]);
  const priceB = quoteValue(quotes[plan.b]);
  if (!priceA || !priceB) return { skipped: "no live price to size a seat" };
  const units = (usd: number, price: number, decimals: number) => BigInt(Math.max(1, Math.round((usd / price) * 10 ** decimals)));
  const creatorAmount = units(SPAR_SEAT_USD, priceA, tokenA.decimals);
  const opponentAmount = units(SPAR_SEAT_USD, priceB, tokenB.decimals);

  const spar = keys.spar.publicKey;
  const ata = ataFor(spar, assetA.mint, assetA.tokenProgram);
  let held = BigInt(0);
  try {
    held = BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch (e) {
    if (!neverCreated(e)) return { skipped: "could not read its balance" };
  }
  const lamports = await conn.getBalance(spar, "confirmed");

  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })];
  let faucetSigns = false;
  if (lamports < SOL_FLOOR) {
    ixs.push(SystemProgram.transfer({ fromPubkey: keys.faucet.publicKey, toPubkey: spar, lamports: SOL_FLOOR - lamports }));
    faucetSigns = true;
  }
  if (held < creatorAmount) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(spar, ata, spar, assetA.mint, assetA.tokenProgram),
      createMintToInstruction(assetA.mint, ata, keys.faucet.publicKey, creatorAmount - held, [], assetA.tokenProgram),
    );
    faucetSigns = true;
  }
  ixs.push(
    buildCreateDuel({
      creator: spar,
      seed: randomSeed(),
      creatorAsset: assetA,
      opponentAsset: assetB,
      creatorAmount,
      opponentAmount,
      durationSecs: plan.durationSecs,
      endTs: 0,
      expiresTs: plan.expiresTs,
      taunt: "The sparring wallet takes on anyone. Your move.",
    }).instruction,
  );
  const sent = await sendSigned(conn, ixs, faucetSigns ? [keys.spar, keys.faucet] : [keys.spar]);
  if (!("signature" in sent)) return { skipped: `open ${plan.a}/${plan.b}: ${sent.error}` };
  openPairs.add(`${plan.a}/${plan.b}`);
  return { opened: `${plan.a}/${plan.b}`, durationSecs: plan.durationSecs, signature: sent.signature };
}

/* ONE TICK OF THE SPARRING WALLET: everything it does unprompted.
 *
 * Run once a minute (the cron's /api/crank calls it after answering, and
 * GET /api/spar runs it for anyone holding CRON_SECRET). It reads every duel
 * once, then: takes up to two open challenges addressed to it (a page that has
 * one on screen also asks, through POST /api/spar, so a visitor rarely waits
 * for this); calls off up to two of its own seats that expired untaken; and
 * opens one seat if fewer than SPAR_SEATS are open. One seat a tick keeps a
 * failure from spending in a loop. */
export async function sparTick(
  conn: Connection,
  keys: { spar: Keypair; faucet: Keypair },
): Promise<{ takes: SparResult[]; seats: SeatResult[] }> {
  const now = Math.floor(Date.now() / 1000);
  const spar = keys.spar.publicKey.toBase58();
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allDuels() });
  const open: DuelView[] = [];
  for (const a of accounts) {
    try {
      const d = decodeDuel(a.pubkey, a.account.data);
      if (d.status === STATUS_OPEN) open.push(d);
    } catch {
      /* Not a duel this build can read. */
    }
  }

  const takes: SparResult[] = [];
  const addressed = open.filter((d) => !sparRefusal(d, now, spar)).sort((a, b) => a.expiresTs - b.expiresTs);
  for (const d of addressed.slice(0, 2)) takes.push(await takeForSpar(conn, d, keys));

  const seats: SeatResult[] = [];
  const mine = open.filter((d) => d.creator.toBase58() === spar && !isInviteOnly(d));
  for (const d of mine.filter((d) => d.expiresTs <= now).slice(0, 2)) seats.push(await cancelSeat(conn, d, keys));

  const live = mine.filter((d) => d.expiresTs > now);
  const openPairs = new Set(live.map((d) => `${tickerForMint(d.creatorMint)}/${tickerForMint(d.opponentMint)}`));
  if (live.length < SPAR_SEATS) seats.push(await openSeat(conn, openPairs, keys));
  return { takes, seats };
}
