/* The settler, as a long-running process: src/lib/crank.ts on a timer.
 *
 *   RPC=... PYTH_API_KEY=... npx tsx scripts/settler.ts
 *
 * The deployed app runs the same code at /api/crank when an external cron pings
 * it; this is for running it anywhere else, or beside `npm run dev`. Anyone can
 * run a settler. The result of every fight is the same whoever cranks it.
 *
 * Fights with a Pyth side need PYTH_API_KEY; fights with a signed side need the
 * oracle key, from ORACLE_SECRET_KEY or keys/oracle-<CLUSTER>.json. */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair } from "@solana/web3.js";
import { HermesClient } from "@pythnetwork/hermes-client";

import { crankOnce } from "../src/lib/crank";
import { quoteSymbolFor } from "../src/lib/stocks";
import { failingVenues, VENUE_ALERT_SECS } from "../src/lib/venues247";

loadEnvLocal();

const RPC = process.env.RPC ?? process.env.RPC_URL ?? "https://api.devnet.solana.com";
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? "5000");

function loadEnvLocal() {
  const file = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function oracleKey(): Keypair | undefined {
  const cluster = process.env.CLUSTER ?? (/localhost|127\.0\.0\.1/.test(RPC) ? "localnet" : "devnet");
  const file = path.resolve(__dirname, `../keys/oracle-${cluster}.json`);
  const raw =
    cluster !== "localnet" && process.env.ORACLE_SECRET_KEY
      ? process.env.ORACLE_SECRET_KEY
      : fs.existsSync(file)
        ? fs.readFileSync(file, "utf8")
        : undefined;
  return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[])) : undefined;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = process.env.CRANK_SECRET_KEY
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.CRANK_SECRET_KEY)))
    : Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
      );
  const hermes = process.env.PYTH_API_KEY
    ? new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", {
        accessToken: process.env.PYTH_API_KEY,
        timeout: 10_000,
      })
    : undefined;
  const oracle = oracleKey();
  if (!hermes) console.warn("No PYTH_API_KEY: fights with a Pyth side will wait.");
  if (!oracle) console.warn("No oracle key: fights with a signed side will wait.");

  /* A fight that fails is retried soon if the failure is routine (the market
   * is shut, Hermes has not indexed the print yet), later otherwise. */
  const backoff = new Map<string, number>();
  log(`settler ${payer.publicKey.toBase58()} on ${RPC.replace(/api[-_]?key=[^&]+/i, "api-key=***")}`);

  for (;;) {
    try {
      const results = await crankOnce({
        conn,
        payer,
        hermes,
        oracle,
        quoteSymbol: quoteSymbolFor,
        skip: (k) => (backoff.get(k) ?? 0) > Date.now(),
      });
      for (const r of results) {
        if (r.ok) {
          backoff.delete(r.duel);
          log(`${r.kind.padEnd(6)} ${r.duel.slice(0, 8)} ${r.detail.slice(0, 20)}...`);
        } else {
          const routine = /404|not the first|Hermes has|not yet/i.test(r.detail);
          backoff.set(r.duel, Date.now() + (routine ? 15_000 : 60_000));
          log(`skip   ${r.duel.slice(0, 8)} ${r.detail}`);
        }
      }
    } catch (e) {
      log("pass failed:", e instanceof Error ? e.message : e);
    }
    // A 24/7 venue that keeps failing holds every price that pins it; say so (docs/247-hardening.md, the runbook).
    const now = Math.floor(Date.now() / 1000);
    for (const v of failingVenues().filter((f) => now - f.since >= VENUE_ALERT_SECS)) {
      log(`venue  ${v.name} failing for ${Math.round((now - v.since) / 60)} min (${v.failures} requests): ${v.last}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
