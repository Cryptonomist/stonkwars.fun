import { NextResponse, type NextRequest } from "next/server";
import { LAMPORTS_PER_SOL, PublicKey, type AccountInfo, type Keypair } from "@solana/web3.js";

import { crankJob, type CrankJob, type JobOutcome } from "@/lib/crank";
import { decodeDuel, PROGRAM_ID, readableProgramError, type DuelView } from "@/lib/duel";
import { clientIp, NudgeGate, Recent, redact, sameSite } from "@/lib/nudgeGate.server";
import type { NudgeAnswer } from "@/lib/nudgeSchedule";
import { jobFor, readyAt } from "@/lib/priceClock";
import {
  nudgeKeypair,
  nudgeSharesCrankKey,
  payerBalance,
  settlerConnection,
  settlerHermes,
  settlerOracle,
} from "@/lib/settler.server";
import { quoteSymbolFor } from "@/lib/stocks";

export const dynamic = "force-dynamic";
/* The longest a nudge runs: up to NEAR_SECS asleep waiting for the price, then
 * JOB_MS for the crank, plus crankTx's few seconds of cleanup grace. */
export const maxDuration = 60;

/* THE PAGE NUDGE: an open fight page asks, and the server cranks the fight the
 * moment its price exists, paid by the nudge key, with nobody signing anything.
 *
 *   POST { duel }  ->  { state, serverTime, readyAt?, retryAt?, signature?, ... }
 *
 * The page (lib/useSettlerNudge.ts) asks on the schedule in
 * lib/nudgeSchedule.ts: once just before the price can exist, and again when
 * this says to. The cron is still the backstop for fights nobody is watching,
 * and it waits past readyAt so it does not race a page: six seconds for a
 * signed fight, and this route's whole JOB_MS for a Pyth one (crank.ts).
 *
 * IT TAKES AN ADDRESS AND NOTHING ELSE. Every crank it can send is one the
 * chain accepts from anyone, with prices this server's oracle signs only once
 * their bar is final (oracle.ts) and the program accepts only at or after the
 * boundary. Nothing a caller sends can change what a fight is priced at or
 * when; the most a caller can do is make it happen promptly. The key never
 * leaves settler.server.ts.
 *
 * CHEAP UNTIL SOMETHING IS REALLY DUE. A fight with nothing to do, or whose
 * market is shut, or that can never be priced (a Pyth side in Pyth's dark
 * hours), or whose price is more than NEAR_SECS away, is answered from
 * one cached account read and the price clock, with no price source asked.
 * Only a fight whose price is about to exist gets a crank attempt, and the gate
 * (lib/nudgeGate.server.ts) turns any crowd asking about it into one. */

const gate = new NudgeGate<Reply>();
const accounts = new Recent<AccountInfo<Buffer> | null>(2_000);

/** A price at most this far off is waited for inside the request. */
const NEAR_SECS = 10;
/** How long the crank itself may take, from the moment the price is ready. */
const JOB_MS = 40_000;
const DEFAULT_MIN_BALANCE_SOL = 0.05;
/* WITHOUT A KEY OF ITS OWN, THE NUDGE STOPS EARLIER.
 *
 * With NUDGE_SECRET_KEY set, the nudge key's balance is the ceiling on what
 * visitors can make this server spend, and at 0.05 SOL it simply stops. With
 * it unset the nudge pays from the cron's key, and stopping at 0.05 would
 * leave the cron a handful of settles. So the default floor rises to 0.3 SOL
 * on a shared key: the nudge steps aside while the cron still has room to be
 * the backstop. NUDGE_MIN_BALANCE_SOL overrides either default. */
const SHARED_MIN_BALANCE_SOL = 0.3;
const MAX_BODY = 1_000;

type Reply = Omit<NudgeAnswer, "serverTime">;

const nowSecs = () => Math.floor(Date.now() / 1000);

/* Every answer carries the server's clock at the moment it was sent, so the
 * page can count down to readyAt on the server's time rather than a laptop's
 * that is a few seconds out. A reused answer gets a fresh serverTime too; its
 * other times are absolute and still hold. */
