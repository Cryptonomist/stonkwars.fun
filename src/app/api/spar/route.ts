import { NextResponse, type NextRequest } from "next/server";

import { authorise } from "@/lib/crankAuth.server";
import { allDuels, decodeDuel, PROGRAM_ID, type DuelView } from "@/lib/duel";
import { sparRefusal } from "@/lib/spar";
import { readDuel, sparConnection, sparKeys, takeForSpar, type SparResult } from "@/lib/spar.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* THE SPARRING WALLET TAKES WHAT IS ADDRESSED TO IT (devnet only).
 *
 * Two ways in, both ending in lib/spar.server.ts takeForSpar, which applies
 * the same checks any taker gets and refuses anything off devnet:
 *
 *   POST { duel }  from the fight page of a challenge addressed to the sparring
 *                  wallet, so a visitor's own open page gets it taken without a
 *                  cron. Only that one challenge, and only when it qualifies;
 *                  anyone may ask, because the answer is the same whoever asks.
 *   GET            with Authorization: Bearer $CRON_SECRET, for an external
 *                  cron: every open challenge addressed to the wallet.
 *
 * With the keys unset the route answers 503 and does nothing, so a deployment
 * that has not provisioned a sparring wallet behaves exactly as before. */

/** One ask per challenge this often at most, and a ceiling per minute, so an
 *  open page (or somebody scripting the POST) cannot make the server spend. */
const PER_DUEL_MS = 15_000;
const PER_MINUTE = 20;
const asked = new Map<string, number>();
let minute = { at: 0, n: 0 };

function allowed(duel: string): boolean {
  const t = Date.now();
  if (t - minute.at > 60_000) minute = { at: t, n: 0 };
  if (minute.n >= PER_MINUTE) return false;
  if (t - (asked.get(duel) ?? 0) < PER_DUEL_MS) return false;
  asked.set(duel, t);
  minute.n += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const keys = sparKeys();
  if ("error" in keys) return NextResponse.json({ ok: false, error: keys.error }, { status: 503 });

  let duel: string;
  try {
    const body = (await req.json()) as { duel?: string };
    duel = String(body.duel ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Send { duel } as a fight address." }, { status: 400 });
  }
  if (!allowed(duel)) return NextResponse.json({ ok: false, error: "Asked a moment ago." }, { status: 429 });

  const conn = sparConnection();
  let d: DuelView | null;
  try {
    d = await readDuel(conn, duel);
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read that fight." }, { status: 400 });
  }
  if (!d) return NextResponse.json({ ok: false, error: "No fight at that address." }, { status: 404 });

  const result = await takeForSpar(conn, d, keys);
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const auth = authorise(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", why: auth.why }, { status: 401 });

  const keys = sparKeys();
  if ("error" in keys) return NextResponse.json({ ok: false, error: keys.error }, { status: 503 });

  const conn = sparConnection();
  const now = Math.floor(Date.now() / 1000);
  const spar = keys.spar.publicKey.toBase58();
  let due: DuelView[];
  try {
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: allDuels() });
    due = [];
    for (const a of accounts) {
      try {
        const d = decodeDuel(a.pubkey, a.account.data);
        if (!sparRefusal(d, now, spar)) due.push(d);
      } catch {
        /* Not a duel this build can read. */
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, at: now, error: e instanceof Error ? e.message.split("\n")[0] : "listing failed" });
  }

  const results: SparResult[] = [];
  for (const d of due.sort((a, b) => a.expiresTs - b.expiresTs).slice(0, 4)) {
    results.push(await takeForSpar(conn, d, keys));
  }
  return NextResponse.json({ ok: true, at: now, results });
}
