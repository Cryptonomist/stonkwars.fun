/* Build src/data/prestocks.json from sources, not by hand.
 *
 *   node scripts/build-prestocks.mjs                 writes src/data/prestocks.json
 *   node scripts/build-prestocks.mjs other.json      writes somewhere else
 *
 * The company list and mints come from PreStocks' own API. Each mint's decimals
 * and token program are read from the mint on mainnet. The pool is the deepest
 * Solana pool where the token is the BASE asset, from GeckoTerminal. That last
 * condition is the whole point. Anthropic's biggest pool by liquidity is
 * BUTTHOLE/ANTHRP, where it is the quote side and the reported price is $0.00,
 * so "the deepest pool" would have priced a whole market at zero.
 *
 * Also records how busy each pool is, because the thin ones must be labelled
 * rather than quietly treated like the busy ones. */

import { readFileSync, writeFileSync } from "node:fs";

const GECKO = "https://api.geckoterminal.com/api/v2";
const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (url) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    if (r.ok) return r.json();
    if (r.status === 429) { await sleep(8000); continue; }
    return { err: `HTTP ${r.status}` };
  }
  return { err: "rate limited" };
};

/** The mint as the chain has it: decimals, and which token program owns it. */
async function mintOnChain(mint) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] }),
    signal: AbortSignal.timeout(25000),
  });
  const v = (await r.json())?.result?.value;
  const decimals = v?.data?.parsed?.info?.decimals;
  if (!v || typeof decimals !== "number") return null;
  return { decimals, tokenProgram: v.owner };
}

/* A colour each, in the arena's register: bright enough on void, none of them
 * the cyan or pink that mean a side of a fight. */
const COLOR = {
  OPENAI: "#10a37f", ANTHROPIC: "#d97757", NEURALINK: "#a78bfa",
  ANDURIL: "#8a9a5b", FIGUREAI: "#f59e0b", KALSHI: "#38bdf8", POLYMARKET: "#6366f1",
};
const BLURB = {
  OPENAI: "ChatGPT and the GPT models.",
  ANTHROPIC: "Claude, and the lab behind it.",
  NEURALINK: "Brain interfaces.",
  ANDURIL: "Autonomous defence systems.",
  FIGUREAI: "Humanoid robots.",
  KALSHI: "The regulated event exchange.",
  POLYMARKET: "The prediction market.",
};

/* PreStocks companies that do NOT belong on a desk of companies that have not
 * listed yet. SpaceX listed on Nasdaq as SPCX on 12 June 2026; the roster
 * carries it, so it can be fought over, and PreStocks' SpaceX token would be a
 * false label here as well as a thinner copy. A test in
 * tests-web/prestocks.test.ts fails if it returns. Listing status is checked
 * against an exchange, never assumed from a name. When the next one lists, it
 * goes here (see the note in src/lib/prestocks.ts). */
const EXCLUDE = { SPACEX: "listed on Nasdaq as SPCX; the roster carries it" };

const feed = await j("https://prestocks.com/api/prestocks");
const list = Array.isArray(feed) ? feed : feed.data ?? feed.products ?? [];
const out = [];

