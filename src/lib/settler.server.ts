import "server-only";

/* What the server's settlers hold, made once per warm instance.
 *
 * The cron route and the page nudge both crank fights, and each call used to
 * build its own Connection and parse its own key out of the environment. That
 * is cheap once and wasteful a hundred times a minute, and it put the key
 * parsing in two places to get wrong. Here each thing is made the first time
 * it is asked for and kept while the instance is warm, keyed by the setting it
 * came from, so a changed variable (a redeploy, a test) is picked up rather
 * than served stale.
 *
 * Nothing here is ever sent to a browser, and nothing here reads a
 * NEXT_PUBLIC_ variable for a secret. Errors name the variable and the shape
 * of what is wrong, never any of its contents. */

import { Connection, Keypair, type PublicKey } from "@solana/web3.js";
import type { HermesClient } from "@pythnetwork/hermes-client";

import { hermes } from "./hermes.server";
import { oracleKeypair } from "./oracleKey.server";

const DEFAULT_RPC = "https://api.devnet.solana.com";

let connection: { url: string; conn: Connection } | null = null;

/** The RPC connection the settlers use, at "confirmed". */
export function settlerConnection(): Connection {
  const url = process.env.RPC_URL || DEFAULT_RPC;
  if (connection?.url !== url) connection = { url, conn: new Connection(url, "confirmed") };
  return connection.conn;
}

const keys = new Map<string, Keypair>();

function keyFrom(raw: string | undefined, name: string): Keypair | undefined {
  if (!raw) return undefined;
  const cached = keys.get(raw);
  if (cached) return cached;
  let key: Keypair;
  try {
    key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.trim()) as number[]));
  } catch {
    throw new Error(`${name} is set but is not a key: it should be 64 numbers in square brackets, as the key file has them`);
  }
  keys.set(raw, key);
  return key;
}

/** The cron settler's key, which pays its fees and rent. Undefined if unset. */
export function crankKeypair(): Keypair | undefined {
  return keyFrom(process.env.CRANK_SECRET_KEY, "CRANK_SECRET_KEY");
}

/* THE NUDGE HAS ITS OWN KEY WHEN THERE IS ONE.
 *
 * Page nudges are paid by a key of their own so its balance is a hard ceiling
 * on what visitors can make this server spend, and so the chain can tell a
 * nudge from the cron. It is optional: with NUDGE_SECRET_KEY unset the nudge
 * pays from the crank key, exactly as the cron would have. */
export function nudgeKeypair(): Keypair | undefined {
  if (process.env.NUDGE_SECRET_KEY) return keyFrom(process.env.NUDGE_SECRET_KEY, "NUDGE_SECRET_KEY");
  return crankKeypair();
}

/** The keyed Hermes client, or undefined when no Pyth key is set (fights with
 *  a Pyth side then wait, and say so). hermes() keeps the client itself. */
export function settlerHermes(): HermesClient | undefined {
  return process.env.PYTH_API_KEY ? hermes() : undefined;
}

let oracle: { raw: string | undefined; key: Keypair | undefined } | null = null;

/** The oracle's signing key, from the environment or, in development, keys/. */
export function settlerOracle(): Keypair | undefined {
  const raw = process.env.ORACLE_SECRET_KEY;
  if (!oracle || oracle.raw !== raw) oracle = { raw, key: oracleKeypair() };
  return oracle.key;
}

/* A BALANCE A MINUTE IS PLENTY.
 *
 * The nudge checks the payer can afford a crank before it tries one, and a
 * busy fight page would otherwise ask the RPC for the same number on every
 * call. Balances move by a few thousand lamports a crank; a minute-old figure
 * is exact enough to say "the settler is low". Concurrent callers share one
 * request, and a failed request is not remembered. */
export const BALANCE_TTL_MS = 60_000;
const balances = new Map<string, { at: number; lamports: Promise<number> }>();

/** The payer's balance in lamports, at most a minute old. */
export function payerBalance(payer: PublicKey): Promise<number> {
  const k = payer.toBase58();
  const hit = balances.get(k);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) return hit.lamports;
  const lamports = settlerConnection().getBalance(payer, "confirmed");
  const entry = { at: Date.now(), lamports };
  balances.set(k, entry);
  lamports.catch(() => {
    if (balances.get(k) === entry) balances.delete(k);
  });
  return lamports;
}
