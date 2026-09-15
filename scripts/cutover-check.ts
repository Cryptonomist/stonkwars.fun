/* Which open fights a COMPOSITE_FROM would catch, before anybody deploys it.
 *
 *   RPC=https://api.devnet.solana.com npx tsx scripts/cutover-check.ts [--from <unix seconds>]
 *
 * WHY THIS HAS TO RUN. The oracle's rule goes by boundary, not by fight: a
 * quote names a stock and a moment, never a duel. So a fight taken under the
 * old rules (a perp or a pool for a shut US stock) whose still-unpriced start
 * or end falls at or after COMPOSITE_FROM, while its exchange is shut, is
 * priced there by the new rule instead: the composite, or the exchange's next
 * bar for a stock the composite does not list. The page that let it be taken
 * judged it by the old rule, so the new one can put its two prices hours apart
 * (NVDA v KO taken at night: NVDA on the composite at once, KO at 4 AM).
 *
 * It reads every ACCEPTED and LIVE duel and lists each one with an unpriced
 * boundary at or after the candidate cutover whose start was before it, side
 * by side: what each side's rule was before the cutover and what it is after.
 * When the candidate is the COMPOSITE_FROM this build carries, it also says
 * whether the price clock can price that boundary and how far apart the two
 * sides' price times land (SAME_PRICE_SECS is the most a fight allows), for
 * every open fight, not only those that cross. Pick a cutover that lists
 * nothing crossing, or wait for those fights to settle.
 *
 * Reads the chain and nothing else, and signs nothing. Exits 1 when some fight
 * crosses the cutover. */

import { Connection } from "@solana/web3.js";

import { COMPOSITE_FROM } from "../src/lib/composite";
import { boundaryOf } from "../src/lib/crankTx";
import { decodeDuel, duelsWithStatus, PROGRAM_ID, SOURCE_PYTH, STATUS_ACCEPTED, STATUS_LIVE, type DuelView } from "../src/lib/duel";
import { session } from "../src/lib/market";
import { sourceAt } from "../src/lib/oracle";
import { readyAt } from "../src/lib/priceClock";
import { byFeed, priceTimeAt, quoteSymbolFor, SAME_PRICE_SECS, sourceFromChain } from "../src/lib/stocks";
import { inputsAt } from "../src/lib/venues247";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const arg = process.argv.indexOf("--from");
const FROM = arg > 0 ? Number(process.argv[arg + 1]) : COMPOSITE_FROM;
if (!Number.isSafeInteger(FROM)) throw new Error("--from takes unix seconds");
const THIS_BUILD = FROM === COMPOSITE_FROM;

const et = (t: number) =>
  new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

/** What priced a side at `b` under the rules before the cutover, and after it. */
function rules(feed: string, source: number, b: number): { ticker: string; before: string; after: string } {
  const s = byFeed(feed);
  const ticker = s?.ticker ?? feed.slice(0, 8);
  if (source === SOURCE_PYTH) return { ticker, before: "pyth", after: "pyth" };
  const m = quoteSymbolFor(feed);
  if (!m) return { ticker, before: "unknown", after: "unknown" };
  const shut = (m.market ?? "US") === "US" && session(b * 1_000) === "closed";
  const before = !shut ? "exchange" : m.perp ? "perp" : m.pool ? "pool" : "exchange";
  const after = THIS_BUILD ? sourceAt(b, m) : !shut ? "exchange" : m.composite && inputsAt(m.composite, b).length ? "composite" : "exchange";
  return { ticker, before, after };
}

/** The boundaries a duel still has to be priced at: its start if not started, and its end. */
function unpriced(d: DuelView): { which: "start" | "settle"; boundary: number }[] {
  const out: { which: "start" | "settle"; boundary: number }[] = [];
  if (d.status === STATUS_ACCEPTED) {
    const start = boundaryOf(d, "start");
    out.push({ which: "start", boundary: start });
    if (d.durationSecs > 0) {
      // Not started, so end_ts is not set yet: the program counts it from the later start price.
      const times = [
        priceTimeAt(byFeed(d.creatorFeed)?.ticker ?? "", start, sourceFromChain(d.creatorSource)),
        priceTimeAt(byFeed(d.opponentFeed)?.ticker ?? "", start, sourceFromChain(d.opponentSource)),
      ];
      if (times.every((t) => t !== null)) out.push({ which: "settle", boundary: Math.max(...(times as number[])) + d.durationSecs });
    } else if (d.endTs > 0) {
      out.push({ which: "settle", boundary: d.endTs });
    }
  } else if (d.endTs > 0) {
    out.push({ which: "settle", boundary: d.endTs });
  }
  return out;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log(`cutover ${FROM} (${et(FROM)})${THIS_BUILD ? ", the COMPOSITE_FROM this build carries" : ", a candidate; this build carries " + COMPOSITE_FROM}`);
  const duels: DuelView[] = [];
  for (const status of [STATUS_ACCEPTED, STATUS_LIVE]) {
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, { filters: duelsWithStatus(status) });
    for (const a of accounts) {
      try {
        duels.push(decodeDuel(a.pubkey, a.account.data));
      } catch {
        console.log(`${a.pubkey.toBase58()}: does not decode, skipped`);
      }
    }
  }
  console.log(`${duels.length} open fights (accepted or live)`);

  let crossing = 0;
  let apart = 0;
  for (const d of duels) {
    const start = boundaryOf(d, "start");
    for (const { which, boundary } of unpriced(d)) {
      if (boundary < FROM) continue;
      const sides = [rules(d.creatorFeed, d.creatorSource, boundary), rules(d.opponentFeed, d.opponentSource, boundary)];
      const changed = sides.some((s) => s.before !== s.after);
      const crosses = start < FROM && changed;
      let clock = "";
      let gap: number | null = null;
      if (THIS_BUILD) {
        const r = readyAt(d, which, Math.floor(Date.now() / 1000));
        clock = "at" in r ? `ready ${et(r.at)}` : "shut" in r ? `shut: ${r.shut.join(", ")}` : `never: ${r.never.join(", ")}`;
        const t = [
          priceTimeAt(sides[0].ticker, boundary, sourceFromChain(d.creatorSource)),
          priceTimeAt(sides[1].ticker, boundary, sourceFromChain(d.opponentSource)),
        ];
        gap = t[0] !== null && t[1] !== null ? Math.abs(t[0] - t[1]) : null;
      }
      const far = gap === null ? THIS_BUILD : gap > SAME_PRICE_SECS;
      if (!crosses && !far) continue;
      if (crosses) crossing++;
      if (far) apart++;
      console.log(
        [
          `${d.address.toBase58()} ${which} at ${et(boundary)}${crosses ? "  CROSSES THE CUTOVER" : ""}`,
          ...sides.map((s) => `  ${s.ticker.padEnd(8)} before ${s.before.padEnd(9)} after ${s.after}`),
          ...(THIS_BUILD ? [`  clock ${clock}; price times ${gap === null ? "cannot both exist" : `${gap}s apart`}${far ? " (more than a fight allows)" : ""}`] : []),
        ].join("\n"),
      );
    }
  }
  console.log(`${crossing} crossing the cutover${THIS_BUILD ? `, ${apart} whose prices would land apart or never` : ""}`);
  if (crossing) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
