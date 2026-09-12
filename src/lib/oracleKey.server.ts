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
    // Said properly by oracleKeyProblem(); a throw here would be an empty 500.
    return undefined;
  }
}

/* WHY THERE IS NO ORACLE, IN WORDS.
 *
 * "No oracle key" covers three different mistakes and a person fixing a
 * deployment needs to know which one they made. None of this reveals the key:
 * it reports the shape of what is there, and the public address it produces,
 * which is meant to be seen and is exactly what has to match the chain. */
export function oracleKeyProblem(): { problem: string; detail: string } | null {
  const cluster = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
  const raw = process.env.ORACLE_SECRET_KEY;

  if (!raw) {
    return {
      problem: "ORACLE_SECRET_KEY is not set on this deployment",
      detail: "Add it to the environment and redeploy: a build only picks up variables that existed when it ran.",
    };
  }
  if (cluster === "localnet") {
    return { problem: "NEXT_PUBLIC_CLUSTER is localnet, so the environment key is ignored", detail: "Set it to devnet." };
  }

  const trimmed = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      problem: "ORACLE_SECRET_KEY is set but is not JSON",
      detail: `It is ${trimmed.length} characters, starting ${JSON.stringify(trimmed.slice(0, 6))} and ending ${JSON.stringify(trimmed.slice(-6))}. It should be 64 numbers in square brackets, exactly as the key file has them, with no quotes around it.`,
    };
  }
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    return {
      problem: "ORACLE_SECRET_KEY parsed, but is not 64 numbers",
      detail: `Got ${Array.isArray(parsed) ? `an array of ${parsed.length}` : typeof parsed}.`,
    };
  }
  try {
    const key = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
    return { problem: "none", detail: key.publicKey.toBase58() };
  } catch (e) {
    return { problem: "Those 64 numbers are not a valid key", detail: e instanceof Error ? e.message : "unknown" };
  }
}