const reply = (a: Reply, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json({ ...a, serverTime: Date.now() / 1000 } satisfies NudgeAnswer, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const disabled = () => /^(1|true|yes|on)$/i.test(process.env.NUDGE_DISABLED?.trim() ?? "");

/** NUDGE_MIN_BALANCE_SOL, or when it is unset or not a number, 0.05 on the
 *  nudge's own key and 0.3 on the crank key it falls back to. */
function minBalanceLamports(shared: boolean): number {
  const raw = process.env.NUDGE_MIN_BALANCE_SOL?.trim();
  const sol = raw ? Number(raw) : NaN;
  const fallback = shared ? SHARED_MIN_BALANCE_SOL : DEFAULT_MIN_BALANCE_SOL;
  return (Number.isFinite(sol) && sol >= 0 ? sol : fallback) * LAMPORTS_PER_SOL;
}

let saidShared = false;

/** An error, fit for a visitor: no configured secret, no key-shaped query string. */
const publicDetail = (text: string) =>
  redact(text, [process.env.RPC_URL, process.env.PYTH_API_KEY, process.env.HERMES_URL, process.env.CRON_SECRET]);

async function sleepUntil(ms: number): Promise<void> {
  // Timers and the wall clock drift apart; never wake early for a price.
  while (Date.now() < ms) await new Promise((r) => setTimeout(r, Math.max(0, ms - Date.now())));
}

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ nudge: true, ...entry }));

export async function POST(req: NextRequest) {
  if (disabled()) return reply({ state: "disabled" });
  if (!sameSite(req.headers.get("origin"), req.headers.get("host"))) {
    return reply({ state: "refused", detail: "This endpoint serves this site's pages." }, 403);
  }

  const admission = gate.admit(clientIp(req.headers));
  if (!admission.ok) {
    return reply(
      { state: "failed", detail: "Too many requests.", retryAt: nowSecs() + admission.retryAfterSecs },
      429,
      { "retry-after": String(admission.retryAfterSecs) },
    );
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply({ state: "refused", detail: "Too large." }, 413);
  let address: PublicKey;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return reply({ state: "refused", detail: "Too large." }, 413);
    const duel = (JSON.parse(text) as { duel?: unknown }).duel;
    // A base58 public key is 32 to 44 characters; check the shape before parsing it.
    if (typeof duel !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(duel)) throw new Error("not an address");
    address = new PublicKey(duel);
  } catch {
    return reply({ state: "refused", detail: "Send { duel } with a fight's address." }, 400);
  }

  const key = address.toBase58();
  try {
    const answer = await gate.run(key, () => nudge(address));
    return reply(answer, answer.state === "not-found" ? 404 : 200);
  } catch (e) {
    console.error(JSON.stringify({ nudge: true, duel: key, error: publicDetail(readableProgramError(e)) }));
    return reply({ state: "failed", detail: "The nudge broke; the settler will still get to it.", retryAt: nowSecs() + 10 });
  }
}

