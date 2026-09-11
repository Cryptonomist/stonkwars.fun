/* Does the oracle's market data answer, and answer the same way twice?
 *
 *   npx tsx scripts/oracle-probe.ts
 *
 * For a few symbols (a mega cap, a thin ETF, a Hong Kong listing), asks for
 * the price at: a minute ago, 15:59:30 ET on the last trading day, and last
 * Saturday noon (market shut, so the answer is Monday's first bar). */

import { fetchBars, priceAtBoundary, quoteAt } from "../src/lib/oracle";

const SYMBOLS = (process.env.SYMBOLS ?? "AAPL,BRK-B,FGDL,0388.HK,2382.HK,NWG.L").split(",");

function lastBell(now: number): number {
  // 15:59:30 America/New_York on the most recent weekday before now.
  const d = new Date(now * 1000);
  for (let back = 0; back < 7; back++) {
    const day = new Date(d.getTime() - back * 86_400_000);
    const ny = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(day);
    const get = (t: string) => ny.find((p) => p.type === t)?.value ?? "";
    if (get("weekday") === "Sat" || get("weekday") === "Sun") continue;
    const iso = `${get("year")}-${get("month")}-${get("day")}T15:59:30`;
    // New York is UTC-4 in September.
    const ts = Math.floor(new Date(`${iso}-04:00`).getTime() / 1000);
    if (ts < now - 120) return ts;
  }
  throw new Error("no weekday found");
}

function lastSaturdayNoon(now: number): number {
  const d = new Date(now * 1000);
  const day = d.getUTCDay();
  const back = ((day + 1) % 7) || 7;
  const sat = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 16, 0, 0));
  return Math.floor(sat.getTime() / 1000);
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const moments = {
    "2 min ago": now - 120,
    "last bell": lastBell(now),
    "Sat noon": lastSaturdayNoon(now),
  };
  for (const symbol of SYMBOLS) {
    for (const [label, boundary] of Object.entries(moments)) {
      try {
        const currency = symbol.endsWith(".HK") ? "HKD" : symbol.endsWith(".L") ? "GBp" : "USD";
        const q1 = await quoteAt({ feed: "00".repeat(32), symbol, currency, boundary, now });
        const q2 = await quoteAt({ feed: "00".repeat(32), symbol, currency, boundary, now });
        const same = JSON.stringify(q1, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ===
          JSON.stringify(q2, (_, v) => (typeof v === "bigint" ? v.toString() : v));
        console.log(
          `${symbol.padEnd(8)} ${label.padEnd(10)} ${
            q1
              ? `${(Number(q1.price) / 1e4).toFixed(4).padStart(11)} as of ${new Date(q1.publishTime * 1000).toISOString()} (+${q1.publishTime - boundary}s)`
              : "not yet"
          } ${same ? "stable" : "CHANGED"}`,
        );
      } catch (e) {
        console.log(`${symbol.padEnd(8)} ${label.padEnd(10)} ERROR ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const bars = await fetchBars("AAPL", now - 3_600, now);
  console.log(`\nAAPL last hour: ${bars.t.length} bars, last close ${bars.c.at(-1)}, first ${new Date(bars.t[0] * 1000).toISOString()}`);
  console.log(`priceAtBoundary(now-90) = ${JSON.stringify(priceAtBoundary(bars, now - 90, now), (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
