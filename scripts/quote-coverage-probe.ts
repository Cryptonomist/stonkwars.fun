/* Which tokenized stocks can be priced, and by what.
 *
 *   npx tsx scripts/xstocks-list.ts > /tmp/xstocks.json
 *   npx tsx scripts/quote-coverage-probe.ts /tmp/xstocks.json
 *
 * For every xStock: does Jupiter price the token, and does a public quote for
 * the underlying share exist (Yahoo's chart endpoint, no key)? */

import { readFileSync } from "node:fs";

type X = { ticker: string; symbol: string; name: string; mint: string; price: number | null };

const yahooSymbol = (t: string) => t.replace(".", "-");

async function yahoo(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}?interval=1m&range=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 stonkwars-probe" } });
  if (!r.ok) return { ok: false as const, why: `HTTP ${r.status}` };
  const body = (await r.json()) as {
    chart: { result?: { meta: { regularMarketPrice?: number; regularMarketTime?: number; exchangeName?: string; instrumentType?: string } }[] };
  };
  const meta = body.chart.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return { ok: false as const, why: "no price" };
  return {
    ok: true as const,
    price: meta.regularMarketPrice,
    time: meta.regularMarketTime ?? 0,
    exchange: meta.exchangeName ?? "?",
    type: meta.instrumentType ?? "?",
  };
}

async function main() {
  const list = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/xstocks.json", "utf8")) as X[];
  let jup = 0;
  let yah = 0;
  let either = 0;
  const rows: string[] = [];
  for (const x of list) {
    const y = await yahoo(x.ticker);
    if (x.price) jup++;
    if (y.ok) yah++;
    if (x.price || y.ok) either++;
    const age = y.ok ? Math.round((Date.now() / 1000 - y.time) / 60) : 0;
    rows.push(
      `${x.symbol.padEnd(8)} jup ${x.price ? x.price.toFixed(2).padStart(9) : "       --"}   yahoo ${
        y.ok ? `${y.price.toFixed(2).padStart(9)} ${y.exchange.padEnd(8)} ${y.type.padEnd(6)} ${age}m old` : `-- ${y.why}`
      }   ${x.name}`,
    );
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(rows.join("\n"));
  console.log(`\n${list.length} xStocks. Jupiter prices ${jup}. Yahoo quotes the underlying for ${yah}. Either: ${either}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
