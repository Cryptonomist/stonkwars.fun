import "server-only";

import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";

/* The oracle's signing key, for the crank and the quote route. From the
 * environment in a deployment; from the setup script's keys/ file in local
 * development, so a local validator's key never lands in .env.local. */
export function oracleKeypair(): Keypair | undefined {
  const cluster = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
  let raw = process.env.ORACLE_SECRET_KEY && cluster !== "localnet" ? process.env.ORACLE_SECRET_KEY : undefined;
  if (!raw && process.env.NODE_ENV !== "production") {
    const file = path.join(process.cwd(), "keys", `oracle-${cluster}.json`);
    if (fs.existsSync(file)) raw = fs.readFileSync(file, "utf8");
  }
  if (!raw) return undefined;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    /* A mistyped variable is a missing oracle, not a crash: the caller already
     * knows how to say there is no oracle here, and a thrown parse error on a
     * serverless host arrives as an empty 500 nobody can read. */
    return undefined;
  }
}