/** One run for one duel. Everything a crowd shares, through the gate. */
async function nudge(address: PublicKey): Promise<Reply> {
  const duel = address.toBase58();
  const conn = settlerConnection();

  let info: AccountInfo<Buffer> | null;
  try {
    info = await accounts.get(duel, () => conn.getAccountInfo(address, "confirmed"));
  } catch {
    return { state: "failed", detail: "Could not read the fight.", retryAt: nowSecs() + 10 };
  }
  if (!info || !info.owner.equals(PROGRAM_ID)) return { state: "not-found" };
  let d: DuelView;
  try {
    d = decodeDuel(address, info.data);
  } catch {
    // Program-owned but not a duel: a profile, the config, a registry entry.
    return { state: "not-found" };
  }

  /* What is due, from the account and the price clock alone. No price source
   * is asked on any of these answers. */
  const now = nowSecs();
  const job = jobFor(d, now);
  if (!job) return { state: "nothing-due" };
  let at = now;
  let why: CrankJob["why"] = "refund";
  if (job.kind !== "refund") {
    const clock = readyAt(d, job.kind, now, quoteSymbolFor);
    if ("never" in clock) return { state: "never-priced", tickers: clock.never, refundAt: clock.refundAt };
    if ("shut" in clock) return { state: "waiting-for-market", tickers: clock.shut };
    // Never earlier than the boundary itself, as the cron's listing floors it.
    at = Math.max(clock.at, job.boundary);
    why = clock.why;
  }
  if (at - now > NEAR_SECS) return { state: "not-yet", readyAt: at, retryAt: at - 1 };

  /* Somebody has to pay, and can. The balance is at most a minute old
   * (settler.server.ts), which is exact enough to say "low". */
  let payer: Keypair | undefined;
  try {
    payer = nudgeKeypair();
  } catch (e) {
    console.error(JSON.stringify({ nudge: true, duel, error: e instanceof Error ? e.message : "bad key" }));
  }
  if (!payer) {
    log({ duel, state: "failed", detail: "no settler key (NUDGE_SECRET_KEY or CRANK_SECRET_KEY)" });
    return { state: "failed", detail: "The settler is not configured.", retryAt: nowSecs() + 60 };
  }
  const shared = nudgeSharesCrankKey();
  if (shared && !saidShared) {
    saidShared = true;
    console.warn(JSON.stringify({ nudge: true, note: "NUDGE_SECRET_KEY is unset: the nudge pays from CRANK_SECRET_KEY" }));
  }
  let lamports: number;
  try {
    lamports = await payerBalance(payer.publicKey);
  } catch {
    return { state: "failed", detail: "Could not read the settler's balance.", retryAt: nowSecs() + 10 };
  }
  if (lamports < minBalanceLamports(shared)) {
    console.error(
      JSON.stringify({ nudge: true, duel, alert: "settler low", payer: payer.publicKey.toBase58(), lamports, sharedWithCron: shared }),
    );
    return { state: "failed", detail: "settler low", retryAt: nowSecs() + 60 };
  }

  // Wait for the price here rather than make the page come back for it.
  await sleepUntil(at * 1_000);

  const sendToken = gate.takeSend();
  if (sendToken === null) {
    log({ duel, state: "failed", detail: "instance send budget spent" });
    return { state: "failed", detail: "This server is at its crank limit for the minute.", retryAt: nowSecs() + 10 };
  }
  const t0 = Date.now();
  let outcome: JobOutcome;
  try {
    outcome = await crankJob(
      {
        conn,
        payer,
        hermes: settlerHermes(),
        oracle: settlerOracle(),
        quoteSymbol: quoteSymbolFor,
        // The cron yields to page nudges; the nudge yields to nobody.
        yieldSecs: 0,
      },
      { duel: d, kind: job.kind, readyAt: at, why },
      Date.now() + JOB_MS,
    );
  } catch (e) {
    outcome = { state: "failed", detail: readableProgramError(e) };
  }
  /* Nothing reached the RPC, so nothing came out of the budget: a fight
   * already done, a price not ready, and also a failure before any send (a
   * fight trusting another oracle key, a price source down, a Pyth side with
   * no Pyth key). Keeping those would let a few broken fights, asked about
   * every ten seconds, spend the budget every due fight on this instance
   * needs. */
  if (!outcome.forwarded) gate.returnSend(sendToken);
  log({ duel, kind: job.kind, state: outcome.state, ms: Date.now() - t0, readyAt: at, detail: publicDetail(outcome.detail) });

  const after = nowSecs();
  switch (outcome.state) {
    case "sent":
      return { state: "sent", signature: outcome.signature, detail: publicDetail(outcome.detail) };
    case "done":
      return { state: "done", detail: publicDetail(outcome.detail) };
    case "not-yet":
      /* The plan's retryAt is now + 5; when the oracle knows the price moved
       * to a later bar, its readyAt is later than that, and asking before it
       * would only be answered "not yet" again. */
      return {
        state: "not-yet",
        ...(outcome.readyAt !== undefined ? { readyAt: outcome.readyAt } : {}),
        retryAt: Math.max(after + 5, (outcome.readyAt ?? 0) - 1),
        detail: publicDetail(outcome.detail),
      };
    default:
      return { state: "failed", detail: publicDetail(outcome.detail), retryAt: after + 10 };
  }
}
