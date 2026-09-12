/* How long does one settler pass actually take?
 *
 *   RPC=https://api.devnet.solana.com npx tsx scripts/crank-timing.ts [limit]
 *
 * A serverless function is killed at its time limit, and a cron service that
 * sees the timeout records a failure. Enough failures and the job is disabled,
 * which looks exactly like "the settler stopped working for no reason". So it
 * is worth knowing how close a real pass runs to the edge. */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair } from "@solana/web3.js";
import { HermesClient } from "@pythnetwork/hermes-client";

import { crankOnce, pendingJobs } from "../src/lib/crank";
import { quoteSymbolFor } from "../src/lib/stocks";

const ROOT = path.resolve(__dirname, "..");
for (const line of fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[]));

async function main() {
  const limit = Number(process.argv[2] ?? 5);
  const conn = new Connection(RPC, "confirmed");
  const payer = load(path.join(ROOT, "keys/crank-devnet.json"));
  const oracle = load(path.join(ROOT, "keys/oracle-devnet.json"));
  const hermes = process.env.PYTH_API_KEY
    ? new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
        accessToken: process.env.PYTH_API_KEY,
        timeout: 10_000,
      })
    : undefined;

  const started = Date.now();
  const jobs = await pendingJobs(conn, Math.floor(Date.now() / 1000));
  console.log(`${jobs.length} jobs due, listed in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const t0 = Date.now();
  const results = await crankOnce({ conn, payer, hermes, oracle, quoteSymbol: quoteSymbolFor, limit });
  const took = (Date.now() - t0) / 1000;

  for (const r of results) {
    console.log(`  ${r.kind.padEnd(6)} ${r.duel.slice(0, 8)} ${r.ok ? "ok" : `no: ${r.detail}`}`);
  }
  console.log(`\none pass of up to ${limit} jobs took ${took.toFixed(1)}s`);
  console.log(took > 50 ? "TOO SLOW: a 60s function would be killed" : "comfortably inside a 60s function");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
