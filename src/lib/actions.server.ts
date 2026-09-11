import "server-only";

/* Solana Actions (Blinks) plumbing, by hand rather than through
 * @solana/actions: the spec is a handful of headers and two JSON shapes. */

import { CLUSTER } from "@/lib/stocks";

/** CAIP-2 ids: the genesis-hash prefix of each cluster. */
const CHAIN_IDS: Record<string, string> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  localnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const ACTION_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": CHAIN_IDS[CLUSTER] ?? CHAIN_IDS.devnet,
  "Content-Type": "application/json",
};

export const actionJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: ACTION_HEADERS });

export const actionError = (message: string, status = 400) => actionJson({ message }, status);
