import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { ataFor } from "@/lib/duel";
import { CLUSTER } from "@/lib/stocks";
import type { JupiterQuote } from "@/lib/swap";
import type { Leg } from "@/lib/swapPairs";

/* Jupiter, from the server only.
 *
 * Every call to Jupiter goes through here, so an API key (JUPITER_API_KEY, or JUP_API_KEY) never
 * reaches a browser, and moving to Jupiter's next swap API is a change to this
 * one file. With a key it uses api.jup.ag; without one, the keyless lite host.
 *
 * THE FEE. Jupiter takes a platform fee for a fixed-input swap in the token the
 * user receives, paid into a token account named at build time, and refuses to
 * build a fee swap without one. So a fee is quoted only when the treasury
 * (SWAP_FEE_OWNER) already has the associated token account for that output
 * token on mainnet. Otherwise the swap is quoted and built with no fee: a
 * missing account costs the treasury, never the trade. */

const API_KEY = process.env.JUPITER_API_KEY || process.env.JUP_API_KEY;
const HOST = API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
const headers = (): Record<string, string> => (API_KEY ? { "x-api-key": API_KEY } : {});

export class JupiterError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function jupQuote(o: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  platformFeeBps: number;
}): Promise<JupiterQuote> {
  const url = new URL(`${HOST}/swap/v1/quote`);
  url.searchParams.set("inputMint", o.inputMint);
  url.searchParams.set("outputMint", o.outputMint);
  url.searchParams.set("amount", o.amount.toString());
  url.searchParams.set("slippageBps", String(o.slippageBps));
  url.searchParams.set("swapMode", "ExactIn");
  if (o.platformFeeBps > 0) url.searchParams.set("platformFeeBps", String(o.platformFeeBps));
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as JupiterQuote & { error?: string };
  if (!res.ok || body.error) throw new JupiterError(body.error ?? `Jupiter quote failed (HTTP ${res.status})`, res.status);
  return body;
}

export async function jupSwap(o: { quote: JupiterQuote; user: string; feeAccount: string | null }) {
  const res = await fetch(`${HOST}/swap/v1/swap`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: o.quote,
      userPublicKey: o.user,
      ...(o.feeAccount ? { feeAccount: o.feeAccount } : {}),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    swapTransaction?: string;
    lastValidBlockHeight?: number;
    simulationError?: { error?: string } | null;
    error?: string;
  };
  if (!res.ok || !body.swapTransaction) throw new JupiterError(body.error ?? `Jupiter could not build the swap (HTTP ${res.status})`, res.status);
  return { transaction: body.swapTransaction, lastValidBlockHeight: body.lastValidBlockHeight ?? 0, simulationError: body.simulationError?.error ?? null };
}

/* Mainnet reads, for the treasury's fee accounts. On a mainnet deployment the
 * keyed RPC_URL is mainnet. Elsewhere MAINNET_RPC_URL; failing that, a Helius
 * devnet RPC_URL's own key on Helius mainnet (one key serves both); and last the
 * public node, which often refuses servers in the cloud. */
function mainnetUrl(): string {
  if (CLUSTER === "mainnet-beta" && process.env.RPC_URL) return process.env.RPC_URL;
  if (process.env.MAINNET_RPC_URL) return process.env.MAINNET_RPC_URL;
  const rpc = process.env.RPC_URL ?? "";
  if (/^https:\/\/devnet\.helius-rpc\.com\//.test(rpc)) return rpc.replace("https://devnet.", "https://mainnet.");
  return "https://api.mainnet-beta.solana.com";
}
const mainnet = () => new Connection(mainnetUrl(), "confirmed");

/** Why a quote does or does not carry the fee, said without any secret. */
export type FeeStatus = "on" | "off" | "no-owner" | "bad-owner" | "no-account" | "lookup-failed";

const seen = new Map<string, { at: number; status: FeeStatus }>();
const TTL_MS = 10 * 60_000;
const RETRY_MS = 60_000;

/** The treasury's token account for `output`, and whether a fee can be paid into it. */
export async function feeAccountFor(output: Leg): Promise<{ account: string | null; status: FeeStatus }> {
  const owner = process.env.SWAP_FEE_OWNER?.trim();
  if (!owner) return { account: null, status: "no-owner" };
  let account: PublicKey;
  try {
    account = ataFor(new PublicKey(owner), new PublicKey(output.mint), new PublicKey(output.tokenProgram));
  } catch {
    return { account: null, status: "bad-owner" };
  }
  const key = account.toBase58();
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < (hit.status === "lookup-failed" ? RETRY_MS : TTL_MS)) {
    return { account: hit.status === "on" ? key : null, status: hit.status };
  }
  let status: FeeStatus;
  try {
    const info = await mainnet().getAccountInfo(account, "confirmed");
    status = info && info.owner.toBase58() === output.tokenProgram ? "on" : "no-account";
  } catch {
    status = "lookup-failed";
  }
  seen.set(key, { at: Date.now(), status });
  return { account: status === "on" ? key : null, status };
}