for (const p of list) {
  const ticker = (p.symbol ?? "").toUpperCase();
  const mint = p.contract_address ?? p.mint;
  if (!ticker || !mint) continue;
  if (EXCLUDE[ticker]) {
    console.log(`${ticker.padEnd(11)} skipped: ${EXCLUDE[ticker]}`);
    continue;
  }

  const chain = await mintOnChain(mint);
  if (!chain) { console.log(`${ticker}: could not read the mint on chain`); continue; }

  const pools = await j(`${GECKO}/networks/solana/tokens/${mint}/pools?page=1`);
  if (pools.err) { console.log(`${ticker}: ${pools.err}`); continue; }
  const mine = (pools.data ?? [])
    .map((d) => ({
      address: d.attributes?.address,
      name: d.attributes?.name,
      liq: Number(d.attributes?.reserve_in_usd ?? 0),
      vol24: Number(d.attributes?.volume_usd?.h24 ?? 0),
      buys: Number(d.attributes?.transactions?.h24?.buys ?? 0),
      sells: Number(d.attributes?.transactions?.h24?.sells ?? 0),
      priceUsd: Number(d.attributes?.base_token_price_usd ?? 0),
      isBase: (d.relationships?.base_token?.data?.id ?? "").endsWith(mint),
      /* Which DEX, so the page can name where a price was read instead of
       * calling them all "a Solana pool". Six of the seven are Meteora and
       * Figure AI's is Raydium, so this cannot be a constant. */
      dex: d.relationships?.dex?.data?.id ?? null,
    }))
    /* Only pools where this token is the base asset, and only ones quoting a
     * real price. A pool where it is the quote side reports zero. */
    .filter((q) => q.isBase && q.priceUsd > 0)
    .sort((a, b) => b.liq - a.liq);

  /* STILL THE DEEPEST POOL.
   *
   * Choosing the deepest pool that had traded in the last 24 hours was tried
   * and is worse: it moved Kalshi from a $164k USDC pool to a $12k one, and it
   * put SpaceX in a pool quoted in XAI, another thin pre-IPO token, which is
   * the same trap that once priced Anthropic at $0.00 through somebody else's
   * quote asset. Depth is the stable choice. What was actually wrong was the
   * count beside it, fixed below.
   *
   * Prices on the desk do not come from this pool anyway: /api/prestocks uses
   * routed Jupiter quotes, which aggregate every pool. This field is for the
   * activity badge and for drawing a path. */
  const top = mine[0];
  if (!top) { console.log(`${ticker}: no pool with it as the base asset`); continue; }

  /* EVERY POOL'S TRADES, ADDED UP, AND THAT IS DELIBERATE.
   *
   * Counting only the chosen pool was tried and is wrong here: it put Anduril,
   * Kalshi, Neuralink and SpaceX at zero trades a day, when all four do trade,
   * just not in their deepest pool. The badge answers "how much should I trust
   * this price", and the price on the desk comes from routed Jupiter quotes
   * across every pool, so the count has to span every pool too.
   *
   * The staleness that count hides is real but belongs elsewhere: it is the
   * chosen pool that can be stale, and the exhibition route is what reads that
   * pool, so that is where a window with no bars becomes a no-contest. */
  const trades = mine.reduce((n, q) => n + q.buys + q.sells, 0);

  out.push({
    ticker,
    name: p.name ?? ticker,
    blurb: BLURB[ticker] ?? "",
    /* What the token calls itself on chain, which is not always the ticker:
     * Anthropic's is ANTHRP, Anduril's is ANDURL. A pool is named base / quote,
     * so the base side of the pool being quoted IS the symbol, and reading it
     * from there keeps the two from drifting apart. */
    symbol: String(top.name ?? "").split("/")[0].trim() || ticker,
    mint,
    decimals: chain.decimals,
    tokenProgram: chain.tokenProgram,
    pool: top.address,
    poolName: top.name,
    dex: top.dex ?? undefined,
    color: COLOR[ticker] ?? "#9090a8",
    /* What the market looked like when this file was generated, so the
     * liquidity gate can be reasoned about rather than guessed at. */
    seen: { liquidityUsd: Math.round(top.liq), volume24hUsd: Math.round(top.vol24), trades24h: trades, priceUsd: Number(top.priceUsd.toFixed(4)) },
  });
  console.log(`${ticker.padEnd(11)} pool ${top.name.padEnd(18)} liq $${Math.round(top.liq).toLocaleString().padEnd(9)} trades24h ${trades}`);
  await sleep(6000);
}

/* NEVER LOSE A COMPANY TO A RATE LIMIT.
 *
 * One run of this dropped Polymarket and cheerfully reported "wrote 7
 * companies"; the next run got all eight. GeckoTerminal had simply refused a
 * request. A generator that silently deletes a market when an API blinks is
 * worse than no generator, so anything in the previous file that did not come
 * back this time is carried over and said out loud, and a run that would
 * shrink the file for any other reason refuses to write at all. */
const target = process.argv[2] ?? new URL("../src/data/prestocks.json", import.meta.url);
let previous = [];
try {
  previous = JSON.parse(readFileSync(target, "utf8"));
} catch {
  /* First run, or the file is not there yet. */
}

const got = new Set(out.map((p) => p.ticker));
for (const old of previous) {
  if (got.has(old.ticker)) continue;
  /* An excluded company is gone on purpose, not lost to a rate limit. */
  if (EXCLUDE[old.ticker]) continue;
  console.log(`!! ${old.ticker} did not come back this run; keeping the previous row`);
  out.push(old);
}

const expected = previous.filter((p) => !EXCLUDE[p.ticker]).length;
if (expected && out.length < expected) {
  console.error(`refusing to write: ${out.length} companies against ${expected} expected`);
  process.exit(1);
}

out.sort((a, b) => b.seen.trades24h - a.seen.trades24h);
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${out.length} companies to ${target}`);
